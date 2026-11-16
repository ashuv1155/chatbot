import express from "express";
import type { Express, Request, Response } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
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

function forwardPoolHeaders(res: Response, activeKey?: InternalKeyEntry) {
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
  if (activeKey) {
    res.setHeader("x-active-key-label", activeKey.label);
  }
}

export function registerApiRoutes(app: Express): void {
  app.use(express.json({ limit: "4mb" }));

  // Liveness / health check for Render & uptime monitors
  app.get("/api/health", (_req: Request, res: Response) => {
    const pool = syncKeyPool();
    res.json({
      ok: true,
      service: "seekchat",
      model: DEFAULT_MODEL,
      configuredKeys: pool.length,
      maxKeys: MAX_POOL_KEYS,
      timestamp: new Date().toISOString(),
    });
  });

  // Live model pricing/costing + pooled quota & per-key metrics
  app.get("/api/quota", async (_req: Request, res: Response) => {
    try {
      await refreshAllKeys();
      const totals = computePoolTotals();
      res.json({
        models: cachedModels,
        ...totals,
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

  // Bulk-add up to 100 API keys to the server-side pool
  app.post("/api/keys", async (req: Request, res: Response) => {
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

  // Remove a single settings-added key by ID (e.g. key-2)
  app.delete("/api/keys/:id", (req: Request, res: Response) => {
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

  // Clear all settings-added keys
  app.delete("/api/keys", (_req: Request, res: Response) => {
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

  // Chat completions proxy with multi-key load balancing & 429 failover
  app.post("/api/chat", async (req: Request, res: Response) => {
    const {
      messages,
      model = DEFAULT_MODEL,
      stream = true,
      temperature,
      max_tokens,
      top_p,
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

    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: Boolean(stream),
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
      forwardPoolHeaders(res);
      if (!lastErrorData) {
        res.status(429).json({
          error: {
            message:
              "All configured API keys are currently exhausted, busy (5 concurrent streams each), or invalid. Check Settings → API Keys Pool.",
            code: "all_keys_unavailable",
          },
        });
        return;
      }
      res.status(lastErrorStatus).json(lastErrorData);
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
      forwardPoolHeaders(res, activeEntry);

      if (!stream) {
        const json = await upstream.json();
        activeEntry.requestsOk += 1;
        activeEntry.lastError = null;
        if (typeof json?.usage?.total_tokens === "number") {
          activeEntry.sessionTokensUsed += json.usage.total_tokens;
        }
        releaseSlot();
        res.json(json);
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

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
          streamTailBuffer = (streamTailBuffer + chunk).slice(-512);
          if (!res.writableEnded) {
            res.write(chunk);
          }
        }
        const tail = decoder.decode();
        if (tail) {
          streamTailBuffer = (streamTailBuffer + tail).slice(-512);
          if (!res.writableEnded) {
            res.write(tail);
          }
        }

        const usageMatch = streamTailBuffer.match(
          /"usage"\s*:\s*\{[^}]*"total_tokens"\s*:\s*(\d+)/,
        );
        if (usageMatch) {
          activeEntry.sessionTokensUsed += Number(usageMatch[1]);
        }

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
