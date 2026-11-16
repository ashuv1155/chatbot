import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  ExternalLink,
  Eye,
  FileAudio,
  FileText,
  FileVideo,
  GitBranch,
  Globe,
  Loader2,
  Pencil,
  RotateCcw,
  Square,
  Volume2,
} from 'lucide-react';
import type { ChatMessage, PreviewArtifact, SearchMode } from '../types/chat';
import { MarkdownRenderer } from './MarkdownRenderer';
import { attachmentToPreviewArtifact } from '../lib/previews';
import { formatCompactNumber } from '../lib/storage';
import {
  copyToClipboard,
  speakText,
  stopSpeaking,
  supportsSpeechSynthesis,
} from '../lib/browser';

interface MessageItemProps {
  message: ChatMessage;
  theme?: 'dark' | 'light';
  isLastAssistant: boolean;
  showFollowUps: boolean;
  quotaMultiplier: number;
  onRegenerate: (messageId: string) => void;
  onBranchFromMessage: (messageId: string) => void;
  onEditUserMessage: (messageId: string, newContent: string) => void;
  onRetryError: (messageId: string) => void;
  onPreviewArtifact: (artifact: PreviewArtifact) => void;
  onQuickFollowUp: (prompt: string, modeOverride?: SearchMode) => void;
}

function getSearchStageLabel(stage: string, sourcesCount: number, pagesRead?: number): string {
  switch (stage) {
    case 'planning':
      return 'Planning multi-angle research queries…';
    case 'searching':
      return 'Searching live web sources…';
    case 'reading':
      return `Found ${sourcesCount} sources · Reading full pages…`;
    case 'synthesizing':
      return `Synthesizing answer from ${sourcesCount} sources${pagesRead ? ` (${pagesRead} pages read)` : ''}…`;
    default:
      return 'Researching…';
  }
}

