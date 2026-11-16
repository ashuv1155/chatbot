export type AttachmentKind = 'text' | 'image' | 'audio' | 'video';

export interface Attachment {
  id: string;
  name: string;
  size: number;
  content: string;
  mimeType?: string;
  kind?: AttachmentKind;
  previewUrl?: string;
  dimensions?: {
    width: number;
    height: number;
  };
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type SearchMode = 'off' | 'web' | 'deep';
export type SearchRecency = 'any' | 'day' | 'week' | 'month';
export type ResponseStyle =
  | 'balanced'
  | 'concise'
  | 'detailed'
  | 'step-by-step'
  | 'code-first';
export type ResponseTone = 'neutral' | 'technical' | 'friendly' | 'executive';

export interface SearchSource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  fetchedExcerpt?: boolean;
}

export interface SearchProgress {
  stage: 'planning' | 'searching' | 'reading' | 'synthesizing' | 'done';
  queries: string[];
  sourcesCount: number;
  pagesRead?: number;
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
  searchMode?: SearchMode;
  searchQueries?: string[];
  sources?: SearchSource[];
  searchProgress?: SearchProgress;
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
  defaultSearchMode: SearchMode;
  searchRecency: SearchRecency;
  responseStyle: ResponseStyle;
  tone: ResponseTone;
  showFollowUps: boolean;
}

export type PreviewArtifactKind =
  | 'html'
  | 'svg'
  | 'react'
  | 'mermaid'
  | 'markdown'
  | 'csv'
  | 'json'
  | 'css'
  | 'javascript'
  | 'image'
  | 'audio'
  | 'video';

export interface PreviewArtifact {
  id: string;
  language: PreviewArtifactKind;
  code: string;
  title: string;
  mimeType?: string;
  filename?: string;
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

export interface AdminUserUsage {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  totalTokensUsed: number;
  promptTokensUsed: number;
  completionTokensUsed: number;
  dailyTokensUsed: number;
  usageDate: string;
  totalRequests: number;
  webSearchCount: number;
  deepSearchCount: number;
  conversationsCount: number;
  lastModelUsed?: string;
  lastSearchMode?: SearchMode;
  lastActiveAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdminUsageLog {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  model: string;
  searchMode: SearchMode;
  responseStyle?: string;
  tone?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  sourcesCount?: number;
  status: 'completed' | 'aborted' | 'error';
  errorMessage?: string;
  createdAt: number;
}

export interface ServerLiveUserMetric {
  uid: string;
  email: string;
  displayName: string;
  isGuest: boolean;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  webSearches: number;
  deepSearches: number;
  lastModel: string;
  lastSearchMode: SearchMode;
  lastActiveAt: number;
}

