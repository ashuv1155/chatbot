import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type {
  AdminUsageLog,
  AdminUserUsage,
  KeyMetric,
  KeyStatus,
  PoolSummary,
  QuotaInfo,
  ServerLiveUserMetric,
} from '../types/chat';
import {
  subscribeAllUsersForAdmin,
  subscribeUsageLogsForAdmin,
} from '../lib/firebase';
import { ADMIN_EMAIL, getAuthHeaders } from '../lib/admin';
import { downloadFile } from '../lib/browser';
import { formatCompactNumber, formatTimeUntilReset } from '../lib/storage';

interface AdminDashboardModalProps {
  isOpen: boolean;
  user: User | null;
  quota: QuotaInfo;
  keys: KeyMetric[];
  poolSummary: PoolSummary | null;
  onRefreshQuota: () => Promise<void>;
  onPoolUpdated: (payload: {
    quota?: QuotaInfo;
    keys?: KeyMetric[];
    poolSummary?: PoolSummary;
  }) => void;
  onClose: () => void;
}

type AdminTab = 'users' | 'logs' | 'keys';
type UserSortKey = 'total' | 'today' | 'active' | 'requests' | 'chats';

function formatRelativeTime(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '—';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function formatDateTime(ms: number): string {
  if (!ms || Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatModeLabel(mode?: string): string {
  if (mode === 'deep') return 'Deep Search';
  if (mode === 'web') return 'Web Search';
  return 'Direct Chat';
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

export function AdminDashboardModal({
  isOpen,
  user,
  quota,
  keys,
  poolSummary,
  onRefreshQuota,
  onPoolUpdated,
  onClose,
}: AdminDashboardModalProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUserUsage[]>([]);
  const [logs, setLogs] = useState<AdminUsageLog[]>([]);
  const [liveServerUsers, setLiveServerUsers] = useState<
    ServerLiveUserMetric[]
  >([]);
  const [serverUptimeSec, setServerUptimeSec] = useState<number | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const [userSearch, setUserSearch] = useState('');
  const [userSort, setUserSort] = useState<UserSortKey>('total');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const [logSearch, setLogSearch] = useState('');
  const [logModeFilter, setLogModeFilter] = useState<'all' | 'off' | 'web' | 'deep'>('all');

  const [bulkInput, setBulkInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchServerStats = useCallback(async () => {
    if (!user) return;
    try {
      const headers = await getAuthHeaders(user);
      const res = await fetch('/api/admin/server-stats', { headers });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.liveUsers)) {
          setLiveServerUsers(json.liveUsers as ServerLiveUserMetric[]);
        }
        if (typeof json.uptimeSeconds === 'number') {
          setServerUptimeSec(json.uptimeSeconds);
        }
        onPoolUpdated({
          quota: json.quota,
          keys: json.keys,
          poolSummary: json.poolSummary,
        });
      }
    } catch {
      // Ignore transient network errors
    }
  }, [onPoolUpdated, user]);

  useEffect(() => {
    if (!isOpen || !user) return;
    setLoadingData(true);
    setDataError(null);

    let usersLoaded = false;
    let logsLoaded = false;
    const markDone = () => {
      if (usersLoaded && logsLoaded) setLoadingData(false);
    };

    const unsubUsers = subscribeAllUsersForAdmin(
      (list) => {
        setUsers(list);
        usersLoaded = true;
        markDone();
      },
      (err) => {
        setDataError(err.message);
        usersLoaded = true;
        markDone();
      },
    );

    const unsubLogs = subscribeUsageLogsForAdmin(
      (items) => {
        setLogs(items);
        logsLoaded = true;
        markDone();
      },
      (err) => {
        setDataError(err.message);
        logsLoaded = true;
        markDone();
      },
      150,
    );

    fetchServerStats();

    return () => {
      unsubUsers();
      unsubLogs();
    };
  }, [fetchServerStats, isOpen, user]);

  const todayUtc = new Date().toISOString().slice(0, 10);

  const getDailyTokens = useCallback(
    (u: AdminUserUsage) => (u.usageDate === todayUtc ? u.dailyTokensUsed : 0),
    [todayUtc],
  );

  const totals = useMemo(() => {
    return users.reduce(
      (acc, u) => {
        acc.totalTokens += u.totalTokensUsed;
        acc.todayTokens += getDailyTokens(u);
        acc.requests += u.totalRequests;
        acc.web += u.webSearchCount;
        acc.deep += u.deepSearchCount;
        acc.chats += u.conversationsCount;
        return acc;
      },
      {
        totalTokens: 0,
        todayTokens: 0,
        requests: 0,
        web: 0,
        deep: 0,
        chats: 0,
      },
    );
  }, [getDailyTokens, users]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const matched = users.filter((u) => {
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    });

    return [...matched].sort((a, b) => {
      switch (userSort) {
        case 'today':
          return getDailyTokens(b) - getDailyTokens(a);
        case 'active':
          return b.lastActiveAt - a.lastActiveAt;
        case 'requests':
          return b.totalRequests - a.totalRequests;
        case 'chats':
          return b.conversationsCount - a.conversationsCount;
        case 'total':
        default:
          return b.totalTokensUsed - a.totalTokensUsed;
      }
    });
  }, [getDailyTokens, userSearch, userSort, users]);

  const selectedUser = useMemo(
    () => users.find((u) => u.uid === selectedUid) || filteredUsers[0] || null,
    [filteredUsers, selectedUid, users],
  );

  const selectedUserLogs = useMemo(() => {
    if (!selectedUser) return [];
    return logs.filter((l) => l.userId === selectedUser.uid).slice(0, 10);
  }, [logs, selectedUser]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((l) => {
      if (logModeFilter !== 'all' && l.searchMode !== logModeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        l.userName.toLowerCase().includes(q) ||
        l.userEmail.toLowerCase().includes(q) ||
        l.model.toLowerCase().includes(q)
      );
    });
  }, [logModeFilter, logSearch, logs]);

  const detectedKeyCount = useMemo(() => {
    const parts = bulkInput
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(parts).size;
  }, [bulkInput]);

  if (!isOpen) return null;

  const poolLimit = quota.limit ?? 100_000_000;
  const poolUsed = quota.used ?? 0;
  const totalKeys = poolSummary?.totalKeys ?? keys.length;
  const remainingCapacity = Math.max(0, 100 - totalKeys);
  const settingsAddedCount = keys.filter((k) => k.source === 'settings').length;

  const handleRefreshAll = async () => {
    setLoadingData(true);
    await Promise.all([onRefreshQuota(), fetchServerStats()]);
    setLoadingData(false);
  };

  const handleExportUsersCsv = () => {
    const header = [
      'UID',
      'Name',
      'Email',
      'TodayTokensUTC',
      'TotalTokens',
      'PromptTokens',
      'CompletionTokens',
      'Requests',
      'WebSearches',
      'DeepSearches',
      'Conversations',
      'LastModel',
      'LastSearchMode',
      'JoinedAt',
      'LastActiveAt',
    ].join(',');
    const rows = filteredUsers.map((u) =>
      [
        u.uid,
        `"${u.displayName.replace(/"/g, '""')}"`,
        `"${u.email.replace(/"/g, '""')}"`,
        getDailyTokens(u),
        u.totalTokensUsed,
        u.promptTokensUsed,
        u.completionTokensUsed,
        u.totalRequests,
        u.webSearchCount,
        u.deepSearchCount,
        u.conversationsCount,
        u.lastModelUsed || '',
        u.lastSearchMode || '',
        new Date(u.createdAt).toISOString(),
        new Date(u.lastActiveAt).toISOString(),
      ].join(','),
    );
    downloadFile(
      `ashutosh-gpt-users-${todayUtc}.csv`,
      [header, ...rows].join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const handleExportLogsCsv = () => {
    const header = [
      'Timestamp',
      'UserName',
      'UserEmail',
      'UserId',
      'Model',
      'SearchMode',
      'Style',
      'Tone',
      'PromptTokens',
      'CompletionTokens',
      'TotalTokens',
      'Sources',
      'Status',
    ].join(',');
    const rows = filteredLogs.map((l) =>
      [
        new Date(l.createdAt).toISOString(),
        `"${l.userName.replace(/"/g, '""')}"`,
        `"${l.userEmail.replace(/"/g, '""')}"`,
        l.userId,
        l.model,
        l.searchMode,
        l.responseStyle || '',
        l.tone || '',
        l.promptTokens,
        l.completionTokens,
        l.totalTokens,
        l.sourcesCount ?? 0,
        l.status,
      ].join(','),
    );
    downloadFile(
      `ashutosh-gpt-usage-logs-${todayUtc}.csv`,
      [header, ...rows].join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  const handleAddKeys = async () => {
    if (!bulkInput.trim() || keyBusy || !user) return;
    setKeyBusy(true);
    setKeyFeedback(null);
    try {
      const headers = await getAuthHeaders(user);
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ keys: bulkInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyFeedback({
          type: 'error',
          text: data?.error?.message || 'Failed to add API keys.',
        });
        return;
      }
      onPoolUpdated(data);
      setBulkInput('');
      setKeyFeedback({
        type: 'success',
        text: `Added ${data.added} key${data.added === 1 ? '' : 's'} to the common pool.`,
      });
    } catch (err) {
      setKeyFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error adding keys.',
      });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (keyBusy || !user) return;
    setKeyBusy(true);
    setKeyFeedback(null);
    try {
      const headers = await getAuthHeaders(user);
      const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyFeedback({
          type: 'error',
          text: data?.error?.message || 'Failed to remove key.',
        });
        return;
      }
      onPoolUpdated(data);
      setKeyFeedback({ type: 'success', text: `Removed ${data.removed}.` });
    } catch {
      setKeyFeedback({ type: 'error', text: 'Network error removing key.' });
    } finally {
      setKeyBusy(false);
    }
  };

  const handleClearAdded = async () => {
    if (keyBusy || settingsAddedCount === 0 || !user) return;
    setKeyBusy(true);
    setKeyFeedback(null);
    try {
      const headers = await getAuthHeaders(user);
      const res = await fetch('/api/keys', { method: 'DELETE', headers });
      const data = await res.json();
      if (res.ok) {
        onPoolUpdated(data);
        setKeyFeedback({
          type: 'success',
          text: 'Cleared all settings-added API keys.',
        });
      }
    } catch {
      setKeyFeedback({ type: 'error', text: 'Failed to clear keys.' });
    } finally {
      setKeyBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#161618] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                Admin Console
              </h2>
              <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 truncate">
                <span>Ashutosh Temgire</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{ADMIN_EMAIL}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'users'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Users ({users.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'logs'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Usage Logs</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('keys')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  activeTab === 'keys'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>API Keys ({totalKeys}/100)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={loadingData}
              title="Refresh all metrics"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close admin console"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {dataError && (
            <div className="px-3.5 py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-200">
              {dataError}
            </div>
          )}

          {/* Global KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Registered Users
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {users.length}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">
                {totals.chats.toLocaleString()} total chats
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Common Pool Used Today
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {formatCompactNumber(poolUsed)}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">
                {formatCompactNumber(quota.remaining)} left · Resets{' '}
                {formatTimeUntilReset(quota.resetAt)}
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Tracked User Tokens
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {formatCompactNumber(totals.totalTokens)}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">
                {formatCompactNumber(totals.todayTokens)} today (UTC)
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Requests &amp; Searches
              </div>
              <div className="mt-1 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {totals.requests.toLocaleString()}
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono">
                {totals.web} web · {totals.deep} deep
              </div>
            </div>
          </div>

          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Filter & Actions Row */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Filter users by name, email, or UID..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={userSort}
                    onChange={(e) => setUserSort(e.target.value as UserSortKey)}
                    aria-label="Sort users"
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-200 focus:outline-none"
                  >
                    <option value="total">Sort: Lifetime Tokens</option>
                    <option value="today">Sort: Used Today</option>
                    <option value="active">Sort: Last Active</option>
                    <option value="requests">Sort: Total Requests</option>
                    <option value="chats">Sort: Conversations</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleExportUsersCsv}
                    disabled={filteredUsers.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              {/* Users Table */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums whitespace-nowrap">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">User</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Today (UTC)
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Lifetime Tokens
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Requests
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Web / Deep
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Chats
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Last Active
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                    {loadingData && users.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-8 text-center text-zinc-500"
                        >
                          Loading user usage metrics…
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-8 text-center text-zinc-500"
                        >
                          {userSearch
                            ? 'No users match this filter.'
                            : 'No signed-in users recorded yet.'}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelected = selectedUser?.uid === u.uid;
                        const isRootAdmin =
                          u.email.trim().toLowerCase() === ADMIN_EMAIL;
                        const dailyTok = getDailyTokens(u);

                        return (
                          <tr
                            key={u.uid}
                            onClick={() => setSelectedUid(u.uid)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-zinc-100/90 dark:bg-zinc-800/70'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                            }`}
                          >
                            <td className="px-3.5 py-2.5">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {u.photoURL ? (
                                  <img
                                    src={u.photoURL}
                                    alt={u.displayName}
                                    referrerPolicy="no-referrer"
                                    className="w-7 h-7 rounded-full object-cover shrink-0 border border-zinc-200 dark:border-zinc-700"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold flex items-center justify-center shrink-0">
                                    {(u.displayName || u.email || 'U')[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                                    <span className="truncate max-w-[180px]">
                                      {u.displayName}
                                    </span>
                                    {isRootAdmin && (
                                      <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                        · Admin
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-[220px]">
                                    {u.email || u.uid}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono text-zinc-900 dark:text-zinc-100 font-medium">
                              {dailyTok.toLocaleString()}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono text-zinc-700 dark:text-zinc-300">
                              {u.totalTokensUsed.toLocaleString()}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono text-zinc-700 dark:text-zinc-300">
                              {u.totalRequests.toLocaleString()}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono text-zinc-500 dark:text-zinc-400">
                              {u.webSearchCount} / {u.deepSearchCount}
                            </td>
                            <td className="px-3.5 py-2.5 text-right font-mono text-zinc-700 dark:text-zinc-300">
                              {u.conversationsCount}
                            </td>
                            <td className="px-3.5 py-2.5 text-right text-zinc-500 dark:text-zinc-400">
                              {formatRelativeTime(u.lastActiveAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Selected User Detailed Inspector */}
              {selectedUser && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4 bg-zinc-50/40 dark:bg-zinc-900/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {selectedUser.displayName}
                      </div>
                      <div className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {selectedUser.email || 'No email'} · UID: {selectedUser.uid}
                      </div>
                    </div>
                    <div className="text-right text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
                      <div>Joined {formatDateTime(selectedUser.createdAt)}</div>
                      <div>Last active {formatDateTime(selectedUser.lastActiveAt)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1 text-xs tabular-nums border-t border-zinc-200/80 dark:border-zinc-800/80">
                    <div>
                      <div className="text-[11px] text-zinc-500">Prompt Tokens</div>
                      <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                        {selectedUser.promptTokensUsed.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">
                        Completion Tokens
                      </div>
                      <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                        {selectedUser.completionTokensUsed.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">
                        Pool Share Today
                      </div>
                      <div className="font-mono font-semibold text-zinc-900 dark:text-zinc-100 mt-0.5">
                        {poolLimit > 0
                          ? `${((getDailyTokens(selectedUser) / poolLimit) * 100).toFixed(4)}%`
                          : '0%'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">Last Mode</div>
                      <div className="font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">
                        {formatModeLabel(selectedUser.lastSearchMode)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">Costing</div>
                      <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        $0.00 (Free Pool)
                      </div>
                    </div>
                  </div>

                  {selectedUserLogs.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
                      <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        Recent Requests by {selectedUser.displayName}
                      </div>
                      <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70 text-[11px] font-mono tabular-nums">
                        {selectedUserLogs.map((log) => (
                          <div
                            key={log.id}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-zinc-400">
                                {formatDateTime(log.createdAt)}
                              </span>
                              <span className="text-zinc-700 dark:text-zinc-300">
                                {formatModeLabel(log.searchMode)}
                              </span>
                              {log.responseStyle && (
                                <span className="text-zinc-400 hidden sm:inline">
                                  · {log.responseStyle}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-zinc-500">
                                {log.promptTokens.toLocaleString()} in /{' '}
                                {log.completionTokens.toLocaleString()} out
                              </span>
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {log.totalTokens.toLocaleString()} tok
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Filter logs by user email, name, or model..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                    {(['all', 'off', 'web', 'deep'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setLogModeFilter(m)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          logModeFilter === m
                            ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                            : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                      >
                        {m === 'all'
                          ? 'All'
                          : m === 'off'
                            ? 'Direct'
                            : m === 'web'
                              ? 'Web'
                              : 'Deep'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleExportLogsCsv}
                    disabled={filteredLogs.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums whitespace-nowrap">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">Time</th>
                      <th className="px-3.5 py-2.5 font-medium">User</th>
                      <th className="px-3.5 py-2.5 font-medium">Mode</th>
                      <th className="px-3.5 py-2.5 font-medium">Style / Tone</th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Prompt
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Completion
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Total
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-zinc-500"
                        >
                          No usage logs recorded yet.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((l) => (
                        <tr
                          key={l.id}
                          className="hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                        >
                          <td className="px-3.5 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                            {formatDateTime(l.createdAt)}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[160px]">
                              {l.userName}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-[180px]">
                              {l.userEmail || l.userId}
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 text-zinc-700 dark:text-zinc-300">
                            {formatModeLabel(l.searchMode)}
                            {typeof l.sourcesCount === 'number' &&
                              l.sourcesCount > 0 && (
                                <span className="text-zinc-400 font-mono">
                                  {' '}
                                  · {l.sourcesCount} src
                                </span>
                              )}
                          </td>
                          <td className="px-3.5 py-2.5 text-zinc-500 dark:text-zinc-400">
                            {l.responseStyle || 'balanced'} · {l.tone || 'neutral'}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                            {l.promptTokens.toLocaleString()}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                            {l.completionTokens.toLocaleString()}
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                            {l.totalTokens.toLocaleString()}
                          </td>
                          <td className="px-3.5 py-2.5 text-right capitalize">
                            <span
                              className={
                                l.status === 'error'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : l.status === 'aborted'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                              }
                            >
                              {l.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'keys' && (
            <div className="space-y-5">
              {/* Admin API Keys Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor="admin-bulk-keys"
                    className="font-medium text-zinc-800 dark:text-zinc-200"
                  >
                    Add Shared Pool API Keys (Admin Only · {remainingCapacity} slots remaining)
                  </label>
                  {detectedKeyCount > 0 && (
                    <span className="font-mono text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                      {detectedKeyCount} unique key{detectedKeyCount === 1 ? '' : 's'} ready
                    </span>
                  )}
                </div>
                <textarea
                  id="admin-bulk-keys"
                  value={bulkInput}
                  onChange={(e) => setBulkInput(e.target.value)}
                  rows={3}
                  disabled={remainingCapacity === 0 || keyBusy}
                  placeholder={
                    remainingCapacity === 0
                      ? 'Maximum 100 API keys reached.'
                      : 'Paste up to 100 hms-... API keys (newline, comma, or space separated) for all users to share...'
                  }
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3.5 py-2.5 font-mono text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    All users share this common pool; only {ADMIN_EMAIL} can add or remove keys.
                  </span>
                  <div className="flex items-center gap-2">
                    {settingsAddedCount > 0 && (
                      <button
                        type="button"
                        disabled={keyBusy}
                        onClick={handleClearAdded}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear added ({settingsAddedCount})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={
                        keyBusy || detectedKeyCount === 0 || remainingCapacity === 0
                      }
                      onClick={handleAddKeys}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{keyBusy ? 'Probing keys…' : 'Add to Pool'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {keyFeedback && (
                <div
                  className={`px-3.5 py-2.5 rounded-xl text-xs border ${
                    keyFeedback.type === 'success'
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                      : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {keyFeedback.text}
                </div>
              )}

              {/* Per-key table */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums whitespace-nowrap">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3 py-2 font-medium">Key</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium text-right">Used</th>
                      <th className="px-3 py-2 font-medium text-right">
                        Remaining
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Streams
                      </th>
                      <th className="px-3 py-2 font-medium text-right">
                        Reqs (OK)
                      </th>
                      <th className="px-3 py-2 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                    {keys.map((k) => (
                      <tr key={k.id}>
                        <td className="px-3 py-2.5 font-mono text-zinc-800 dark:text-zinc-200">
                          #{k.index} · {k.label}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-500">{k.source}</td>
                        <td className="px-3 py-2.5">{renderKeyStatus(k.status)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-zinc-700 dark:text-zinc-300">
                          {formatCompactNumber(k.quotaUsed)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium text-zinc-900 dark:text-zinc-100">
                          {formatCompactNumber(k.quotaRemaining)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                          {k.inFlight}/{k.maxConcurrent}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-zinc-600 dark:text-zinc-300">
                          {k.requestsTotal} ({k.requestsOk})
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {k.source === 'settings' ? (
                            <button
                              type="button"
                              disabled={keyBusy}
                              onClick={() => handleDeleteKey(k.id)}
                              className="p-1 rounded text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400"
                              aria-label={`Remove key ${k.label}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-[11px] text-zinc-400">env</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Live Server Session Ledger */}
              {liveServerUsers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Current Server Session Activity (Since Server Boot)
                    </span>
                    {serverUptimeSec !== null && (
                      <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                        Uptime: {Math.floor(serverUptimeSec / 60)}m{' '}
                        {serverUptimeSec % 60}s
                      </span>
                    )}
                  </div>
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-x-auto">
                    <table className="w-full text-left text-xs tabular-nums whitespace-nowrap">
                      <thead className="bg-zinc-50 dark:bg-zinc-900/70 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                        <tr>
                          <th className="px-3 py-2 font-medium">Session User</th>
                          <th className="px-3 py-2 font-medium text-right">
                            Requests
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Prompt
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Completion
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Total Tokens
                          </th>
                          <th className="px-3 py-2 font-medium text-right">
                            Last Active
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/80">
                        {liveServerUsers.map((lu) => (
                          <tr key={lu.uid}>
                            <td className="px-3 py-2">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {lu.displayName}
                              </span>{' '}
                              <span className="font-mono text-[11px] text-zinc-500">
                                ({lu.email})
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {lu.requests}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {lu.promptTokens.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {lu.completionTokens.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              {lu.totalTokens.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-500">
                              {formatRelativeTime(lu.lastActiveAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
