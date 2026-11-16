import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ChatSettings,
  KeyMetric,
  KeyStatus,
  PoolSummary,
  QuotaInfo,
} from '../types/chat';
import { DEFAULT_SETTINGS, formatCompactNumber } from '../lib/storage';

interface SettingsModalProps {
  isOpen: boolean;
  settings: ChatSettings;
  keys: KeyMetric[];
  poolSummary: PoolSummary | null;
  quota: QuotaInfo;
  onRefreshQuota: () => Promise<void>;
  onPoolUpdated: (payload: {
    quota?: QuotaInfo;
    keys?: KeyMetric[];
    poolSummary?: PoolSummary;
  }) => void;
  onSave: (next: ChatSettings) => void;
  onClose: () => void;
}

const SYSTEM_PRESETS = [
  {
    label: 'Default',
    prompt: '',
  },
  {
    label: 'Senior Engineer',
    prompt:
      'You are a pragmatic senior software engineer. Give direct, production-ready answers with clean TypeScript/code examples, edge-case awareness, and concise explanations.',
  },
  {
    label: 'Concise Editor',
    prompt:
      'Be crisp, clear, and concise. Avoid filler, preamble, or unnecessary repetition. Use bullet points and short paragraphs.',
  },
  {
    label: 'Data & SQL',
    prompt:
      'You are a staff data engineer specializing in SQL, query optimization, and analytics modeling. Provide accurate, well-indexed SQL and clear schema reasoning.',
  },
];

function renderStatusLabel(status: KeyStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Active</span>
        </span>
      );
    case 'exhausted':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Exhausted</span>
        </span>
      );
    case 'rate_limited':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Busy</span>
        </span>
      );
    case 'invalid':
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{status === 'invalid' ? 'Invalid' : 'Error'}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-zinc-500">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Pending</span>
        </span>
      );
  }
}

