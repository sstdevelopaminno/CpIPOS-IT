type CacheSource = "hit" | "miss" | "inflight";

type CacheEntry = {
  expiresAt: number;
  value: unknown;
  touchedAt: number;
};

const valueCache = new Map<string, CacheEntry>();
const inflightCache = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 512;

function pruneCache(now: number) {
  for (const [key, entry] of valueCache.entries()) {
    if (entry.expiresAt <= now) {
      valueCache.delete(key);
    }
  }
  if (valueCache.size <= MAX_ENTRIES) return;
  const sorted = Array.from(valueCache.entries()).sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  const removeCount = valueCache.size - MAX_ENTRIES;
  for (let i = 0; i < removeCount; i += 1) {
    valueCache.delete(sorted[i][0]);
  }
}

export async function readThroughRuntimeCache<T>(args: {
  key: string;
  ttlMs: number;
  loader: () => Promise<T>;
}): Promise<{ value: T; source: CacheSource }> {
  const { key, ttlMs, loader } = args;
  const now = Date.now();
  pruneCache(now);

  const cached = valueCache.get(key);
  if (cached && cached.expiresAt > now) {
    cached.touchedAt = now;
    return { value: cached.value as T, source: "hit" };
  }

  const inflight = inflightCache.get(key);
  if (inflight) {
    return { value: (await inflight) as T, source: "inflight" };
  }

  const promise = (async () => {
    const loaded = await loader();
    valueCache.set(key, {
      value: loaded,
      expiresAt: Date.now() + Math.max(50, ttlMs),
      touchedAt: Date.now()
    });
    return loaded;
  })().finally(() => {
    inflightCache.delete(key);
  });

  inflightCache.set(key, promise);
  return { value: (await promise) as T, source: "miss" };
}

export function invalidateRuntimeCacheByPrefix(prefix: string) {
  if (!prefix) return;
  for (const key of valueCache.keys()) {
    if (key.startsWith(prefix)) {
      valueCache.delete(key);
    }
  }
}
