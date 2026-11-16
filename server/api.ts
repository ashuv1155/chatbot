import express from "express";
import type { Express, Request, Response } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatSourcesForSystemPrompt,
  runWebSearchPipeline,
  type SearchMode,
  type SearchProgressEvent,
  type SearchRecency,
} from "./search.ts";
import {
  isVerifiedAdmin,
  resolveRequestUser,
  type VerifiedUser,
} from "./auth.ts";

const UPSTREAM_BASE = "https://100milionseek.top";
const DEFAULT_MODEL = "deepseek-v4.1-flash-free";
const FALLBACK_KEY = "hms-vD_gJUaUAlun5bN27nkTCqwag_zmvVUyutsOTBe4p9s";
const MAX_CONCURRENT_PER_KEY = 5;
export const MAX_POOL_KEYS = 100;

export type KeyStatus =
  | "active"
  | "exhausted"
  | "rate_limited"
  | "invalid"
  | "error"
  | "unknown";

interface InternalKeyEntry {
  index: number;
  id: string;
  label: string;
  secret: string;
  source: "env" | "settings";
  status: KeyStatus;
  inFlight: number;
  requestsTotal: number;
  requestsOk: number;
  requestsFailed: number;
  sessionTokensUsed: number;
  quotaLimit: number | null;
  quotaUsed: number | null;
  quotaRemaining: number | null;
  quotaResetAt: string | null;
  qos: string | null;
  cooldownUntil: number;
  lastUsedAt: number | null;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface PublicKeyMetric {
  id: string;
  index: number;
  label: string;
  source: "env" | "settings";
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

function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return "hms-***";
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

function getKeyStorePaths(): string[] {
  return [
    path.resolve(process.cwd(), ".hms-keys.json"),
    path.join(os.tmpdir(), "seekchat-hms-keys.json"),
  ];
}

let customKeysMemoryCache: string[] | null = null;

function loadCustomKeys(): string[] {
  if (customKeysMemoryCache !== null) {
    return customKeysMemoryCache;
  }
  for (const filePath of getKeyStorePaths()) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          customKeysMemoryCache = parsed
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim())
            .filter(Boolean);
          return customKeysMemoryCache;
        }
      }
    } catch {
      // Try next path
    }
  }
  customKeysMemoryCache = [];
  return customKeysMemoryCache;
}

function saveCustomKeys(keys: string[]): void {
  const deduped = Array.from(new Set(keys.map((k) => k.trim()).filter(Boolean)));
  customKeysMemoryCache = deduped;
  const serialized = JSON.stringify(deduped, null, 2);

  for (const filePath of getKeyStorePaths()) {
    try {
      fs.writeFileSync(filePath, serialized, { encoding: "utf8", mode: 0o600 });
      return;
    } catch {
      // Fallback to tmpdir on read-only serverless filesystems
    }
  }
}

function collectConfiguredKeys(): Array<{
  secret: string;
  source: "env" | "settings";
}> {
  const envRaw: string[] = [];

  if (process.env.HMS_API_KEYS) {
    const parts = process.env.HMS_API_KEYS.split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    envRaw.push(...parts);
  }

  if (process.env.HMS_API_KEY) {
    const parts = process.env.HMS_API_KEY.split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    envRaw.push(...parts);
  }

  const numberedKeys = Object.keys(process.env)
    .filter((k) => /^HMS_API_KEY_\d+$/.test(k))
    .sort((a, b) => {
      const na = Number(a.replace("HMS_API_KEY_", ""));
      const nb = Number(b.replace("HMS_API_KEY_", ""));
      return na - nb;
    });

  for (const envName of numberedKeys) {
    const val = process.env[envName]?.trim();
    if (val) envRaw.push(val);
  }

  const customRaw = loadCustomKeys();
  const seen = new Set<string>();
  const combined: Array<{ secret: string; source: "env" | "settings" }> = [];

  for (const secret of envRaw) {
    if (!seen.has(secret) && combined.length < MAX_POOL_KEYS) {
      seen.add(secret);
      combined.push({ secret, source: "env" });
    }
  }

  for (const secret of customRaw) {
    if (!seen.has(secret) && combined.length < MAX_POOL_KEYS) {
      seen.add(secret);
      combined.push({ secret, source: "settings" });
    }
  }

  if (combined.length === 0) {
    combined.push({ secret: FALLBACK_KEY, source: "env" });
  }

  return combined;
}

