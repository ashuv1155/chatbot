import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import type {
  Conversation,
  KeyMetric,
  KeyStatus,
  ModelPricingInfo,
  PoolSummary,
  QuotaInfo,
  ServiceStatus,
} from '../types/chat';
import { formatCompactNumber, formatTimeUntilReset } from '../lib/storage';

interface QuotaModalProps {
  isOpen: boolean;
  quota: QuotaInfo;
  models: ModelPricingInfo[];
  keys: KeyMetric[];
  poolSummary: PoolSummary | null;
  activeConversation: Conversation | null;
  onRefreshQuota: () => Promise<void>;
  onClose: () => void;
}

function renderKeyStatus(status: KeyStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Active</span>
        </span>
      );
    case 'exhausted':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Exhausted</span>
        </span>
      );
    case 'rate_limited':
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Busy</span>
        </span>
      );
    case 'invalid':
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
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

export function QuotaModal({
  isOpen,
  quota,
  models,
  keys,
  poolSummary,
  activeConversation,
  onRefreshQuota,
  onClose,
}: QuotaModalProps) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const loadServiceStatus = async () => {
    setLoading(true);
    try {
      await onRefreshQuota();
      const res = await fetch('/api/service-status');
      if (res.ok) {
        const json = (await res.json()) as ServiceStatus;
        setStatus(json);
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadServiceStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const limit = quota.limit ?? 100_000_000;
  const remaining = quota.remaining ?? limit;
  const used = quota.used ?? Math.max(0, limit - remaining);
  const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  const primaryModel = models.find((m) => m.id === 'deepseek-v4.1-flash-free');
  const multiplier = primaryModel?.quota_multiplier ?? 1;

  const sessionTotals = (activeConversation?.messages || []).reduce(
    (acc, m) => {
      if (m.usage) {
        acc.prompt += m.usage.prompt_tokens;
        acc.completion += m.usage.completion_tokens;
        acc.total += m.usage.total_tokens;
      }
      return acc;
    },
    { prompt: 0, completion: 0, total: 0 },
  );
  const sessionQuotaCost = Math.round(sessionTotals.total * multiplier);
  const sessionPctOfDaily =
    limit > 0 ? ((sessionQuotaCost / limit) * 100).toFixed(4) : '0';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#19191c] shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              API Key Pool, Consumption &amp; Costing
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Aggregated consumption across all server-configured 100milionseek keys
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={loadServiceStatus}
              disabled={loading}
              title="Refresh all keys & status"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Overall Pool Consumption */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Overall Pool Consumption ({poolSummary?.totalKeys ?? keys.length}{' '}
                {(poolSummary?.totalKeys ?? keys.length) === 1 ? 'key' : 'keys'})
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                {pctUsed.toFixed(4)}% used
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.max(0, 100 - pctUsed)}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Total remaining
                </div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCompactNumber(remaining)}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                  {remaining.toLocaleString()}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Total used today
                </div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCompactNumber(used)}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                  {used.toLocaleString()}
                </div>
              </div>
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Healthy keys
                </div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {poolSummary?.activeKeys ?? 0} /{' '}
                  {poolSummary?.totalKeys ?? keys.length}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                  {poolSummary?.totalInFlight ?? 0} /{' '}
                  {poolSummary?.maxConcurrent ?? 5} streams
                </div>
              </div>
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Combined limit
                </div>
                <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {formatCompactNumber(limit)}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-zinc-400 mt-0.5">
                  Resets {formatTimeUntilReset(quota.resetAt)}
                </div>
              </div>
            </div>
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          {/* Per-Key Consumption & Metrics */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Per-Key Metrics &amp; Load Balancing
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Automatic 429 failover · Server-side env keys only
              </span>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums whitespace-nowrap">
                <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="px-3 py-2 font-medium">Key</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-right">Used</th>
                    <th className="px-3 py-2 font-medium text-right">
                      Remaining
                    </th>
                    <th className="px-3 py-2 font-medium text-right">Limit</th>
                    <th className="px-3 py-2 font-medium text-right">
                      Streams
                    </th>
                    <th className="px-3 py-2 font-medium text-right">
                      Reqs (OK)
                    </th>
                    <th className="px-3 py-2 font-medium text-right">QoS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                  {keys.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-4 text-center text-zinc-500"
                      >
                        Loading key pool metrics…
                      </td>
                    </tr>
                  ) : (
                    keys.map((k) => {
                      const kLimit = k.quotaLimit ?? 0;
                      const kUsed = k.quotaUsed ?? 0;
                      const kPct =
                        kLimit > 0
                          ? ((kUsed / kLimit) * 100).toFixed(2)
                          : '0.00';

                      return (
                        <tr
                          key={k.id}
                          className="hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                        >
                          <td className="px-3 py-2.5">
                            <div className="font-mono text-zinc-800 dark:text-zinc-200">
                              #{k.index} · {k.label}
                            </div>
                            {k.lastError && (
                              <div className="text-[10px] text-rose-500 truncate max-w-[180px]">
                                {k.lastError}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {renderKeyStatus(k.status)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-700 dark:text-zinc-300">
                            {k.quotaUsed !== null
                              ? `${formatCompactNumber(k.quotaUsed)} (${kPct}%)`
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                            {formatCompactNumber(k.quotaRemaining)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-500 dark:text-zinc-400">
                            {formatCompactNumber(k.quotaLimit)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                            {k.inFlight}/{k.maxConcurrent}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                            {k.requestsTotal} ({k.requestsOk})
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-zinc-500 dark:text-zinc-400">
                            {k.qos || '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
              To add or rotate 10+ keys, set{' '}
              <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                HMS_API_KEYS
              </code>{' '}
              (comma- or newline-separated) or{' '}
              <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[11px]">
                HMS_API_KEY_1..N
              </code>{' '}
              in your server environment (<code className="font-mono">.env</code>
              , Render, or Vercel). Keys stay server-side and are never exposed
              to the browser.
            </p>
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          {/* Live API Costing & Model Pricing */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                API Pricing &amp; Costing
              </span>
              <span className="font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                $0.00 / token (Free Allowance)
              </span>
            </div>

            {models.length > 0 && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Quota Rate</th>
                      <th className="px-3 py-2 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                    {models.map((model) => (
                      <tr key={model.id}>
                        <td className="px-3 py-2 font-mono text-zinc-800 dark:text-zinc-200">
                          {model.id}
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {model.price_label ||
                            `${model.quota_multiplier ?? 1}x quota`}
                        </td>
                        <td className="px-3 py-2 font-mono text-right text-zinc-900 dark:text-zinc-100">
                          $0.00
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeConversation && sessionTotals.total > 0 && (
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60 space-y-1.5 text-xs tabular-nums">
                <div className="flex items-center justify-between font-medium text-zinc-700 dark:text-zinc-200">
                  <span>Current Chat Costing</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    $0.00 · {sessionQuotaCost.toLocaleString()} quota tok
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                  <span>Prompt: {sessionTotals.prompt.toLocaleString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Completion: {sessionTotals.completion.toLocaleString()}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{sessionPctOfDaily}% of pool limit</span>
                </div>
              </div>
            )}
          </div>

          <hr className="border-zinc-200 dark:border-zinc-800" />

          {/* Live Network Status */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                100milionseek Network
              </span>
              {status?.state && (
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 capitalize">
                  Status: {status.state}
                </span>
              )}
            </div>

            {status ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">In-flight</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {status.sessions_in_flight?.toLocaleString() ?? '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">24h Speed</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {status.last_24h?.tokens_per_s
                      ? `${status.last_24h.tokens_per_s} tok/s`
                      : '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">24h Success</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {status.last_24h?.success_rate
                      ? `${(status.last_24h.success_rate * 100).toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">24h Requests</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatCompactNumber(status.last_24h?.requests)}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">Pool Capacity</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {poolSummary?.maxConcurrent ??
                      status.allowance?.session_limit ??
                      5}{' '}
                    streams
                  </div>
                </div>
                <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="text-[11px] text-zinc-500">Lifetime</div>
                  <div className="mt-0.5 font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatCompactNumber(status.lifetime_tokens)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-500 py-2">
                Loading live service metrics…
              </div>
            )}

            {status?.bonus?.daily_tokens && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Milestone bonus active:{' '}
                {formatCompactNumber(status.bonus.daily_tokens)} tokens/day
                until{' '}
                {status.bonus.ends_at
                  ? new Date(status.bonus.ends_at).toUTCString()
                  : 'scheduled end'}
                .
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
