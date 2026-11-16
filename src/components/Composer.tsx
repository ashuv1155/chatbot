import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  ArrowUp,
  Compass,
  FileText,
  Globe,
  Mic,
  MicOff,
  Paperclip,
  Slash,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import type {
  Attachment,
  ResponseStyle,
  ResponseTone,
  SearchMode,
  SearchRecency,
} from '../types/chat';
import { estimateTokens, formatCompactNumber } from '../lib/storage';
import {
  createSpeechRecognition,
  readFileAsText,
  supportsSpeechRecognition,
  type SpeechRecognitionInstance,
} from '../lib/browser';

interface ComposerProps {
  value: string;
  onChange: (val: string) => void;
  attachments: Attachment[];
  onAddAttachments: (files: Attachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  contextTokensEstimate: number;
  searchMode: SearchMode;
  onChangeSearchMode: (mode: SearchMode) => void;
  searchRecency: SearchRecency;
  onChangeSearchRecency: (recency: SearchRecency) => void;
  responseStyle: ResponseStyle;
  onChangeResponseStyle: (style: ResponseStyle) => void;
  tone: ResponseTone;
  onChangeTone: (tone: ResponseTone) => void;
}

interface SlashCommand {
  command: string;
  label: string;
  template: string;
  switchSearchMode?: SearchMode;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/search',
    label: 'Enable live Web Search',
    template: '',
    switchSearchMode: 'web',
  },
  {
    command: '/deep',
    label: 'Enable multi-step Deep Search',
    template: '',
    switchSearchMode: 'deep',
  },
  {
    command: '/explain',
    label: 'Explain step-by-step',
    template: 'Explain how the following works step-by-step, highlighting edge cases:\n\n',
  },
  {
    command: '/eli5',
    label: 'Explain simply with analogies',
    template: 'Explain this clearly in plain language with everyday analogies:\n\n',
  },
  {
    command: '/review',
    label: 'Code & security review',
    template:
      'Review this code for bugs, race conditions, security issues, and maintainability improvements:\n\n',
  },
  {
    command: '/refactor',
    label: 'Refactor for clarity',
    template:
      'Refactor the following code to be cleaner, strictly typed, and easier to maintain:\n\n',
  },
  {
    command: '/sql',
    label: 'Write & optimize SQL',
    template:
      'Write a clean, well-indexed SQL query for the following requirement and explain the query plan:\n\n',
  },
  {
    command: '/table',
    label: 'Compare in a structured table',
    template:
      'Compare the pros, cons, trade-offs, and best use cases in a clear comparison table:\n\n',
  },
  {
    command: '/test',
    label: 'Generate unit tests',
    template:
      'Write thorough unit tests covering normal paths and edge cases for:\n\n',
  },
  {
    command: '/html',
    label: 'Build live HTML/SVG preview',
    template:
      'Create a self-contained single-file HTML/CSS/JS snippet in an ```html code block for:\n\n',
  },
  {
    command: '/email',
    label: 'Draft a clear professional email',
    template:
      'Draft a concise, well-structured email with a clear subject line for:\n\n',
  },
  {
    command: '/summarize',
    label: 'Concise bullet summary',
    template: 'Summarize the key points and action items concisely:\n\n',
  },
];

const STYLE_OPTIONS: Array<{ value: ResponseStyle; label: string }> = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'concise', label: 'Concise' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'step-by-step', label: 'Step-by-step' },
  { value: 'code-first', label: 'Code-first' },
];

const TONE_OPTIONS: Array<{ value: ResponseTone; label: string }> = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'technical', label: 'Technical' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'executive', label: 'Executive' },
];

const RECENCY_OPTIONS: Array<{ value: SearchRecency; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'day', label: 'Past 24h' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
];

const ACCEPTED_EXTENSIONS =
  '.txt,.md,.markdown,.json,.csv,.tsv,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.sql,.sh,.env,.log,.toml';

