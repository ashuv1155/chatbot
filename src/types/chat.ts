export interface Attachment {
  id: string;
  name: string;
  size: number;
  content: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  createdAt: number;
  usage?: TokenUsage;
  error?: string;
  isStreaming?: boolean;
  aborted?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  systemPrompt?: string;
}

export interface ChatSettings {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
}

export interface PreviewArtifact {
  id: string;
  language: 'html' | 'svg';
  code: string;
  title: string;
}

export interface ModelPricingInfo {
  id: string;
  name?: string;
  owned_by?: string;
  context_length?: number;
  max_output_tokens?: number;
  quota_multiplier?: number;
  price_label?: string;
  endpoint?: string;
}

export type KeyStatus =
  | 'active'
  | 'exhausted'
  | 'rate_limited'
  | 'invalid'
  | 'error'
  | 'unknown';

export interface KeyMetric {
  id: string;
  index: number;
  label: string;
  source: 'env' | 'settings';
  status: KeyStatus;
  inFlight: number;
  maxConcurrent: number;
  requestsTotal: number;
  requestsOk: number;
  requestsFailed: number;
  sessionTokensUsed: number;
  quotaLimit: number | null;
  quotaUsed: number | null;
  quotaRemaining: number | null;
  quotaResetAt: string | null;
  qos: string | null;
  lastUsedAt: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface PoolSummary {
  totalKeys: number;
  activeKeys: number;
  exhaustedKeys: number;
  invalidKeys: number;
  totalInFlight: number;
  maxConcurrent: number;
  totalRequests: number;
  totalSessionTokens: number;
}

export interface QuotaInfo {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  resetAt: string | null;
  qos: string | null;
  fastLimit?: number | null;
  fastRemaining?: number | null;
}

export interface ServiceStatus {
  state?: string;
  sessions_in_flight?: number;
  lifetime_tokens?: number;
  allowance?: {
    daily_tokens?: number;
    fast_daily_tokens?: number;
    session_limit?: number;
    reset?: string;
  };
  bonus?: {
    daily_tokens?: number;
    ends_at?: string;
    milestone?: number;
  };
  last_24h?: {
    requests?: number;
    tokens?: number;
    success_rate?: number;
    tokens_per_s?: number;
    ttft_ms?: { p50?: number; p95?: number };
    latency_ms?: { p50?: number; p95?: number };
  };
  accounts?: {
    total?: number;
  };
}