export function SettingsModal({
  isOpen,
  settings,
  keys,
  poolSummary,
  quota,
  onRefreshQuota,
  onPoolUpdated,
  onSave,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'model' | 'keys'>('model');
  const [draft, setDraft] = useState<ChatSettings>(settings);

  const [bulkInput, setBulkInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const detectedCount = useMemo(() => {
    const parts = bulkInput
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(parts).size;
  }, [bulkInput]);

  if (!isOpen) return null;

  const totalKeys = poolSummary?.totalKeys ?? keys.length;
  const remainingCapacity = Math.max(0, 100 - totalKeys);
  const settingsAddedCount = keys.filter((k) => k.source === 'settings').length;

  const handleAddKeys = async () => {
    if (!bulkInput.trim() || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: bulkInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: data?.error?.message || 'Failed to add API keys.',
        });
        return;
      }
      onPoolUpdated(data);
      setBulkInput('');
      const parts: string[] = [`Added ${data.added} key${data.added === 1 ? '' : 's'}`];
      if (data.duplicatesSkipped > 0) {
        parts.push(`${data.duplicatesSkipped} duplicate${data.duplicatesSkipped === 1 ? '' : 's'} skipped`);
      }
      if (data.capReached) {
        parts.push('100-key pool limit reached');
      }
      setFeedback({ type: 'success', text: `${parts.join(' · ')}.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error adding keys.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: data?.error?.message || 'Failed to remove key.',
        });
        return;
      }
      onPoolUpdated(data);
      setFeedback({ type: 'success', text: `Removed ${data.removed}.` });
    } catch {
      setFeedback({ type: 'error', text: 'Network error removing key.' });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAdded = async () => {
    if (busy || settingsAddedCount === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/keys', { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        onPoolUpdated(data);
        setFeedback({
          type: 'success',
          text: 'Cleared all settings-added API keys.',
        });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Failed to clear keys.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshPool = async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onRefreshQuota();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#19191c] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 gap-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setActiveTab('model')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'model'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Model &amp; Prompt</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('keys')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'keys'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>API Keys Pool ({totalKeys}/100)</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeTab === 'model' ? (
          <>
            <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    System Prompt
                  </label>
                  <div className="flex flex-wrap items-center gap-1">
                    {SYSTEM_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({ ...d, systemPrompt: preset.prompt }))
                        }
                        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                          draft.systemPrompt === preset.prompt
                            ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                            : 'bg-zinc-100 text-zinc-600 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={draft.systemPrompt}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, systemPrompt: e.target.value }))
                  }
                  rows={4}
                  placeholder="Optional instructions applied to every message..."
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/90 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor="temp-slider"
                    className="font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Temperature
                  </label>
                  <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                    {draft.temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  id="temp-slider"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={draft.temperature}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      temperature: Number(e.target.value),
                    }))
                  }
                  className="w-full seek-range cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-zinc-400">
                  <span>0.0 Precise</span>
                  <span>0.7 Balanced</span>
                  <span>1.5 Creative</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor="max-tokens-slider"
                    className="font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Max Output Tokens
                  </label>
                  <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                    {draft.maxTokens.toLocaleString()}
                  </span>
                </div>
                <input
                  id="max-tokens-slider"
                  type="range"
                  min={1024}
                  max={65536}
                  step={1024}
                  value={draft.maxTokens}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      maxTokens: Number(e.target.value),
                    }))
                  }
                  className="w-full seek-range cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-zinc-400 tabular-nums">
                  <span>1,024</span>
                  <span>32,768</span>
                  <span>65,536 (64K max)</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Stream responses
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Receive tokens live as they are generated
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.stream}
                  onClick={() =>
                    setDraft((d) => ({ ...d, stream: !d.stream }))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    draft.stream
                      ? 'bg-emerald-600'
                      : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      draft.stream ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_SETTINGS)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset defaults</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSave(draft);
                    onClose();
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity"
                >
                  Save changes
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-5 space-y-5 max-h-[76vh] overflow-y-auto">
            {/* Pool totals strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
              <div className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500">Configured</div>
                <div className="mt-0.5 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {totalKeys} / 100 keys
                </div>
              </div>
              <div className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500">Remaining</div>
                <div className="mt-0.5 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatCompactNumber(quota.remaining)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500">Used today</div>
                <div className="mt-0.5 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatCompactNumber(quota.used)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500">Stream slots</div>
                <div className="mt-0.5 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                  {poolSummary?.totalInFlight ?? 0} /{' '}
                  {poolSummary?.maxConcurrent ?? totalKeys * 5}
                </div>
              </div>
            </div>

            {/* Bulk Add up to 100 keys */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="bulk-keys-input"
                  className="font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Add API Keys (up to {remainingCapacity} more slots available)
                </label>
                {detectedCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                    {detectedCount} unique key{detectedCount === 1 ? '' : 's'}{' '}
                    ready
                  </span>
                )}
              </div>
              <textarea
                id="bulk-keys-input"
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                rows={4}
                disabled={remainingCapacity === 0 || busy}
                placeholder={
                  remainingCapacity === 0
                    ? 'Maximum 100 API keys reached. Remove keys below to add new ones.'
                    : 'Paste up to 100 hms-... API keys separated by new lines, commas, or spaces...'
                }
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/90 px-3.5 py-2.5 font-mono text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Keys are saved on the server and masked immediately. Requests
                  auto-balance and fail over on 429 limits.
                </p>
                <button
                  type="button"
                  disabled={
                    busy || detectedCount === 0 || remainingCapacity === 0
                  }
                  onClick={handleAddKeys}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{busy ? 'Probing keys…' : 'Add to Pool'}</span>
                </button>
              </div>
            </div>

            {feedback && (
              <div
                className={`px-3.5 py-2.5 rounded-xl text-xs border ${
                  feedback.type === 'success'
                    ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                    : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                }`}
              >
                {feedback.text}
              </div>
            )}

            {/* Configured Keys List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Configured Pool ({keys.length})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRefreshPool}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`}
                    />
                    <span>Refresh</span>
                  </button>
                  {settingsAddedCount > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleClearAdded}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear added ({settingsAddedCount})</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-60 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800/80">
                {keys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between px-3 py-2 text-xs gap-3 tabular-nums"
                  >
                    <div className="min-w-0 flex items-center gap-2.5">
                      <span className="font-mono text-zinc-800 dark:text-zinc-200">
                        #{k.index} · {k.label}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {k.source === 'env' ? 'env' : 'added'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="hidden sm:inline font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {formatCompactNumber(k.quotaUsed)} used ·{' '}
                        {formatCompactNumber(k.quotaRemaining)} left
                      </span>
                      {renderStatusLabel(k.status)}
                      {k.source === 'settings' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDeleteKey(k.id)}
                          title="Remove key"
                          aria-label={`Remove key ${k.label}`}
                          className="p-1 rounded-md text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