export function Composer({
  value,
  onChange,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onSend,
  onStop,
  isStreaming,
  contextTokensEstimate,
  searchMode,
  onChangeSearchMode,
  searchRecency,
  onChangeSearchRecency,
  responseStyle,
  onChangeResponseStyle,
  tone,
  onChangeTone,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const micSupported = supportsSpeechRecognition();

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const filteredCommands = value.startsWith('/')
    ? SLASH_COMMANDS.filter((c) =>
        c.command.startsWith(value.trim().toLowerCase()),
      )
    : SLASH_COMMANDS;

  const showSlashMenu =
    slashOpen ||
    (value.startsWith('/') &&
      !value.includes('\n') &&
      value.length < 16 &&
      filteredCommands.length > 0);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const applySlashCommand = (cmd: SlashCommand) => {
    if (cmd.switchSearchMode) {
      onChangeSearchMode(cmd.switchSearchMode);
      onChange('');
    } else {
      onChange(cmd.template);
    }
    setSlashOpen(false);
    setSlashIndex(0);
    requestAnimationFrame(() => {
      adjustHeight();
      textareaRef.current?.focus();
    });
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    if (!next.startsWith('/')) {
      setSlashOpen(false);
    }
    setSlashIndex(0);
    requestAnimationFrame(adjustHeight);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(
          (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const picked =
          filteredCommands[Math.min(slashIndex, filteredCommands.length - 1)];
        if (picked) applySlashCommand(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (value.trim() || attachments.length > 0)) {
        setOptionsOpen(false);
        onSend();
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      }
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const loaded: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 1_500_000) continue;
      try {
        const text = await readFileAsText(file);
        loaded.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          content: text,
        });
      } catch {
        // Ignore unreadable binary files
      }
    }
    if (loaded.length > 0) {
      onAddAttachments(loaded);
    }
    e.target.value = '';
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = createSpeechRecognition();
    if (!recognition) return;

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    let currentText = value;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) {
        currentText = currentText
          ? `${currentText.trimEnd()} ${transcript.trim()}`
          : transcript.trim();
        onChange(currentText);
        requestAnimationFrame(adjustHeight);
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const draftTokens =
    estimateTokens(value) +
    attachments.reduce((sum, a) => sum + estimateTokens(a.content), 0);
  const totalEstimated = contextTokensEstimate + draftTokens;
  const canSend =
    !isStreaming && (value.trim().length > 0 || attachments.length > 0);

  const hasCustomOptions =
    responseStyle !== 'balanced' ||
    tone !== 'neutral' ||
    (searchMode !== 'off' && searchRecency !== 'any');

  const placeholderText =
    searchMode === 'deep'
      ? 'Ask Ashutosh GPT to deep-research any topic…'
      : searchMode === 'web'
        ? 'Search the live web with Ashutosh GPT…'
        : 'Message Ashutosh GPT (type / for templates)…';

  return (
    <div className="w-full max-w-3xl mx-auto relative no-print">
      {/* Slash Command Menu */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div
          role="listbox"
          aria-label="Prompt templates"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1b1b1e] shadow-xl overflow-hidden z-20"
        >
          <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-medium text-zinc-400">
            Prompt Templates &amp; Modes
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredCommands.map((cmd, idx) => {
              const active =
                idx === Math.min(slashIndex, filteredCommands.length - 1);
              return (
                <button
                  key={cmd.command}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setSlashIndex(idx)}
                  onClick={() => applySlashCommand(cmd)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors ${
                    active
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                    {cmd.command}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {cmd.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Convenient Chat Options Popover */}
      {optionsOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOptionsOpen(false)}
          />
          <div className="absolute bottom-full right-0 mb-2 w-full sm:w-[360px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#1b1b1e] shadow-xl p-3.5 space-y-3.5 z-20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                Chat &amp; Search Options
              </span>
              <button
                type="button"
                onClick={() => {
                  onChangeResponseStyle('balanced');
                  onChangeTone('neutral');
                  onChangeSearchRecency('any');
                }}
                className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                Reset
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Response Style
              </div>
              <div className="flex flex-wrap gap-1">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChangeResponseStyle(opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      responseStyle === opt.value
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Tone
              </div>
              <div className="flex flex-wrap gap-1">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChangeTone(opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      tone === opt.value
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {searchMode !== 'off' && (
              <div className="space-y-1.5 pt-1 border-t border-zinc-200 dark:border-zinc-800">
                <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  Search Timeframe
                </div>
                <div className="flex flex-wrap gap-1">
                  {RECENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onChangeSearchRecency(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        searchRecency === opt.value
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-50 dark:bg-[#212124] shadow-sm focus-within:border-zinc-400 dark:focus-within:border-zinc-500 transition-colors">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3.5 pt-3">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-200"
              >
                <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span className="truncate max-w-[160px]">{att.name}</span>
                <span className="text-zinc-400 tabular-nums">
                  {(att.size / 1024).toFixed(1)}KB
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.id)}
                  aria-label={`Remove ${att.name}`}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={placeholderText}
          aria-label="Message input"
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none max-h-[200px]"
        />

        <div className="flex flex-wrap items-center justify-between px-3 pb-2.5 pt-1 gap-2">
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_EXTENSIONS}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach text, code, markdown, or CSV files"
              className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Paperclip className="w-4 h-4" />
              <span className="hidden md:inline">Attach</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeSearchMode(searchMode === 'web' ? 'off' : 'web')
              }
              title="Toggle live Web Search"
              aria-pressed={searchMode === 'web'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                searchMode === 'web'
                  ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 border border-transparent'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Web Search</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onChangeSearchMode(searchMode === 'deep' ? 'off' : 'deep')
              }
              title="Multi-query Deep Search & page analysis"
              aria-pressed={searchMode === 'deep'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                searchMode === 'deep'
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Deep Search</span>
            </button>

            <button
              type="button"
              onClick={() => setSlashOpen((o) => !o)}
              title="Prompt templates (/)"
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                showSlashMenu
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <Slash className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Prompts</span>
            </button>

            <button
              type="button"
              onClick={() => setOptionsOpen((o) => !o)}
              title="Response style, tone & search timeframe"
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                optionsOpen || hasCustomOptions
                  ? 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden md:inline">
                {responseStyle !== 'balanced'
                  ? STYLE_OPTIONS.find((s) => s.value === responseStyle)?.label
                  : 'Options'}
              </span>
            </button>

            {micSupported && (
              <button
                type="button"
                onClick={toggleVoiceInput}
                title={isListening ? 'Stop voice dictation' : 'Voice dictation'}
                aria-label={
                  isListening ? 'Stop voice dictation' : 'Voice dictation'
                }
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isListening
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
                }`}
              >
                {isListening ? (
                  <MicOff className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {totalEstimated > 0 && (
              <span className="hidden sm:inline text-[11px] font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
                ~{formatCompactNumber(totalEstimated)} / 198K
              </span>
            )}

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop generating"
                aria-label="Stop generating"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSend}
                onClick={() => {
                  setOptionsOpen(false);
                  onSend();
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                  }
                }}
                title="Send message"
                aria-label="Send message"
                className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                  canSend
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90'
                    : 'bg-zinc-200 text-zinc-400 dark:bg-zinc-700/60 dark:text-zinc-500 cursor-not-allowed'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
        Ashutosh GPT · Paste URLs or enable Web/Deep Search · Shift+Enter for new line
      </p>
    </div>
  );
}