let keyPool: InternalKeyEntry[] = [];
let cachedModels: unknown[] = [];

function syncKeyPool(): InternalKeyEntry[] {
  const configured = collectConfiguredKeys();
  const existingBySecret = new Map(keyPool.map((k) => [k.secret, k]));

  keyPool = configured.map(({ secret, source }, idx) => {
    const existing = existingBySecret.get(secret);
    if (existing) {
      existing.index = idx + 1;
      existing.source = source;
      return existing;
    }
    return {
      index: idx + 1,
      id: `key-${idx + 1}`,
      label: maskApiKey(secret),
      secret,
      source,
      status: "unknown",
      inFlight: 0,
      requestsTotal: 0,
      requestsOk: 0,
      requestsFailed: 0,
      sessionTokensUsed: 0,
      quotaLimit: null,
      quotaUsed: null,
      quotaRemaining: null,
      quotaResetAt: null,
      qos: null,
      cooldownUntil: 0,
      lastUsedAt: null,
      lastCheckedAt: null,
      lastError: null,
    };
  });

  return keyPool;
}

export function extractQuotaHeaders(headers: Headers) {
  const limit = headers.get("x-quota-limit");
  const used = headers.get("x-quota-used");
  const remaining = headers.get("x-quota-remaining");
  const reset = headers.get("x-quota-reset");
  const qos = headers.get("x-qos");
  const fastLimit = headers.get("x-quota-fast-limit");
  const fastRemaining = headers.get("x-quota-fast-remaining");

  return {
    limit: limit !== null ? Number(limit) : null,
    used: used !== null ? Number(used) : null,
    remaining: remaining !== null ? Number(remaining) : null,
    resetAt: reset || null,
    qos: qos || null,
    fastLimit: fastLimit !== null ? Number(fastLimit) : null,
    fastRemaining: fastRemaining !== null ? Number(fastRemaining) : null,
  };
}

function updateEntryFromHeaders(entry: InternalKeyEntry, headers: Headers) {
  const q = extractQuotaHeaders(headers);
  if (q.limit !== null && !Number.isNaN(q.limit)) entry.quotaLimit = q.limit;
  if (q.used !== null && !Number.isNaN(q.used)) entry.quotaUsed = q.used;
  if (q.remaining !== null && !Number.isNaN(q.remaining)) {
    entry.quotaRemaining = q.remaining;
    if (q.remaining <= 0) {
      entry.status = "exhausted";
    } else if (entry.status !== "invalid") {
      entry.status = "active";
    }
  }
  if (q.resetAt) entry.quotaResetAt = q.resetAt;
  if (q.qos) entry.qos = q.qos;
}

function toPublicMetric(entry: InternalKeyEntry): PublicKeyMetric {
  const now = Date.now();
  let effectiveStatus = entry.status;
  if (effectiveStatus === "rate_limited" && entry.cooldownUntil <= now) {
    effectiveStatus =
      entry.quotaRemaining !== null && entry.quotaRemaining <= 0
        ? "exhausted"
        : "active";
  }

  return {
    id: entry.id,
    index: entry.index,
    label: entry.label,
    source: entry.source,
    status: effectiveStatus,
    inFlight: entry.inFlight,
    maxConcurrent: MAX_CONCURRENT_PER_KEY,
    requestsTotal: entry.requestsTotal,
    requestsOk: entry.requestsOk,
    requestsFailed: entry.requestsFailed,
    sessionTokensUsed: entry.sessionTokensUsed,
    quotaLimit: entry.quotaLimit,
    quotaUsed: entry.quotaUsed,
    quotaRemaining: entry.quotaRemaining,
    quotaResetAt: entry.quotaResetAt,
    qos: entry.qos,
    lastUsedAt: entry.lastUsedAt,
    lastCheckedAt: entry.lastCheckedAt,
    lastError: entry.lastError,
  };
}

