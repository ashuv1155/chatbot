import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  ArrowDown,
  ChevronDown,
  Download,
  FileCode2,
  FileText,
  Menu,
  PanelLeftOpen,
  Printer,
  Search,
  ShieldCheck,
  SquarePen,
  Upload,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  Attachment,
  ChatMessage,
  ChatSettings,
  Conversation,
  KeyMetric,
  ModelPricingInfo,
  PoolSummary,
  PreviewArtifact,
  QuotaInfo,
  ResponseStyle,
  ResponseTone,
  SearchMode,
  SearchProgress,
  SearchRecency,
  SearchSource,
  TokenUsage,
} from './types/chat';
import {
  estimateTokens,
  exportConversationJson,
  exportConversationMarkdown,
  extractQuotaFromHeaders,
  generateTitle,
  loadActiveConversationId,
  loadConversations,
  loadSettings,
  loadTheme,
  saveActiveConversationId,
  saveConversations,
  saveSettings,
  saveTheme,
} from './lib/storage';
import {
  createConversationWithMessage,
  deleteConversationFromFirestore,
  deleteConversationMessagesAfter,
  recordUserUsageToFirestore,
  saveAssistantMessageToFirestore,
  saveBranchedConversationToFirestore,
  signInWithGoogle,
  signOutUser,
  subscribeAuthState,
  subscribeConversationMessages,
  subscribeUserConversations,
  syncUserConversationsCount,
  syncUserProfile,
  updateConversationMetaInFirestore,
  updateUserMessageContentInFirestore,
} from './lib/firebase';
import { getAuthHeaders, isAdminUser } from './lib/admin';
import { downloadFile, readFileAsText } from './lib/browser';
import { SSEChunkParser } from './lib/sse';
import { Sidebar } from './components/Sidebar';
import { MessageItem } from './components/MessageItem';
import { Composer } from './components/Composer';
import { SettingsModal } from './components/SettingsModal';
import { QuotaModal } from './components/QuotaModal';
import { ArtifactPreview } from './components/ArtifactPreview';
import { CommandPalette } from './components/CommandPalette';
import { LoginScreen } from './components/LoginScreen';
import { AdminDashboardModal } from './components/AdminDashboardModal';

