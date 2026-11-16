import type { ChatSettings, Conversation, QuotaInfo } from '../types/chat';

const CONVERSATIONS_KEY = 'seekchat_conversations_v1';
const ACTIVE_ID_KEY = 'seekchat_active_id_v1';
const SETTINGS_KEY = 'seekchat_settings_v1';
const THEME_KEY = 'seekchat_theme_v1';

export const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 8192,
  stream: true,
};

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((conv: Conversation) => ({
      ...conv,
      messages: Array.isArray(conv.messages)
        ? conv.messages.map((m) => ({ ...m, isStreaming: false }))
        : [],
    }));
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_ID_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_ID_KEY);
    }
  } catch {
    // Ignore
  }
}

export function loadSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ChatSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore
  }
}

export function loadTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Ignore
  }
  return 'dark';
}

export function saveTheme(theme: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore
  }
}

export function generateTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New chat';
  if (cleaned.length <= 44) return cleaned;
  return `${cleaned.slice(0, 44).trimEnd()}…`;
}

export function formatCompactNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, '')}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return num.toLocaleString();
}

export function formatTimeUntilReset(resetAt: string | null): string {
  if (!resetAt) return '00:00 UTC';
  const target = new Date(resetAt).getTime();
  if (Number.isNaN(target)) return '00:00 UTC';
  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'Resetting soon';
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function extractQuotaFromHeaders(headers: Headers): Partial<QuotaInfo> {
  const limit = headers.get('x-quota-limit');
  const used = headers.get('x-quota-used');
  const remaining = headers.get('x-quota-remaining');
  const reset = headers.get('x-quota-reset');
  const qos = headers.get('x-qos');

  const result: Partial<QuotaInfo> = {};
  if (limit !== null) result.limit = Number(limit);
  if (used !== null) result.used = Number(used);
  if (remaining !== null) result.remaining = Number(remaining);
  if (reset !== null) result.resetAt = reset;
  if (qos !== null) result.qos = qos;
  return result;
}

export function exportConversationMarkdown(conv: Conversation): string {
  const lines: string[] = [
    `# ${conv.title}`,
    `Exported ${new Date().toISOString()} · Model: deepseek-v4.1-flash-free`,
    '',
  ];
  for (const msg of conv.messages) {
    lines.push(`## ${msg.role === 'user' ? 'User' : 'Assistant'}`);
    lines.push('');
    if (msg.attachments && msg.attachments.length > 0) {
      lines.push(
        `Attachments: ${msg.attachments.map((a) => a.name).join(', ')}`,
      );
      lines.push('');
    }
    lines.push(msg.content);
    lines.push('');
  }
  return lines.join('\n');
}

export function exportConversationJson(conv: Conversation): string {
  return JSON.stringify(
    {
      title: conv.title,
      model: 'deepseek-v4.1-flash-free',
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messages: conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        attachments: m.attachments?.map((a) => ({
          name: a.name,
          size: a.size,
        })),
        usage: m.usage,
        createdAt: new Date(m.createdAt).toISOString(),
      })),
    },
    null,
    2,
  );
}

export interface GroupedConversations {
  label: string;
  items: Conversation[];
}

export function groupConversationsByDate(
  conversations: Conversation[],
): GroupedConversations[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfLast7Days = startOfToday - 7 * 86_400_000;

  const pinned: Conversation[] = [];
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const last7Days: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of conversations) {
    if (conv.pinned) {
      pinned.push(conv);
    } else if (conv.updatedAt >= startOfToday) {
      today.push(conv);
    } else if (conv.updatedAt >= startOfYesterday) {
      yesterday.push(conv);
    } else if (conv.updatedAt >= startOfLast7Days) {
      last7Days.push(conv);
    } else {
      older.push(conv);
    }
  }

  const groups: GroupedConversations[] = [];
  if (pinned.length) groups.push({ label: 'Pinned', items: pinned });
  if (today.length) groups.push({ label: 'Today', items: today });
  if (yesterday.length) groups.push({ label: 'Yesterday', items: yesterday });
  if (last7Days.length)
    groups.push({ label: 'Previous 7 Days', items: last7Days });
  if (older.length) groups.push({ label: 'Older', items: older });

  return groups;
}
