import "server-only";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitBucket>;
type RateLimitBackend = "memory" | "upstash";

type EnforceRateLimitInput = {
  namespace: string;
  key: string;
  max: number;
  windowMs: number;
  failClosedOnBackendError?: boolean;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
  source: "memory" | "upstash" | "fallback_memory" | "backend_unavailable";
  backendError?: string | null;
};

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_BACKEND: RateLimitBackend = "memory";
const DEFAULT_REDIS_PREFIX = "pos:rate-limit";
const DEFAULT_BACKEND_TIMEOUT_MS = 2500;

declare global {
  var __qrLoginRateLimitStore: RateLimitStore | undefined;
  var __qrLoginRateLimitLastCleanupAt: number | undefined;
  var __rateLimitInvalidBackendWarned: boolean | undefined;
}

function getStore(): RateLimitStore {
  if (!globalThis.__qrLoginRateLimitStore) {
    globalThis.__qrLoginRateLimitStore = new Map<string, RateLimitBucket>();
  }
  return globalThis.__qrLoginRateLimitStore;
}

function hasUpstashConfig(): boolean {
  return Boolean(
    String(process.env.UPSTASH_REDIS_REST_URL ?? "").trim() &&
      String(process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim()
  );
}

function resolveBackend(): RateLimitBackend {
  const raw = String(process.env.RATE_LIMIT_BACKEND ?? DEFAULT_BACKEND).trim().toLowerCase();
  if (raw === "upstash") return "upstash";
  if (raw === "memory" || !raw) return "memory";

  // `redis` used to be accepted here even though no Redis TCP implementation
  // existed; that silently routed into the Upstash REST code path. Treat any
  // unsupported production value as Upstash only when its credentials exist,
  // otherwise fall back explicitly and emit one process-level warning.
  const fallback: RateLimitBackend = hasUpstashConfig() ? "upstash" : "memory";
  if (!globalThis.__rateLimitInvalidBackendWarned) {
    globalThis.__rateLimitInvalidBackendWarned = true;
    console.warn("[rate-limit] Unsupported RATE_LIMIT_BACKEND; using safe fallback", {
      configuredBackend: raw,
      fallback
    });
  }
  return fallback;
}

function shouldFailClosed(input: EnforceRateLimitInput): boolean {
  if (!input.failClosedOnBackendError) return false;
  if (process.env.NODE_ENV !== "production") return false;
  return resolveBackend() !== "memory";
}

function cleanupExpiredBuckets(now: number, store: RateLimitStore) {
  const lastCleanupAt = globalThis.__qrLoginRateLimitLastCleanupAt ?? 0;
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  globalThis.__qrLoginRateLimitLastCleanupAt = now;

  for (const [key, bucket] of store.entries()) {
    if (bucket.resetAt <= now) {
      store.delete(key);
    }
  }
}

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

function readBackendTimeoutMs(): number {
  const raw = Number(process.env.RATE_LIMIT_BACKEND_TIMEOUT_MS ?? DEFAULT_BACKEND_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_BACKEND_TIMEOUT_MS;
  return Math.min(10_000, Math.max(500, Math.trunc(raw)));
}

export function getClientIpAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const candidate = forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || "unknown";
  return candidate || "unknown";
}

export function buildRateLimitKey(input: { namespace: string; parts: Array<string | null | undefined> }): string {
  const normalizedParts = input.parts
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);
  return [input.namespace.trim().toLowerCase(), ...normalizedParts].join(":");
}