const STARTER_PROMPTS: Array<{
  title: string;
  subtitle: string;
  prompt: string;
  searchMode?: SearchMode;
}> = [
  {
    title: 'Web Search: Latest AI & tech news',
    subtitle: 'Live web search with clickable citations',
    prompt:
      'What are the most important open-source LLM and web development releases this week?',
    searchMode: 'web',
  },
  {
    title: 'Deep Search: SQLite WAL vs PostgreSQL',
    subtitle: 'Multi-query research reading full docs',
    prompt:
      'Compare SQLite WAL mode vs PostgreSQL for high-concurrency read-heavy SaaS apps, including benchmarks and operational trade-offs.',
    searchMode: 'deep',
  },
  {
    title: 'Build an interactive HTML widget',
    subtitle: 'Test the live side-by-side HTML preview',
    prompt:
      'Create a self-contained single-file HTML/CSS/JS interactive Pomodoro focus timer in an ```html code block with clean minimalist styling.',
  },
  {
    title: 'Debug a React streaming race',
    subtitle: 'AbortController and stale closure fixes',
    prompt:
      'Show how to prevent race conditions and stale state when streaming fetch chunks into React state with user cancellation.',
  },
];

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildApiMessageContent(
  content: string,
  attachments?: Attachment[],
): string {
  if (!attachments || attachments.length === 0) return content;
  const withContent = attachments.filter((att) => att.content.length > 0);
  if (withContent.length === 0) return content;
  const fileBlocks = withContent
    .map(
      (att) =>
        `[Attached file: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``,
    )
    .join('\n\n');
  return content ? `${fileBlocks}\n\n${content}` : fileBlocks;
}

function formatApiError(status: number, body: unknown): string {
  const errObj =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: Record<string, unknown> }).error
      : undefined;
  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  const message =
    typeof errObj?.message === 'string' ? errObj.message : undefined;

  if (status === 429 && code === 'daily_quota_exceeded') {
    const resetAt =
      typeof errObj?.reset_at === 'string' ? errObj.reset_at : '00:00 UTC';
    return `Daily token allowance reached. Resets at ${resetAt}.`;
  }
  if (status === 429 && code === 'session_limit_reached') {
    return 'Concurrent stream limit reached (max 5 simultaneous requests). Wait a moment and retry.';
  }
  if (status === 400 && code === 'context_length_exceeded') {
    return 'Conversation exceeds the 198K token context window. Start a new chat or shorten older messages.';
  }
  if (status === 413 || code === 'body_too_large') {
    return 'Request body exceeds the 4 MB limit. Remove large attachments and retry.';
  }
  if (status === 503) {
    return (
      message ||
      'Service is temporarily at full capacity. Please retry shortly.'
    );
  }
  if (status === 502) {
    return (
      message ||
      'Upstream model failed to answer (failed requests do not count against your quota). Retry when ready.'
    );
  }
  return message || `Request failed with status ${status}.`;
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => loadTheme());
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [guestMode, setGuestMode] = useState(false);

  const [localConversations, setLocalConversations] = useState<Conversation[]>(
    () => loadConversations(),
  );
  const [cloudConversations, setCloudConversations] = useState<Conversation[]>(
    [],
  );
  const [cloudMessagesById, setCloudMessagesById] = useState<
    Record<string, ChatMessage[]>
  >({});

  const [localActiveId, setLocalActiveId] = useState<string | null>(() => {
    const saved = loadActiveConversationId();
    const list = loadConversations();
    if (saved && list.some((c) => c.id === saved)) return saved;
    return null;
  });
  const [cloudActiveId, setCloudActiveId] = useState<string | null>(null);

  const [settings, setSettings] = useState<ChatSettings>(() => loadSettings());
  const [searchMode, setSearchMode] = useState<SearchMode>(
    () => loadSettings().defaultSearchMode,
  );
  const [searchRecency, setSearchRecency] = useState<SearchRecency>(
    () => loadSettings().searchRecency,
  );
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(
    () => loadSettings().responseStyle,
  );
  const [tone, setTone] = useState<ResponseTone>(() => loadSettings().tone);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [adminConsoleOpen, setAdminConsoleOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] =
    useState<PreviewArtifact | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streamingConvId, setStreamingConvId] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const [quota, setQuota] = useState<QuotaInfo>({
    limit: null,
    used: null,
    remaining: null,
    resetAt: null,
    qos: null,
  });
  const [models, setModels] = useState<ModelPricingInfo[]>([]);
  const [keyMetrics, setKeyMetrics] = useState<KeyMetric[]>([]);
  const [poolSummary, setPoolSummary] = useState<PoolSummary | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const dragDepthRef = useRef(0);
  const userRef = useRef<User | null>(null);
  const streamingConvIdRef = useRef<string | null>(null);
  const pendingConvWritesRef = useRef<Map<string, Promise<void>>>(new Map());
  const lastSyncedConvCountRef = useRef<number | null>(null);

  userRef.current = user;

  const isAuthenticated = Boolean(authReady && user);
  const isAdmin = useMemo(() => isAdminUser(user), [user]);
  const activeId = isAuthenticated ? cloudActiveId : localActiveId;

  const setActiveId = useCallback((id: string | null) => {
    if (userRef.current) {
      setCloudActiveId(id);
    } else {
      setLocalActiveId(id);
    }
  }, []);

  const conversations = useMemo(() => {
    if (!isAuthenticated) return localConversations;
    return cloudConversations.map((c) => ({
      ...c,
      messages: cloudMessagesById[c.id] ?? c.messages,
    }));
  }, [
    isAuthenticated,
    localConversations,
    cloudConversations,
    cloudMessagesById,
  ]);

  const enqueueConvWrite = useCallback(
    (convId: string, task: () => Promise<void>) => {
      const prev =
        pendingConvWritesRef.current.get(convId) ?? Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(task)
        .catch((err) => {
          console.error('Firestore write error:', err);
        });
      pendingConvWritesRef.current.set(convId, next);
      return next;
    },
    [],
  );

  // Sync theme class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveTheme(theme);
  }, [theme]);

  // Firebase Auth listener
  useEffect(() => {
    return subscribeAuthState((nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      lastSyncedConvCountRef.current = null;
      if (nextUser) {
        setGuestMode(false);
        syncUserProfile(nextUser).catch(() => {});
      } else {
        setCloudConversations([]);
        setCloudMessagesById({});
        setCloudActiveId(null);
        setAdminConsoleOpen(false);
      }
    });
  }, []);

  // Real-time Firestore conversations list when signed in
  useEffect(() => {
    if (!authReady || !user) return;
    return subscribeUserConversations(
      user.uid,
      (items) => {
        setCloudConversations(items);
        if (lastSyncedConvCountRef.current !== items.length) {
          lastSyncedConvCountRef.current = items.length;
          syncUserConversationsCount(user.uid, items.length).catch(() => {});
        }
      },
      (err) => {
        console.error('Firestore conversations sync error:', err);
      },
    );
  }, [authReady, user]);

  // Real-time Firestore messages for the active conversation
  useEffect(() => {
    if (!authReady || !user || !cloudActiveId) return;
    return subscribeConversationMessages(
      user.uid,
      cloudActiveId,
      (msgs) => {
        if (streamingConvIdRef.current === cloudActiveId) return;
        setCloudMessagesById((prev) => ({
          ...prev,
          [cloudActiveId]: msgs,
        }));
      },
      (err) => {
        console.error('Firestore messages sync error:', err);
      },
    );
  }, [authReady, user, cloudActiveId]);

  // Persist local guest conversations & activeId
  useEffect(() => {
    saveConversations(localConversations);
  }, [localConversations]);

  useEffect(() => {
    saveActiveConversationId(localActiveId);
  }, [localActiveId]);

  const refreshQuota = useCallback(async () => {
    try {
      const authHeaders = await getAuthHeaders(userRef.current);
      const res = await fetch('/api/quota', { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data?.quota) {
          setQuota((prev) => ({ ...prev, ...data.quota }));
        }
        if (Array.isArray(data?.models)) {
          setModels(data.models as ModelPricingInfo[]);
        }
        if (Array.isArray(data?.keys)) {
          setKeyMetrics(data.keys as KeyMetric[]);
        }
        if (data?.poolSummary) {
          setPoolSummary(data.poolSummary as PoolSummary);
        }
      }
    } catch {
      // Non-blocking background check
    }
  }, []);

  useEffect(() => {
    if (authReady) {
      refreshQuota();
    }
  }, [authReady, user, refreshQuota]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  const isStreamingActive = Boolean(
    streamingConvId && streamingConvId === activeConversation?.id,
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleNewChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setActiveId(null);
    setInput('');
    setAttachments([]);
    setPreviewArtifact(null);
  }, [setActiveId]);

  const handleSidebarSignIn = useCallback(async () => {
    try {
      await signInWithGoogle();
    } catch {
      setGuestMode(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    await signOutUser();
    setCloudActiveId(null);
    setPreviewArtifact(null);
    setGuestMode(false);
  }, []);

  // Global cross-browser keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((o) => !o);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleNewChat();
        return;
      }
      if (e.key === 'Escape') {
        if (exportMenuOpen) setExportMenuOpen(false);
        if (
          !commandPaletteOpen &&
          !settingsOpen &&
          !quotaModalOpen &&
          !adminConsoleOpen &&
          streamingConvId
        ) {
          handleStop();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    adminConsoleOpen,
    commandPaletteOpen,
    exportMenuOpen,
    handleNewChat,
    handleStop,
    quotaModalOpen,
    settingsOpen,
    streamingConvId,
  ]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isAway = distanceFromBottom > 120;
    userScrolledUpRef.current = isAway;
    setShowScrollBottom(isAway);
  };

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom('auto');
    }
  }, [activeConversation?.messages, scrollToBottom]);

  const contextTokensEstimate = useMemo(() => {
    if (!activeConversation) return estimateTokens(settings.systemPrompt);
    const msgTokens = activeConversation.messages.reduce(
      (sum, m) =>
        sum +
        estimateTokens(m.content) +
        (m.attachments?.reduce((s, a) => s + estimateTokens(a.content), 0) ||
          0),
      0,
    );
    return msgTokens + estimateTokens(settings.systemPrompt);
  }, [activeConversation, settings.systemPrompt]);

  const updateAssistantMessage = useCallback(
    (
      convId: string,
      assistantMsgId: string,
      updater: (msg: ChatMessage) => ChatMessage,
    ) => {
      if (userRef.current) {
        setCloudMessagesById((prev) => {
          const list = prev[convId];
          if (!list) return prev;
          return {
            ...prev,
            [convId]: list.map((m) =>
              m.id === assistantMsgId ? updater(m) : m,
            ),
          };
        });
      } else {
        setLocalConversations((prev) =>
          prev.map((conv) => {
            if (conv.id !== convId) return conv;
            return {
              ...conv,
              updatedAt: Date.now(),
              messages: conv.messages.map((m) =>
                m.id === assistantMsgId ? updater(m) : m,
              ),
            };
          }),
        );
      }
    },
    [],
  );

  const runCompletion = useCallback(
    async (
      convId: string,
      historyForApi: ChatMessage[],
      assistantTemplate: ChatMessage,
      activeSearchMode: SearchMode,
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      streamingConvIdRef.current = convId;
      setStreamingConvId(convId);
      userScrolledUpRef.current = false;

      const apiMessages: Array<{ role: string; content: string }> = [];
      if (settings.systemPrompt.trim()) {
        apiMessages.push({
          role: 'system',
          content: settings.systemPrompt.trim(),
        });
      }
      for (const m of historyForApi) {
        if (m.error) continue;
        apiMessages.push({
          role: m.role,
          content: buildApiMessageContent(m.content, m.attachments),
        });
      }

      let accumulatedContent = '';
      let accumulatedReasoning = '';
      let finalUsage: TokenUsage | undefined;
      let latestSources: SearchSource[] | undefined;
      let latestQueries: string[] | undefined;
      let latestProgress: SearchProgress | undefined;
      let finalMessage: ChatMessage = {
        ...assistantTemplate,
        isStreaming: false,
      };

      try {
        const authHeaders = await getAuthHeaders(userRef.current);
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            model: 'deepseek-v4.1-flash-free',
            messages: apiMessages,
            stream: settings.stream,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            searchMode: activeSearchMode,
            searchRecency,
            responseStyle,
            tone,
          }),
          signal: controller.signal,
        });

        const headerQuota = extractQuotaFromHeaders(res.headers);
        if (Object.keys(headerQuota).length > 0) {
          setQuota((prev) => ({ ...prev, ...headerQuota }));
        }

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          const errMsg = formatApiError(res.status, errBody);
          finalMessage = {
            ...assistantTemplate,
            isStreaming: false,
            error: errMsg,
          };
          updateAssistantMessage(convId, assistantTemplate.id, () => finalMessage);
        } else if (!settings.stream) {
          const data = await res.json();
          const choice = data?.choices?.[0];
          const content = choice?.message?.content || '';
          const reasoning = choice?.message?.reasoning_content || undefined;
          const usage: TokenUsage | undefined = data?.usage;
          const meta = data?.ashutosh_meta;
          latestSources = Array.isArray(meta?.sources) ? meta.sources : undefined;
          latestQueries = Array.isArray(meta?.queries) ? meta.queries : undefined;

          finalMessage = {
            ...assistantTemplate,
            content,
            reasoning,
            usage,
            searchMode: activeSearchMode,
            searchQueries: latestQueries,
            sources: latestSources,
            isStreaming: false,
          };
          updateAssistantMessage(convId, assistantTemplate.id, () => finalMessage);
          refreshQuota();
        } else {
          if (!res.body) {
            throw new Error('Response stream body is empty.');
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const parser = new SSEChunkParser();

          const processDecodedText = (text: string): boolean => {
            if (!text) return false;
            const { events, done: sseDone } = parser.push(text);
            let changed = false;

            for (const evt of events) {
              if (evt.error?.message) {
                throw new Error(evt.error.message);
              }
              if (evt.ashutosh_meta) {
                const meta = evt.ashutosh_meta;
                latestProgress = {
                  stage: meta.stage,
                  queries: meta.queries || [],
                  sourcesCount: meta.sourcesCount ?? 0,
                  pagesRead: meta.pagesRead,
                };
                if (Array.isArray(meta.queries) && meta.queries.length > 0) {
                  latestQueries = meta.queries;
                }
                if (Array.isArray(meta.sources)) {
                  latestSources = meta.sources;
                }
                changed = true;
              }
              const delta = evt.choices?.[0]?.delta;
              if (delta?.reasoning_content) {
                accumulatedReasoning += delta.reasoning_content;
                changed = true;
              }
              if (delta?.content) {
                accumulatedContent += delta.content;
                changed = true;
              }
              if (evt.usage && typeof evt.usage.total_tokens === 'number') {
                finalUsage = {
                  prompt_tokens: evt.usage.prompt_tokens ?? 0,
                  completion_tokens: evt.usage.completion_tokens ?? 0,
                  total_tokens: evt.usage.total_tokens,
                };
                changed = true;
              }
            }

            if (changed) {
              const nextContent = accumulatedContent;
              const nextReasoning = accumulatedReasoning || undefined;
              const nextUsage = finalUsage;
              const nextProgress = latestProgress;
              const nextSources = latestSources;
              const nextQueries = latestQueries;
              updateAssistantMessage(convId, assistantTemplate.id, (m) => ({
                ...m,
                content: nextContent,
                reasoning: nextReasoning,
                usage: nextUsage,
                searchProgress: nextProgress,
                searchQueries: nextQueries,
                sources: nextSources,
              }));
            }

            return sseDone;
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              processDecodedText(decoder.decode());
              break;
            }
            const text = decoder.decode(value, { stream: true });
            const sseDone = processDecodedText(text);
            if (sseDone) break;
          }

          finalMessage = {
            ...assistantTemplate,
            content: accumulatedContent,
            reasoning: accumulatedReasoning || undefined,
            usage: finalUsage,
            searchMode: activeSearchMode,
            searchQueries: latestQueries,
            sources: latestSources,
            searchProgress: undefined,
            isStreaming: false,
          };
          updateAssistantMessage(convId, assistantTemplate.id, () => finalMessage);
          refreshQuota();
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          finalMessage = {
            ...assistantTemplate,
            content: accumulatedContent,
            reasoning: accumulatedReasoning || undefined,
            usage: finalUsage,
            searchMode: activeSearchMode,
            searchQueries: latestQueries,
            sources: latestSources,
            searchProgress: undefined,
            isStreaming: false,
            aborted: true,
          };
          updateAssistantMessage(convId, assistantTemplate.id, () => finalMessage);
          refreshQuota();
        } else {
          finalMessage = {
            ...assistantTemplate,
            content: accumulatedContent,
            reasoning: accumulatedReasoning || undefined,
            usage: finalUsage,
            searchMode: activeSearchMode,
            searchQueries: latestQueries,
            sources: latestSources,
            searchProgress: undefined,
            isStreaming: false,
            error:
              err instanceof Error
                ? err.message
                : 'Unexpected network error while generating response.',
          };
          updateAssistantMessage(convId, assistantTemplate.id, () => finalMessage);
        }
      } finally {
        const signedInUser = userRef.current;
        if (signedInUser) {
          await enqueueConvWrite(convId, () =>
            saveAssistantMessageToFirestore(
              signedInUser.uid,
              convId,
              finalMessage,
            ),
          );

          const hasPartialOrFullOutput =
            Boolean(finalMessage.usage) ||
            finalMessage.content.length > 0 ||
            Boolean(finalMessage.reasoning);
          const promptTok =
            finalMessage.usage?.prompt_tokens ??
            (hasPartialOrFullOutput
              ? estimateTokens(apiMessages.map((m) => m.content).join('\n'))
              : 0);
          const completionTok =
            finalMessage.usage?.completion_tokens ??
            (hasPartialOrFullOutput
              ? estimateTokens(
                  `${finalMessage.reasoning || ''}${finalMessage.content}`,
                )
              : 0);
          const totalTok =
            finalMessage.usage?.total_tokens ?? promptTok + completionTok;
          const status = finalMessage.error
            ? 'error'
            : finalMessage.aborted
              ? 'aborted'
              : 'completed';

          recordUserUsageToFirestore(signedInUser, {
            model: 'deepseek-v4.1-flash-free',
            searchMode: activeSearchMode,
            responseStyle,
            tone,
            promptTokens: promptTok,
            completionTokens: completionTok,
            totalTokens: totalTok,
            sourcesCount: latestSources?.length ?? 0,
            status,
            errorMessage: finalMessage.error,
          }).catch((err) => {
            console.error('Usage logging error:', err);
          });
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (streamingConvIdRef.current === convId) {
          streamingConvIdRef.current = null;
        }
        setStreamingConvId((prev) => (prev === convId ? null : prev));
      }
    },
    [
      enqueueConvWrite,
      refreshQuota,
      responseStyle,
      searchRecency,
      settings.maxTokens,
      settings.stream,
      settings.systemPrompt,
      settings.temperature,
      tone,
      updateAssistantMessage,
    ],
  );

  const handleSend = useCallback(
    (overrideText?: string, modeOverride?: SearchMode) => {
      const text = (overrideText ?? input).trim();
      const pendingAttachments = overrideText ? [] : attachments;
      if (!text && pendingAttachments.length === 0) return;
      if (streamingConvId) return;

      const effectiveSearchMode = modeOverride ?? searchMode;
      const now = Date.now();
      const userMsg: ChatMessage = {
        id: createId(),
        role: 'user',
        content: text,
        attachments:
          pendingAttachments.length > 0 ? pendingAttachments : undefined,
        searchMode: effectiveSearchMode,
        createdAt: now,
      };
      const assistantMsg: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        searchMode: effectiveSearchMode,
        searchProgress:
          effectiveSearchMode !== 'off'
            ? {
                stage: effectiveSearchMode === 'deep' ? 'planning' : 'searching',
                queries: [text.slice(0, 120)],
                sourcesCount: 0,
              }
            : undefined,
        createdAt: now + 1,
        isStreaming: true,
      };

      if (!overrideText) {
        setInput('');
        setAttachments([]);
      }

      const signedInUid = userRef.current?.uid;

      if (!activeConversation) {
        const newConvId = createId();
        const title = generateTitle(
          text || pendingAttachments[0]?.name || 'New chat',
        );
        const newConv: Conversation = {
          id: newConvId,
          title,
          messages: [userMsg, assistantMsg],
          createdAt: now,
          updatedAt: now,
        };

        if (signedInUid) {
          setCloudConversations((prev) => [newConv, ...prev]);
          setCloudMessagesById((prev) => ({
            ...prev,
            [newConvId]: [userMsg, assistantMsg],
          }));
          setCloudActiveId(newConvId);
          enqueueConvWrite(newConvId, () =>
            createConversationWithMessage(
              signedInUid,
              { id: newConvId, title, pinned: false },
              userMsg,
              true,
            ),
          );
        } else {
          setLocalConversations((prev) => [newConv, ...prev]);
          setLocalActiveId(newConvId);
        }

        runCompletion(
          newConvId,
          [userMsg],
          assistantMsg,
          effectiveSearchMode,
        );
      } else {
        const convId = activeConversation.id;
        const nextHistory = [...activeConversation.messages, userMsg];
        const nextTitle =
          activeConversation.messages.length === 0
            ? generateTitle(text || pendingAttachments[0]?.name || 'New chat')
            : activeConversation.title;

        if (signedInUid) {
          setCloudConversations((prev) =>
            prev.map((c) =>
              c.id === convId ? { ...c, title: nextTitle, updatedAt: now } : c,
            ),
          );
          setCloudMessagesById((prev) => ({
            ...prev,
            [convId]: [...nextHistory, assistantMsg],
          }));
          enqueueConvWrite(convId, () =>
            createConversationWithMessage(
              signedInUid,
              {
                id: convId,
                title: nextTitle,
                pinned: Boolean(activeConversation.pinned),
              },
              userMsg,
              false,
            ),
          );
        } else {
          setLocalConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    title: nextTitle,
                    updatedAt: now,
                    messages: [...nextHistory, assistantMsg],
                  }
                : c,
            ),
          );
        }

        runCompletion(
          convId,
          nextHistory,
          assistantMsg,
          effectiveSearchMode,
        );
      }
    },
    [
      activeConversation,
      attachments,
      enqueueConvWrite,
      input,
      runCompletion,
      searchMode,
      streamingConvId,
    ],
  );

  const handleRegenerate = useCallback(
    (assistantMsgId: string) => {
      if (!activeConversation || streamingConvId) return;
      const idx = activeConversation.messages.findIndex(
        (m) => m.id === assistantMsgId,
      );
      if (idx === -1) return;

      const convId = activeConversation.id;
      const priorMessages = activeConversation.messages.slice(0, idx);
      const prevAssistant = activeConversation.messages[idx];
      const effectiveSearchMode = prevAssistant.searchMode ?? searchMode;
      const removedIds = activeConversation.messages
        .slice(idx)
        .map((m) => m.id);
      const freshAssistant: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        searchMode: effectiveSearchMode,
        searchProgress:
          effectiveSearchMode !== 'off'
            ? {
                stage: effectiveSearchMode === 'deep' ? 'planning' : 'searching',
                queries: [],
                sourcesCount: 0,
              }
            : undefined,
        createdAt: Date.now(),
        isStreaming: true,
      };

      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        setCloudMessagesById((prev) => ({
          ...prev,
          [convId]: [...priorMessages, freshAssistant],
        }));
        enqueueConvWrite(convId, () =>
          deleteConversationMessagesAfter(signedInUid, convId, removedIds),
        );
      } else {
        setLocalConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: [...priorMessages, freshAssistant],
                }
              : c,
          ),
        );
      }

      runCompletion(convId, priorMessages, freshAssistant, effectiveSearchMode);
    },
    [
      activeConversation,
      enqueueConvWrite,
      runCompletion,
      searchMode,
      streamingConvId,
    ],
  );

  const handleBranchFromMessage = useCallback(
    (messageId: string) => {
      if (!activeConversation) return;
      const idx = activeConversation.messages.findIndex(
        (m) => m.id === messageId,
      );
      if (idx === -1) return;

      const now = Date.now();
      const forkedMessages = activeConversation.messages
        .slice(0, idx + 1)
        .map((m, i) => ({
          ...m,
          id: `${now}-${String(i).padStart(4, '0')}-${Math.random().toString(36).slice(2, 6)}`,
          isStreaming: false,
        }));

      const forkedConv: Conversation = {
        id: createId(),
        title: `Branch: ${activeConversation.title}`,
        messages: forkedMessages,
        createdAt: now,
        updatedAt: now,
      };

      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        setCloudConversations((prev) => [forkedConv, ...prev]);
        setCloudMessagesById((prev) => ({
          ...prev,
          [forkedConv.id]: forkedMessages,
        }));
        setCloudActiveId(forkedConv.id);
        enqueueConvWrite(forkedConv.id, () =>
          saveBranchedConversationToFirestore(signedInUid, forkedConv),
        );
      } else {
        setLocalConversations((prev) => [forkedConv, ...prev]);
        setLocalActiveId(forkedConv.id);
      }
    },
    [activeConversation, enqueueConvWrite],
  );

  const handleEditUserMessage = useCallback(
    (userMsgId: string, newContent: string) => {
      if (!activeConversation || streamingConvId) return;
      const idx = activeConversation.messages.findIndex(
        (m) => m.id === userMsgId,
      );
      if (idx === -1) return;

      const convId = activeConversation.id;
      const updatedUser: ChatMessage = {
        ...activeConversation.messages[idx],
        content: newContent,
      };
      const priorPlusUpdated = [
        ...activeConversation.messages.slice(0, idx),
        updatedUser,
      ];
      const removedIds = activeConversation.messages
        .slice(idx + 1)
        .map((m) => m.id);
      const freshAssistant: ChatMessage = {
        id: createId(),
        role: 'assistant',
        content: '',
        searchMode,
        searchProgress:
          searchMode !== 'off'
            ? {
                stage: searchMode === 'deep' ? 'planning' : 'searching',
                queries: [newContent.slice(0, 120)],
                sourcesCount: 0,
              }
            : undefined,
        createdAt: Date.now() + 1,
        isStreaming: true,
      };

      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        setCloudMessagesById((prev) => ({
          ...prev,
          [convId]: [...priorPlusUpdated, freshAssistant],
        }));
        enqueueConvWrite(convId, async () => {
          await updateUserMessageContentInFirestore(
            signedInUid,
            convId,
            userMsgId,
            newContent,
          );
          await deleteConversationMessagesAfter(
            signedInUid,
            convId,
            removedIds,
          );
        });
      } else {
        setLocalConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: [...priorPlusUpdated, freshAssistant],
                }
              : c,
          ),
        );
      }

      runCompletion(convId, priorPlusUpdated, freshAssistant, searchMode);
    },
    [
      activeConversation,
      enqueueConvWrite,
      runCompletion,
      searchMode,
      streamingConvId,
    ],
  );

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        setCloudConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title } : c)),
        );
        enqueueConvWrite(id, () =>
          updateConversationMetaInFirestore(signedInUid, id, { title }),
        );
      } else {
        setLocalConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, title } : c)),
        );
      }
    },
    [enqueueConvWrite],
  );

  const handleTogglePinConversation = useCallback(
    (id: string) => {
      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        const target = cloudConversations.find((c) => c.id === id);
        const nextPinned = !target?.pinned;
        setCloudConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, pinned: nextPinned } : c)),
        );
        enqueueConvWrite(id, () =>
          updateConversationMetaInFirestore(signedInUid, id, {
            pinned: nextPinned,
          }),
        );
      } else {
        setLocalConversations((prev) =>
          prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
        );
      }
    },
    [cloudConversations, enqueueConvWrite],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (streamingConvId === id) {
        abortControllerRef.current?.abort();
      }
      const signedInUid = userRef.current?.uid;
      if (signedInUid) {
        setCloudConversations((prev) => prev.filter((c) => c.id !== id));
        setCloudMessagesById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        if (cloudActiveId === id) {
          setCloudActiveId(null);
          setPreviewArtifact(null);
        }
        enqueueConvWrite(id, () =>
          deleteConversationFromFirestore(signedInUid, id),
        );
      } else {
        setLocalConversations((prev) => prev.filter((c) => c.id !== id));
        if (localActiveId === id) {
          setLocalActiveId(null);
          setPreviewArtifact(null);
        }
      }
    },
    [cloudActiveId, enqueueConvWrite, localActiveId, streamingConvId],
  );

  const handleExportMarkdown = useCallback(() => {
    if (!activeConversation) return;
    const md = exportConversationMarkdown(activeConversation);
    const slug =
      activeConversation.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'chat';
    downloadFile(`${slug}.md`, md, 'text/markdown;charset=utf-8');
  }, [activeConversation]);

  const handleExportJson = useCallback(() => {
    if (!activeConversation) return;
    const json = exportConversationJson(activeConversation);
    const slug =
      activeConversation.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'chat';
    downloadFile(`${slug}.json`, json, 'application/json;charset=utf-8');
  }, [activeConversation]);

  const handleDragEnter = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const loaded: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 1_500_000) continue;
      try {
        const text = await readFileAsText(file);
        loaded.push({
          id: createId(),
          name: file.name,
          size: file.size,
          content: text,
        });
      } catch {
        // Ignore unreadable binary files
      }
    }
    if (loaded.length > 0) {
      setAttachments((prev) => [...prev, ...loaded]);
    }
  };

  const lastAssistantId = useMemo(() => {
    if (!activeConversation) return null;
    for (let i = activeConversation.messages.length - 1; i >= 0; i--) {
      if (activeConversation.messages[i].role === 'assistant') {
        return activeConversation.messages[i].id;
      }
    }
    return null;
  }, [activeConversation]);

  const primaryModel = useMemo(
    () => models.find((m) => m.id === 'deepseek-v4.1-flash-free'),
    [models],
  );
  const quotaMultiplier = primaryModel?.quota_multiplier ?? 1;
  const priceLabel = primaryModel?.price_label || '1x price';

  if (!authReady) {
    return (
      <div className="min-h-dvh w-full flex items-center justify-center bg-white dark:bg-[#141416] text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-2.5 text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-emerald-600 dark:border-t-emerald-400 animate-spin" />
          <span>Loading Ashutosh GPT…</span>
        </div>
      </div>
    );
  }

  if (!user && !guestMode) {
    return (
      <LoginScreen
        onGoogleSignIn={async () => {
          await signInWithGoogle();
        }}
        onContinueAsGuest={() => setGuestMode(true)}
      />
    );
  }

  return (
    <div className="flex app-shell-height w-full overflow-hidden bg-white dark:bg-[#171719] text-zinc-900 dark:text-zinc-100">
      <Sidebar
        isOpen={mobileSidebarOpen || desktopSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onCollapseDesktop={() => setDesktopSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={(id) => {
          setActiveId(id);
          setPreviewArtifact(null);
        }}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onTogglePinConversation={handleTogglePinConversation}
        onDeleteConversation={handleDeleteConversation}
        quota={quota}
        poolSummary={poolSummary}
        priceLabel={priceLabel}
        onOpenQuotaModal={() => setQuotaModalOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        user={user}
        isAdmin={isAdmin}
        onOpenAdminConsole={() => setAdminConsoleOpen(true)}
        onSignIn={handleSidebarSignIn}
        onSignOut={handleSignOut}
      />

      <main
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 flex flex-col min-w-0 h-full relative"
      >
        {/* Drag-and-drop overlay */}
        {isDraggingFile && (
          <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              Drop text or code files to attach
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Up to 1.5 MB per file · 198K context window
            </p>
          </div>
        )}

        {/* Top bar */}
        <header className="h-14 shrink-0 flex items-center justify-between px-3 sm:px-5 border-b border-zinc-200/80 dark:border-zinc-800/70 no-print">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>

            {!desktopSidebarOpen && (
              <div className="hidden md:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDesktopSidebarOpen(true)}
                  title="Open sidebar"
                  aria-label="Open sidebar"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <PanelLeftOpen className="w-4.5 h-4.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNewChat}
                  title="New chat"
                  aria-label="New chat"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <SquarePen className="w-4.5 h-4.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors min-w-0"
            >
              <span className="font-semibold text-[15px] tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                Ashutosh GPT
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate hidden sm:inline">
                deepseek-v4.1-flash-free
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setAdminConsoleOpen(true)}
                title="Open Admin Console (Users, Usage & API Keys)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              title="Search & commands (Ctrl/Cmd + K)"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Quick jump</span>
            </button>

            {activeConversation && activeConversation.messages.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((o) => !o)}
                  title="Export conversation"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </button>
                {exportMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setExportMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1.5 w-48 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1c1c1f] shadow-lg p-1 z-30">
                      <button
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExportMarkdown();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Markdown (.md)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          handleExportJson();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-zinc-400" />
                        <span>JSON (.json)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          setTimeout(() => window.print(), 80);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Print / Save PDF</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleNewChat}
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="New chat"
            >
              <SquarePen className="w-4.5 h-4.5" />
            </button>
          </div>
        </header>

        {/* Chat viewport */}
        {!activeConversation || activeConversation.messages.length === 0 ? (
          <div className="flex-1 flex flex-col justify-between overflow-y-auto px-4 sm:px-6 py-8">
            <div className="my-auto w-full max-w-3xl mx-auto space-y-8">
              <div className="text-center space-y-2.5">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 text-balance">
                  What can Ashutosh GPT help with?
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                  deepseek-v4.1-flash-free · Web Search &amp; Deep Research · 198K context
                </p>
              </div>

              <Composer
                value={input}
                onChange={setInput}
                attachments={attachments}
                onAddAttachments={(files) =>
                  setAttachments((prev) => [...prev, ...files])
                }
                onRemoveAttachment={(id) =>
                  setAttachments((prev) => prev.filter((a) => a.id !== id))
                }
                onSend={() => handleSend()}
                onStop={handleStop}
                isStreaming={isStreamingActive}
                contextTokensEstimate={contextTokensEstimate}
                searchMode={searchMode}
                onChangeSearchMode={setSearchMode}
                searchRecency={searchRecency}
                onChangeSearchRecency={setSearchRecency}
                responseStyle={responseStyle}
                onChangeResponseStyle={setResponseStyle}
                tone={tone}
                onChangeTone={setTone}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    onClick={() => {
                      if (item.searchMode) {
                        setSearchMode(item.searchMode);
                      }
                      handleSend(item.prompt, item.searchMode);
                    }}
                    className="text-left p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                      {item.subtitle}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-6"
            >
              <div className="max-w-3xl mx-auto space-y-6 pb-8">
                {activeConversation.messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    isLastAssistant={msg.id === lastAssistantId}
                    showFollowUps={settings.showFollowUps}
                    quotaMultiplier={quotaMultiplier}
                    onRegenerate={handleRegenerate}
                    onBranchFromMessage={handleBranchFromMessage}
                    onEditUserMessage={handleEditUserMessage}
                    onRetryError={handleRegenerate}
                    onPreviewArtifact={(artifact) => setPreviewArtifact(artifact)}
                    onQuickFollowUp={(prompt, modeOverride) => {
                      if (modeOverride) {
                        setSearchMode(modeOverride);
                      }
                      handleSend(prompt, modeOverride);
                    }}
                  />
                ))}
              </div>
            </div>

            {showScrollBottom && (
              <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10 no-print">
                <button
                  type="button"
                  onClick={() => {
                    userScrolledUpRef.current = false;
                    scrollToBottom('smooth');
                  }}
                  aria-label="Scroll to bottom"
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-md text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="shrink-0 px-4 sm:px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-white via-white to-white/80 dark:from-[#171719] dark:via-[#171719] dark:to-[#171719]/80">
              <Composer
                value={input}
                onChange={setInput}
                attachments={attachments}
                onAddAttachments={(files) =>
                  setAttachments((prev) => [...prev, ...files])
                }
                onRemoveAttachment={(id) =>
                  setAttachments((prev) => prev.filter((a) => a.id !== id))
                }
                onSend={() => handleSend()}
                onStop={handleStop}
                isStreaming={isStreamingActive}
                contextTokensEstimate={contextTokensEstimate}
                searchMode={searchMode}
                onChangeSearchMode={setSearchMode}
                searchRecency={searchRecency}
                onChangeSearchRecency={setSearchRecency}
                responseStyle={responseStyle}
                onChangeResponseStyle={setResponseStyle}
                tone={tone}
                onChangeTone={setTone}
              />
            </div>
          </>
        )}
      </main>

      <ArtifactPreview
        artifact={previewArtifact}
        onClose={() => setPreviewArtifact(null)}
      />

      <SettingsModal
        key={settingsOpen ? 'open' : 'closed'}
        isOpen={settingsOpen}
        isAdmin={isAdmin}
        authUser={user}
        settings={settings}
        keys={keyMetrics}
        poolSummary={poolSummary}
        quota={quota}
        onRefreshQuota={refreshQuota}
        onPoolUpdated={(payload) => {
          if (payload.quota) {
            setQuota((prev) => ({ ...prev, ...payload.quota }));
          }
          if (Array.isArray(payload.keys)) {
            setKeyMetrics(payload.keys);
          }
          if (payload.poolSummary) {
            setPoolSummary(payload.poolSummary);
          }
        }}
        onSave={(next) => {
          setSettings(next);
          saveSettings(next);
          setSearchMode(next.defaultSearchMode);
          setSearchRecency(next.searchRecency);
          setResponseStyle(next.responseStyle);
          setTone(next.tone);
        }}
        onClose={() => setSettingsOpen(false)}
      />

      <QuotaModal
        isOpen={quotaModalOpen}
        isAdmin={isAdmin}
        quota={quota}
        models={models}
        keys={keyMetrics}
        poolSummary={poolSummary}
        activeConversation={activeConversation}
        onRefreshQuota={refreshQuota}
        onClose={() => setQuotaModalOpen(false)}
      />

      {isAdmin && (
        <AdminDashboardModal
          isOpen={adminConsoleOpen}
          user={user}
          quota={quota}
          keys={keyMetrics}
          poolSummary={poolSummary}
          onRefreshQuota={refreshQuota}
          onPoolUpdated={(payload) => {
            if (payload.quota) {
              setQuota((prev) => ({ ...prev, ...payload.quota }));
            }
            if (Array.isArray(payload.keys)) {
              setKeyMetrics(payload.keys);
            }
            if (payload.poolSummary) {
              setPoolSummary(payload.poolSummary);
            }
          }}
          onClose={() => setAdminConsoleOpen(false)}
        />
      )}

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        conversations={conversations}
        activeConversation={activeConversation}
        theme={theme}
        isAdmin={isAdmin}
        onSelectConversation={(id) => {
          setActiveId(id);
          setPreviewArtifact(null);
        }}
        onNewChat={handleNewChat}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenQuota={() => setQuotaModalOpen(true)}
        onOpenAdminConsole={() => setAdminConsoleOpen(true)}
        onExportMarkdown={handleExportMarkdown}
        onExportJson={handleExportJson}
        onPrint={() => window.print()}
      />
    </div>
  );
}