function computePoolTotals() {
  const pool = syncKeyPool();
  const now = Date.now();

  let totalLimit = 0;
  let totalUsed = 0;
  let totalRemaining = 0;
  let hasQuotaData = false;
  let activeKeys = 0;
  let exhaustedKeys = 0;
  let invalidKeys = 0;
  let totalInFlight = 0;
  let earliestReset: string | null = null;
  let totalRequests = 0;
  let totalSessionTokens = 0;

  for (const entry of pool) {
    totalInFlight += entry.inFlight;
    totalRequests += entry.requestsTotal;
    totalSessionTokens += entry.sessionTokensUsed;

    if (entry.status === "invalid") {
      invalidKeys++;
    } else if (
      entry.status === "exhausted" ||
      (entry.quotaRemaining !== null && entry.quotaRemaining <= 0)
    ) {
      exhaustedKeys++;
    } else if (entry.cooldownUntil <= now) {
      activeKeys++;
    }

    if (entry.quotaLimit !== null) {
      hasQuotaData = true;
      totalLimit += entry.quotaLimit;
    }
    if (entry.quotaUsed !== null) {
      totalUsed += entry.quotaUsed;
    }
    if (entry.quotaRemaining !== null) {
      totalRemaining += entry.quotaRemaining;
    }
    if (entry.quotaResetAt) {
      if (
        !earliestReset ||
        new Date(entry.quotaResetAt).getTime() <
          new Date(earliestReset).getTime()
      ) {
        earliestReset = entry.quotaResetAt;
      }
    }
  }

  return {
    quota: {
      limit: hasQuotaData ? totalLimit : null,
      used: hasQuotaData ? totalUsed : null,
      remaining: hasQuotaData ? totalRemaining : null,
      resetAt: earliestReset,
      qos:
        pool.find((k) => k.status === "active" && k.qos)?.qos ||
        pool[0]?.qos ||
        null,
    },
    poolSummary: {
      totalKeys: pool.length,
      activeKeys,
      exhaustedKeys,
      invalidKeys,
      totalInFlight,
      maxConcurrent: pool.length * MAX_CONCURRENT_PER_KEY,
      totalRequests,
      totalSessionTokens,
    },
    keys: pool.map(toPublicMetric),
  };
}