function enforceInMemoryRateLimit(input: EnforceRateLimitInput): RateLimitResult {
  const now = Date.now();
  const max = clampPositiveInteger(input.max, DEFAULT_MAX);
  const windowMs = clampPositiveInteger(input.windowMs, DEFAULT_WINDOW_MS);
  const store = getStore();

  cleanupExpiredBuckets(now, store);

  const key = `${input.namespace}:${input.key}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: max,
      remaining: Math.max(max - 1, 0),
      retryAfterSeconds: 0,
      resetAt,
      source: "memory",
      backendError: null
    };
  }

  existing.count += 1;
  store.set(key, existing);

  const remaining = Math.max(max - existing.count, 0);
  const retryAfterSeconds = existing.count > max ? Math.max(Math.ceil((existing.resetAt - now) / 1000), 1) : 0;
  return {
    ok: existing.count <= max,
    limit: max,
    remaining,
    retryAfterSeconds,
    resetAt: existing.resetAt,
    source: "memory",
    backendError: null
  };
}

function getUpstashConfig(): { url: string; token: string } | null {
  const url = String(process.env.UPSTASH_REDIS_REST_URL ?? "").trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

type PipelineResultItem = { result?: unknown; error?: string | null };

async function executeUpstashPipeline(commands: Array<Array<string>>): Promise<PipelineResultItem[]> {
  const config = getUpstashConfig();
  if (!config) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), readBackendTimeoutMs());
  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Upstash REST pipeline failed (${response.status})`);
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Invalid Upstash pipeline payload");
    }

    return payload.map((item) => {
      if (item && typeof item === "object") {
        return item as PipelineResultItem;
      }
      return { result: item };
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Upstash REST pipeline timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readPipelineNumber(items: PipelineResultItem[], index: number, fallback: number): number {
  const item = items[index];
  if (!item) return fallback;
  if (item.error) {
    throw new Error(item.error);
  }
  const parsed = toNumber(item.result);
  return parsed ?? fallback;
}

async function enforceUpstashRateLimit(input: EnforceRateLimitInput): Promise<RateLimitResult> {
  const now = Date.now();
  const max = clampPositiveInteger(input.max, DEFAULT_MAX);
  const windowMs = clampPositiveInteger(input.windowMs, DEFAULT_WINDOW_MS);
  const prefix = String(process.env.RATE_LIMIT_REDIS_PREFIX ?? DEFAULT_REDIS_PREFIX).trim() || DEFAULT_REDIS_PREFIX;
  const redisKey = `${prefix}:${input.namespace.trim().toLowerCase()}:${input.key}`;

  const pipeline = await executeUpstashPipeline([
    ["INCR", redisKey],
    ["PEXPIRE", redisKey, String(windowMs), "NX"],
    ["PTTL", redisKey]
  ]);

  const count = readPipelineNumber(pipeline, 0, 1);
  let ttlMs = readPipelineNumber(pipeline, 2, windowMs);
  if (ttlMs <= 0) {
    await executeUpstashPipeline([["PEXPIRE", redisKey, String(windowMs)]]);
    ttlMs = windowMs;
  }

  const remaining = Math.max(max - count, 0);
  const retryAfterSeconds = count > max ? Math.max(Math.ceil(ttlMs / 1000), 1) : 0;
  const resetAt = now + ttlMs;

  return {
    ok: count <= max,
    limit: max,
    remaining,
    retryAfterSeconds,
    resetAt,
    source: "upstash",
    backendError: null
  };
}

function backendUnavailableResult(input: EnforceRateLimitInput, errorMessage: string): RateLimitResult {
  const now = Date.now();
  const windowMs = clampPositiveInteger(input.windowMs, DEFAULT_WINDOW_MS);
  return {
    ok: false,
    limit: clampPositiveInteger(input.max, DEFAULT_MAX),
    remaining: 0,
    retryAfterSeconds: Math.max(Math.ceil(windowMs / 1000), 1),
    resetAt: now + windowMs,
    source: "backend_unavailable",
    backendError: errorMessage
  };
}

export async function enforceRateLimit(input: EnforceRateLimitInput): Promise<RateLimitResult> {
  const backend = resolveBackend();
  if (backend === "memory") {
    return enforceInMemoryRateLimit(input);
  }

  try {
    return await enforceUpstashRateLimit(input);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown rate limiter error";
    if (shouldFailClosed(input)) {
      console.error("[rate-limit] Backend unavailable, fail-closed", {
        namespace: input.namespace,
        key: input.key,
        backend,
        error: errorMessage
      });
      return backendUnavailableResult(input, errorMessage);
    }

    console.warn("[rate-limit] Backend unavailable, fallback to memory", {
      namespace: input.namespace,
      key: input.key,
      backend,
      error: errorMessage
    });
    const memoryResult = enforceInMemoryRateLimit(input);
    return {
      ...memoryResult,
      source: "fallback_memory",
      backendError: errorMessage
    };
  }
}

export function readRateLimitSetting(
  envName: string,
  fallback: number,
  options?: {
    min?: number;
    max?: number;
  }
): number {
  const raw = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  const min = options?.min ?? 1;
  const max = options?.max ?? Number.MAX_SAFE_INTEGER;
  if (raw < min) return min;
  if (raw > max) return max;
  return Math.trunc(raw);
}