export function MessageItem({
  message,
  theme = 'dark',
  isLastAssistant,
  showFollowUps,
  quotaMultiplier,
  onRegenerate,
  onBranchFromMessage,
  onEditUserMessage,
  onRetryError,
  onPreviewArtifact,
  onQuickFollowUp,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const canSpeak = supportsSpeechSynthesis();

  useEffect(() => {
    return () => {
      if (isSpeaking) {
        stopSpeaking();
      }
    };
  }, [isSpeaking]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(message.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleToggleSpeak = () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    const started = speakText(
      message.content,
      () => setIsSpeaking(false),
      () => setIsSpeaking(false),
    );
    if (started) {
      setIsSpeaking(true);
    }
  };

  const handleSaveEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEditUserMessage(message.id, trimmed);
  };

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1.5">
        {isEditing ? (
          <div className="w-full max-w-xl rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  (e.metaKey || e.ctrlKey) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  handleSaveEdit();
                }
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setDraft(message.content);
                }
              }}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setDraft(message.content);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity"
              >
                Save &amp; Send
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 max-w-[85%] sm:max-w-[75%]">
                {message.attachments.map((att) => {
                  const previewArt = attachmentToPreviewArtifact(att);
                  if (att.kind === 'image' && att.previewUrl) {
                    return (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => previewArt && onPreviewArtifact(previewArt)}
                        title={`Preview ${att.name}`}
                        className="group/att overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-zinc-900 text-left cursor-zoom-in"
                      >
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          className="max-h-48 max-w-[260px] object-contain bg-white dark:bg-[#141416]"
                        />
                        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-300">
                          <span className="truncate max-w-[160px]">{att.name}</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            Preview
                          </span>
                        </div>
                      </button>
                    );
                  }
                  return (
                    <div
                      key={att.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/70 text-xs text-zinc-700 dark:text-zinc-300"
                    >
                      {att.kind === 'audio' ? (
                        <FileAudio className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : att.kind === 'video' ? (
                        <FileVideo className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      )}
                      <span className="truncate max-w-[180px]">{att.name}</span>
                      <span className="text-zinc-400 tabular-nums">
                        · {(att.size / 1024).toFixed(1)} KB
                      </span>
                      {previewArt && (
                        <button
                          type="button"
                          onClick={() => onPreviewArtifact(previewArt)}
                          title="Open preview"
                          className="ml-1 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 bg-zinc-100 dark:bg-[#2a2a2c] text-zinc-900 dark:text-zinc-100 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pr-1 no-print">
              {message.searchMode && message.searchMode !== 'off' && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {message.searchMode === 'deep' ? 'Deep Search' : 'Web Search'}
                </span>
              )}
              <button
                type="button"
                onClick={handleCopy}
                title="Copy message"
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(message.content);
                  setIsEditing(true);
                }}
                title="Edit & resend"
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  const activeSources = message.sources || [];
  const activeQueries =
    message.searchProgress?.queries || message.searchQueries || [];

  return (
    <div className="group flex items-start gap-3.5 sm:gap-4">
      <div
        className="w-7 h-7 rounded-full border border-zinc-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 flex items-center justify-center shrink-0 mt-0.5"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z" />
          <path d="M12 12l8-4.5" />
          <path d="M12 12v9" />
          <path d="M12 12L4 7.5" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        {/* Live Web Search / Deep Search Progress */}
        {message.isStreaming &&
          message.searchProgress &&
          message.searchProgress.stage !== 'done' && (
            <div className="mb-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/60 p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-200">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  {getSearchStageLabel(
                    message.searchProgress.stage,
                    message.searchProgress.sourcesCount,
                    message.searchProgress.pagesRead,
                  )}
                </span>
              </div>
              {activeQueries.length > 0 && (
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 space-y-0.5">
                  {activeQueries.map((q, i) => (
                    <div key={i} className="truncate font-mono">
                      · {q}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        {/* Completed Sources Card Strip */}
        {activeSources.length > 0 && (
          <div className="mb-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSources((s) => !s)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5">
                {message.searchMode === 'deep' ? (
                  <Compass className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>
                  Sources ({activeSources.length})
                </span>
                {activeQueries.length > 1 && (
                  <span className="text-[11px] font-normal text-zinc-400">
                    · {activeQueries.length} queries
                  </span>
                )}
              </span>
              {showSources ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </button>

            {showSources && (
              <div className="px-3 pb-2.5 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-zinc-200/70 dark:border-zinc-800/70">
                {activeSources.map((src, idx) => (
                  <a
                    key={src.url + idx}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={src.snippet || src.url}
                    className="group/src flex items-start justify-between gap-2 p-2 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover/src:text-emerald-600 dark:group-hover/src:text-emerald-400">
                        <span className="font-mono text-[11px] text-zinc-400 mr-1.5 tabular-nums">
                          [{idx + 1}]
                        </span>
                        {src.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                        {src.domain}
                        {src.fetchedExcerpt ? ' · full page read' : ''}
                      </div>
                    </div>
                    <ExternalLink className="w-3 h-3 text-zinc-400 shrink-0 mt-0.5" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {message.reasoning && (
          <div className="mb-3">
            <button
              type="button"
              onClick={() => setShowReasoning((s) => !s)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              {showReasoning ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>
                {message.isStreaming && !message.content
                  ? 'Reasoning…'
                  : 'Reasoning process'}
              </span>
            </button>
            {showReasoning && (
              <div className="mt-2 pl-3.5 border-l border-zinc-200 dark:border-zinc-800 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {message.error ? (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 p-3.5 text-sm text-rose-800 dark:text-rose-200">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div className="flex-1 space-y-2">
                <p className="leading-relaxed">{message.error}</p>
                <button
                  type="button"
                  onClick={() => onRetryError(message.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry request</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-[24px]">
            {message.content ? (
              <MarkdownRenderer
                content={message.content}
                theme={theme}
                sources={message.sources}
                onPreviewArtifact={onPreviewArtifact}
              />
            ) : message.isStreaming ? (
              <div className="flex items-center gap-1.5 py-2 text-zinc-400 dark:text-zinc-500 text-sm">
                <span className="inline-block w-2 h-4 bg-zinc-400 dark:bg-zinc-500 animate-pulse rounded-xs" />
              </div>
            ) : null}

            {message.isStreaming && message.content && (
              <span
                className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-emerald-500 animate-pulse rounded-xs"
                aria-hidden="true"
              />
            )}
          </div>
        )}

        {/* Action footer */}
        {!message.isStreaming && !message.error && (
          <div
            className={`mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 transition-opacity no-print ${
              isLastAssistant || isSpeaking
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={handleCopy}
              title="Copy response"
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Copied
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {canSpeak && (
              <button
                type="button"
                onClick={handleToggleSpeak}
                title={isSpeaking ? 'Stop reading' : 'Read aloud'}
                className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md transition-colors ${
                  isSpeaking
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                    : 'hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80'
                }`}
              >
                {isSpeaking ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Read</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              title="Regenerate response"
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Regenerate</span>
            </button>

            <button
              type="button"
              onClick={() => onBranchFromMessage(message.id)}
              title="Branch into a new conversation from here"
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Branch</span>
            </button>

            {message.aborted && (
              <span className="text-zinc-400 dark:text-zinc-500">
                · Stopped
              </span>
            )}

            {message.usage && (
              <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {formatCompactNumber(message.usage.prompt_tokens)} in ·{' '}
                {formatCompactNumber(message.usage.completion_tokens)} out ·{' '}
                {formatCompactNumber(
                  Math.round(message.usage.total_tokens * quotaMultiplier),
                )}{' '}
                quota · $0.00
              </span>
            )}
          </div>
        )}

        {/* Convenient 1-Click Follow-Up Actions on Latest Assistant Reply */}
        {isLastAssistant &&
          showFollowUps &&
          !message.isStreaming &&
          !message.error &&
          message.content && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 no-print">
              <button
                type="button"
                onClick={() =>
                  onQuickFollowUp(
                    'Summarize that much more concisely into key bullet points.',
                  )
                }
                className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                Make shorter
              </button>
              <button
                type="button"
                onClick={() =>
                  onQuickFollowUp(
                    'Go deeper on this with concrete examples and edge cases.',
                  )
                }
                className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                Go deeper
              </button>
              <button
                type="button"
                onClick={() =>
                  onQuickFollowUp(
                    'Explain this simply with an intuitive real-world analogy.',
                  )
                }
                className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
              >
                Explain simply
              </button>
              {message.searchMode !== 'deep' && (
                <button
                  type="button"
                  onClick={() =>
                    onQuickFollowUp(
                      'Verify and expand on the latest facts above with live citations.',
                      'web',
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe className="w-3 h-3" />
                  <span>Verify with Web</span>
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