async function probeKey(entry: InternalKeyEntry): Promise<unknown[] | null> {
  try {
    const upstream = await fetch(`${UPSTREAM_BASE}/v1/models`, {
      headers: {
        Authorization: `Bearer ${entry.secret}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    entry.lastCheckedAt = Date.now();
    updateEntryFromHeaders(entry, upstream.headers);

    if (upstream.status === 401 || upstream.status === 403) {
      entry.status = "invalid";
      entry.lastError = "Invalid or revoked API key";
      return null;
    }

    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      entry.status = "error";
      entry.lastError =
        data?.error?.message || `Probe failed (${upstream.status})`;
      return null;
    }

    if (entry.quotaRemaining !== null && entry.quotaRemaining <= 0) {
      entry.status = "exhausted";
    } else {
      entry.status = "active";
    }
    entry.lastError = null;
    return Array.isArray(data?.data) ? data.data : null;
  } catch (err) {
    entry.lastCheckedAt = Date.now();
    entry.status = "error";
    entry.lastError =
      err instanceof Error ? err.message : "Failed to reach upstream";
    return null;
  }
}

async function refreshKeys(entries: InternalKeyEntry[]): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((entry) => probeKey(entry)));
    for (const models of results) {
      if (models && models.length > 0) {
        cachedModels = models;
      }
    }
  }
}

async function refreshAllKeys(): Promise<void> {
  const pool = syncKeyPool();
  await refreshKeys(pool);
}

function selectNextKey(excludeIds: Set<string>): InternalKeyEntry | null {
  const pool = syncKeyPool();
  const now = Date.now();

  const candidates = pool.filter((entry) => {
    if (excludeIds.has(entry.id)) return false;
    if (entry.status === "invalid") return false;
    if (entry.status === "exhausted") {
      if (
        entry.quotaResetAt &&
        new Date(entry.quotaResetAt).getTime() <= now
      ) {
        entry.status = "unknown";
      } else {
        return false;
      }
    }
    if (entry.cooldownUntil > now) return false;
    if (entry.inFlight >= MAX_CONCURRENT_PER_KEY) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
    const remA = a.quotaRemaining ?? Number.MAX_SAFE_INTEGER;
    const remB = b.quotaRemaining ?? Number.MAX_SAFE_INTEGER;
    if (remA !== remB) return remB - remA;
    return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
  });

  return candidates[0];
}

function forwardPoolHeaders(res: Response) {
  const totals = computePoolTotals();
  if (totals.quota.limit !== null) {
    res.setHeader("x-quota-limit", String(totals.quota.limit));
  }
  if (totals.quota.used !== null) {
    res.setHeader("x-quota-used", String(totals.quota.used));
  }
  if (totals.quota.remaining !== null) {
    res.setHeader("x-quota-remaining", String(totals.quota.remaining));
  }
  if (totals.quota.resetAt) {
    res.setHeader("x-quota-reset", totals.quota.resetAt);
  }
  if (totals.quota.qos) {
    res.setHeader("x-qos", totals.quota.qos);
  }
}

interface ServerUserRuntimeMetric {
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

const serverStartedAt = Date.now();
const serverUserUsageMap = new Map<string, ServerUserRuntimeMetric>();

function recordServerUserUsage(
  user: VerifiedUser | null,
  details: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    searchMode: SearchMode;
    model: string;
  },
) {
  const uid = user?.uid || "guest";
  const existing = serverUserUsageMap.get(uid);
  const next: ServerUserRuntimeMetric = existing || {
    uid,
    email: user?.email || "guest",
    displayName: user?.name || (user ? "Google User" : "Guest (Unauthenticated)"),
    isGuest: !user,
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    webSearches: 0,
    deepSearches: 0,
    lastModel: details.model,
    lastSearchMode: details.searchMode,
    lastActiveAt: Date.now(),
  };

  if (user?.email) next.email = user.email;
  if (user?.name) next.displayName = user.name;
  next.requests += 1;
  next.promptTokens += Math.max(0, details.promptTokens);
  next.completionTokens += Math.max(0, details.completionTokens);
  next.totalTokens += Math.max(0, details.totalTokens);
  if (details.searchMode === "web") next.webSearches += 1;
  if (details.searchMode === "deep") next.deepSearches += 1;
  next.lastModel = details.model;
  next.lastSearchMode = details.searchMode;
  next.lastActiveAt = Date.now();
  serverUserUsageMap.set(uid, next);
}

async function requireAdmin(
  req: Request,
  res: Response,
): Promise<VerifiedUser | null> {
  const user = await resolveRequestUser(req);
  if (!isVerifiedAdmin(user)) {
    res.status(403).json({
      error: {
        message:
          "Admin access required. Only the main administrator (8887ashu@gmail.com) can access API key settings and admin analytics.",
        code: "admin_only",
      },
    });
    return null;
  }
  return user;
}

export function registerApiRoutes(app: Express): void {
  app.use(express.json({ limit: "4mb" }));

  // Liveness / health check for Render & uptime monitors
  app.get("/api/health", (_req: Request, res: Response) => {
    const pool = syncKeyPool();
    res.json({
      ok: true,
      service: "ashutosh-gpt",
      model: DEFAULT_MODEL,
      configuredKeys: pool.length,
      maxKeys: MAX_POOL_KEYS,
      timestamp: new Date().toISOString(),
    });
  });

  // Live model pricing/costing + pooled quota (per-key details returned to verified admin only)
  app.get("/api/quota", async (req: Request, res: Response) => {
    try {
      const caller = await resolveRequestUser(req);
      const admin = isVerifiedAdmin(caller);
      await refreshAllKeys();
      const totals = computePoolTotals();
      res.json({
        isAdmin: admin,
        models: cachedModels,
        quota: totals.quota,
        poolSummary: totals.poolSummary,
        keys: admin ? totals.keys : [],
      });
    } catch (err) {
      res.status(502).json({
        error: {
          message:
            err instanceof Error ? err.message : "Failed to reach upstream API",
          code: "upstream_unreachable",
        },
      });
    }
  });

  // Admin-only server runtime usage & key pool overview
  app.get("/api/admin/server-stats", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      await refreshAllKeys();
      const totals = computePoolTotals();
      const liveUsers = Array.from(serverUserUsageMap.values()).sort(
        (a, b) => b.totalTokens - a.totalTokens || b.lastActiveAt - a.lastActiveAt,
      );
      res.json({
        adminEmail: admin.email,
        serverStartedAt,
        uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
        models: cachedModels,
        liveUsers,
        ...totals,
      });
    } catch (err) {
      res.status(502).json({
        error: {
          message:
            err instanceof Error ? err.message : "Failed to load admin server stats",
        },
      });
    }
  });

  // Bulk-add up to 100 API keys to the server-side pool (Admin only)
  app.post("/api/keys", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rawKeysInput = req.body?.keys;
    let parsedList: string[] = [];

    if (typeof rawKeysInput === "string") {
      parsedList = rawKeysInput
        .split(/[\n,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(rawKeysInput)) {
      parsedList = rawKeysInput
        .filter((k): k is string => typeof k === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (parsedList.length === 0) {
      res.status(400).json({
        error: {
          message: "Provide at least one API key (comma, space, or newline separated).",
        },
      });
      return;
    }

    const currentPool = syncKeyPool();
    const existingSecrets = new Set(currentPool.map((k) => k.secret));
    const currentCustom = loadCustomKeys();

    const addedSecrets: string[] = [];
    let duplicatesSkipped = 0;
    let capReached = false;

    for (const candidate of parsedList) {
      if (existingSecrets.has(candidate)) {
        duplicatesSkipped++;
        continue;
      }
      if (existingSecrets.size + addedSecrets.length >= MAX_POOL_KEYS) {
        capReached = true;
        break;
      }
      existingSecrets.add(candidate);
      addedSecrets.push(candidate);
    }

    if (addedSecrets.length > 0) {
      saveCustomKeys([...currentCustom, ...addedSecrets]);
    }

    const updatedPool = syncKeyPool();
    const addedSet = new Set(addedSecrets);
    const newlyAddedEntries = updatedPool.filter((e) => addedSet.has(e.secret));
    if (newlyAddedEntries.length > 0) {
      await refreshKeys(newlyAddedEntries);
    }

    const totals = computePoolTotals();
    res.json({
      added: addedSecrets.length,
      duplicatesSkipped,
      capReached,
      maxKeys: MAX_POOL_KEYS,
      models: cachedModels,
      ...totals,
    });
  });

  // Remove a single settings-added key by ID (Admin only)
  app.delete("/api/keys/:id", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const pool = syncKeyPool();
    const target = pool.find((k) => k.id === id);

    if (!target) {
      res.status(404).json({ error: { message: "Key not found." } });
      return;
    }
    if (target.source !== "settings") {
      res.status(400).json({
        error: {
          message:
            "Environment-configured keys cannot be removed from the UI.",
        },
      });
      return;
    }

    const remainingCustom = loadCustomKeys().filter(
      (secret) => secret !== target.secret,
    );
    saveCustomKeys(remainingCustom);
    const totals = computePoolTotals();
    res.json({ removed: target.label, ...totals });
  });

  // Clear all settings-added keys (Admin only)
  app.delete("/api/keys", async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    saveCustomKeys([]);
    const totals = computePoolTotals();
    res.json({ cleared: true, ...totals });
  });

  // Live public service telemetry from 100milionseek
  app.get("/api/service-status", async (_req: Request, res: Response) => {
    try {
      const upstream = await fetch(`${UPSTREAM_BASE}/api/status`);
      const data = await upstream.json().catch(() => null);
      if (!upstream.ok || !data) {
        res.status(upstream.status || 502).json({
          error: { message: "Failed to load service status" },
        });
        return;
      }
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: {
          message:
            err instanceof Error
              ? err.message
              : "Failed to reach 100milionseek status",
        },
      });
    }
  });

  // Helper: quick non-streaming query planning for Deep Search
  async function planDeepSearchQueries(
    userQuery: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const candidate = selectNextKey(new Set());
    if (!candidate) return [userQuery];

    candidate.inFlight += 1;
    candidate.requestsTotal += 1;
    candidate.lastUsedAt = Date.now();

    try {
      const resp = await fetch(`${UPSTREAM_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${candidate.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          stream: false,
          temperature: 0.2,
          max_tokens: 180,
          messages: [
            {
              role: "system",
              content:
                "Generate 3 concise, distinct web search queries to thoroughly research the user's request from multiple angles. Return ONLY a JSON array of strings, nothing else.",
            },
            {
              role: "user",
              content: userQuery,
            },
          ],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      });
      updateEntryFromHeaders(candidate, resp.headers);
      if (!resp.ok) {
        candidate.requestsFailed += 1;
        return [userQuery];
      }
      const data = await resp.json().catch(() => null);
      candidate.requestsOk += 1;
      if (typeof data?.usage?.total_tokens === "number") {
        candidate.sessionTokensUsed += data.usage.total_tokens;
      }
      const raw = String(data?.choices?.[0]?.message?.content || "").trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const arr = JSON.parse(jsonMatch[0]);
        if (Array.isArray(arr)) {
          const cleaned = arr
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 3);
          if (cleaned.length > 0) return cleaned;
        }
      }
      const lines = raw
        .split("\n")
        .map((l) => l.replace(/^[-*\d.)\s]+/, "").replace(/^["']|["']$/g, "").trim())
        .filter((l) => l.length > 3 && l.length < 140)
        .slice(0, 3);
      return lines.length > 0 ? lines : [userQuery];
    } catch {
      return [userQuery];
    } finally {
      candidate.inFlight = Math.max(0, candidate.inFlight - 1);
    }
  }

  function buildStyleInstruction(
    responseStyle?: string,
    tone?: string,
  ): string {
    const hints: string[] = [];
    switch (responseStyle) {
      case "concise":
        hints.push("Keep your response crisp, concise, and direct with minimal filler.");
        break;
      case "detailed":
        hints.push("Provide a thorough, comprehensive explanation with clear headings, examples, and nuances.");
        break;
      case "step-by-step":
        hints.push("Break down your answer into clear numbered step-by-step instructions.");
        break;
      case "code-first":
        hints.push("Prioritize clean, runnable code examples up front followed by brief, practical explanations.");
        break;
    }
    switch (tone) {
      case "technical":
        hints.push("Use precise engineering terminology and exact technical depth.");
        break;
      case "friendly":
        hints.push("Use a warm, approachable, easy-to-follow conversational tone.");
        break;
      case "executive":
        hints.push("Lead with key takeaways and bottom-line recommendations suitable for decision makers.");
        break;
    }
    return hints.join(" ");
  }

  // Chat completions proxy with multi-key load balancing, 429 failover, Web Search & Deep Search
  app.post("/api/chat", async (req: Request, res: Response) => {
    const callerUser = await resolveRequestUser(req);
    const {
      messages,
      model = DEFAULT_MODEL,
      stream = true,
      temperature,
      max_tokens,
      top_p,
      searchMode = "off",
      searchRecency = "any",
      responseStyle = "balanced",
      tone = "neutral",
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        error: {
          message: "Messages array is required and must not be empty.",
          code: "invalid_messages",
        },
      });
      return;
    }

    const activeSearchMode: SearchMode =
      searchMode === "deep"
        ? "deep"
        : searchMode === "web"
          ? "web"
          : "off";
    const activeRecency: SearchRecency =
      searchRecency === "day" ||
      searchRecency === "week" ||
      searchRecency === "month"
        ? searchRecency
        : "any";

    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const isStreaming = Boolean(stream);
    let sseHeadersSent = false;

    const ensureSseHeaders = () => {
      if (!sseHeadersSent && isStreaming && !res.headersSent) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        sseHeadersSent = true;
      }
    };

    const writeSseMeta = (meta: SearchProgressEvent) => {
      if (!isStreaming || res.writableEnded) return;
      ensureSseHeaders();
      res.write(`data: ${JSON.stringify({ ashutosh_meta: meta })}\n\n`);
    };

    const finalMessages: Array<{ role: string; content: string }> = messages.map(
      (m: { role: string; content: string }) => ({
        role: String(m.role),
        content: String(m.content || ""),
      }),
    );

    const styleHint = buildStyleInstruction(
      typeof responseStyle === "string" ? responseStyle : undefined,
      typeof tone === "string" ? tone : undefined,
    );
    if (styleHint) {
      finalMessages.unshift({
        role: "system",
        content: styleHint,
      });
    }

    let searchMetaResult: SearchProgressEvent | null = null;

    if (activeSearchMode !== "off") {
      const lastUserMsg = [...finalMessages]
        .reverse()
        .find((m) => m.role === "user");
      const searchInput = lastUserMsg?.content?.trim() || "";

      if (searchInput) {
        if (isStreaming) {
          ensureSseHeaders();
        }
        try {
          const { queries, sources } = await runWebSearchPipeline({
            userQuery: searchInput,
            mode: activeSearchMode,
            recency: activeRecency,
            planQueriesFn:
              activeSearchMode === "deep"
                ? (q) => planDeepSearchQueries(q, abortController.signal)
                : undefined,
            onProgress: (evt) => {
              writeSseMeta(evt);
            },
            signal: abortController.signal,
          });

          const publicSources = sources.map((s) => ({
            title: s.title,
            url: s.url,
            domain: s.domain,
            snippet: s.snippet,
            fetchedExcerpt: s.fetchedExcerpt,
          }));

          searchMetaResult = {
            stage: "done",
            queries,
            sourcesCount: publicSources.length,
            pagesRead: publicSources.filter((s) => s.fetchedExcerpt).length,
            sources: publicSources,
          };

          const groundedSystemPrompt = formatSourcesForSystemPrompt(
            sources,
            activeSearchMode,
            queries,
          );
          finalMessages.unshift({
            role: "system",
            content: groundedSystemPrompt,
          });
        } catch (searchErr) {
          if ((searchErr as Error)?.name === "AbortError") {
            if (!res.writableEnded) res.end();
            return;
          }
        }
      }
    }

    const payload: Record<string, unknown> = {
      model,
      messages: finalMessages,
      stream: isStreaming,
    };
    if (typeof temperature === "number") {
      payload.temperature = temperature;
    }
    if (typeof max_tokens === "number" && max_tokens > 0) {
      payload.max_tokens = max_tokens;
    }
    if (typeof top_p === "number") {
      payload.top_p = top_p;
    }

    const pool = syncKeyPool();
    const triedKeyIds = new Set<string>();
    const maxAttempts = Math.min(pool.length, 15);

    let chosenKey: InternalKeyEntry | null = null;
    let upstream: globalThis.Response | null = null;
    let lastErrorStatus = 502;
    let lastErrorData: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const candidate = selectNextKey(triedKeyIds);
      if (!candidate) break;

      triedKeyIds.add(candidate.id);
      candidate.inFlight += 1;
      candidate.requestsTotal += 1;
      candidate.lastUsedAt = Date.now();

      try {
        const resp = await fetch(`${UPSTREAM_BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${candidate.secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        updateEntryFromHeaders(candidate, resp.headers);

        if (resp.ok) {
          chosenKey = candidate;
          upstream = resp;
          break;
        }

        candidate.inFlight = Math.max(0, candidate.inFlight - 1);
        candidate.requestsFailed += 1;
        lastErrorStatus = resp.status;
        lastErrorData = await resp.json().catch(async () => {
          const text = await resp.text().catch(() => "");
          return {
            error: { message: text || `Upstream error (${resp.status})` },
          };
        });

        const errCode =
          (lastErrorData as { error?: { code?: string } })?.error?.code || "";

        if (resp.status === 401 || resp.status === 403) {
          candidate.status = "invalid";
          candidate.lastError = "Invalid API key";
          continue;
        }
        if (resp.status === 429 && errCode === "daily_quota_exceeded") {
          candidate.status = "exhausted";
          candidate.quotaRemaining = 0;
          candidate.lastError = "Daily quota exceeded";
          continue;
        }
        if (resp.status === 429 && errCode === "session_limit_reached") {
          candidate.status = "rate_limited";
          candidate.cooldownUntil = Date.now() + 2500;
          candidate.lastError = "Concurrent session limit reached";
          continue;
        }

        candidate.lastError =
          (lastErrorData as { error?: { message?: string } })?.error?.message ||
          `HTTP ${resp.status}`;
        break;
      } catch (err) {
        candidate.inFlight = Math.max(0, candidate.inFlight - 1);
        if ((err as Error)?.name === "AbortError") {
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }
        candidate.requestsFailed += 1;
        candidate.lastError =
          err instanceof Error ? err.message : "Network error";
        lastErrorStatus = 502;
        lastErrorData = {
          error: { message: candidate.lastError, code: "upstream_error" },
        };
      }
    }

    if (!upstream || !chosenKey) {
      const fallbackErr = lastErrorData || {
        error: {
          message:
            "All configured API keys are currently exhausted, busy (5 concurrent streams each), or invalid. Check Settings → API Keys Pool.",
          code: "all_keys_unavailable",
        },
      };
      if (sseHeadersSent || res.headersSent) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(fallbackErr)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }
        return;
      }
      forwardPoolHeaders(res);
      res.status(lastErrorData ? lastErrorStatus : 429).json(fallbackErr);
      return;
    }

    const activeEntry = chosenKey;
    let slotReleased = false;
    const releaseSlot = () => {
      if (!slotReleased) {
        slotReleased = true;
        activeEntry.inFlight = Math.max(0, activeEntry.inFlight - 1);
      }
    };

    try {
      if (!sseHeadersSent && !res.headersSent) {
        forwardPoolHeaders(res);
      }

      if (!isStreaming) {
        const json = await upstream.json();
        activeEntry.requestsOk += 1;
        activeEntry.lastError = null;
        const promptTok =
          typeof json?.usage?.prompt_tokens === "number"
            ? json.usage.prompt_tokens
            : 0;
        const completionTok =
          typeof json?.usage?.completion_tokens === "number"
            ? json.usage.completion_tokens
            : 0;
        const totalTok =
          typeof json?.usage?.total_tokens === "number"
            ? json.usage.total_tokens
            : promptTok + completionTok;
        if (totalTok > 0) {
          activeEntry.sessionTokensUsed += totalTok;
        }
        recordServerUserUsage(callerUser, {
          promptTokens: promptTok,
          completionTokens: completionTok,
          totalTokens: totalTok,
          searchMode: activeSearchMode,
          model: String(model || DEFAULT_MODEL),
        });
        if (searchMetaResult && json && typeof json === "object") {
          json.ashutosh_meta = searchMetaResult;
        }
        releaseSlot();
        res.json(json);
        return;
      }

      ensureSseHeaders();

      if (!upstream.body) {
        activeEntry.requestsOk += 1;
        releaseSlot();
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let streamTailBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          streamTailBuffer = (streamTailBuffer + chunk).slice(-768);
          if (!res.writableEnded) {
            res.write(chunk);
          }
        }
        const tail = decoder.decode();
        if (tail) {
          streamTailBuffer = (streamTailBuffer + tail).slice(-768);
          if (!res.writableEnded) {
            res.write(tail);
          }
        }

        const usageJsonMatch = streamTailBuffer.match(
          /"usage"\s*:\s*(\{[^}]+\})/,
        );
        let promptTok = 0;
        let completionTok = 0;
        let totalTok = 0;
        if (usageJsonMatch) {
          try {
            const parsedUsage = JSON.parse(usageJsonMatch[1]) as {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
            promptTok = Number(parsedUsage.prompt_tokens || 0);
            completionTok = Number(parsedUsage.completion_tokens || 0);
            totalTok = Number(
              parsedUsage.total_tokens || promptTok + completionTok,
            );
          } catch {
            // Ignore malformed tail match
          }
        }
        if (totalTok > 0) {
          activeEntry.sessionTokensUsed += totalTok;
        }
        recordServerUserUsage(callerUser, {
          promptTokens: promptTok,
          completionTokens: completionTok,
          totalTokens: totalTok,
          searchMode: activeSearchMode,
          model: String(model || DEFAULT_MODEL),
        });

        activeEntry.requestsOk += 1;
        activeEntry.lastError = null;
      } catch (streamErr) {
        if ((streamErr as Error)?.name !== "AbortError") {
          activeEntry.requestsFailed += 1;
          activeEntry.lastError =
            streamErr instanceof Error
              ? streamErr.message
              : "Stream interrupted";
          if (!res.writableEnded) {
            const errPayload = JSON.stringify({
              error: { message: activeEntry.lastError },
            });
            res.write(`\ndata: ${errPayload}\n\n`);
          }
        }
      } finally {
        releaseSlot();
        if (!res.writableEnded) {
          res.end();
        }
      }
    } catch (err) {
      releaseSlot();
      if ((err as Error)?.name === "AbortError") {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      activeEntry.requestsFailed += 1;
      if (!res.headersSent) {
        res.status(502).json({
          error: {
            message:
              err instanceof Error
                ? err.message
                : "Failed to connect to 100milionseek API",
            code: "upstream_error",
          },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}
