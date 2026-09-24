import "server-only";

/**
 * Tiny in-process cache with stale-while-revalidate for query results that
 * every viewer shares. Fresh entries are returned as is; stale entries are
 * returned immediately while one refresh runs in the background; concurrent
 * misses await a single execution. The dashboard runs as one replica, so a
 * per-process cache is enough, and the whole store is at most a few hundred
 * small entries (one per site, range and query).
 */
type Entry = { value: unknown; at: number; inflight: Promise<unknown> | null };

const g = globalThis as unknown as { __queryMemo?: Map<string, Entry> };
const store = (g.__queryMemo ??= new Map<string, Entry>());

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e && e.at && now - e.at < ttlMs) return e.value as T;
  if (e?.inflight) return e.at ? (e.value as T) : (e.inflight as Promise<T>);

  const entry: Entry = e ?? { value: undefined, at: 0, inflight: null };
  entry.inflight = fn()
    .then((v) => {
      entry.value = v;
      entry.at = Date.now();
      return v;
    })
    .finally(() => {
      entry.inflight = null;
    });
  store.set(key, entry);
  // Stale value available: hand it back and let the refresh land in the background.
  if (entry.at) {
    entry.inflight.catch(() => {});
    return entry.value as T;
  }
  return entry.inflight as Promise<T>;
}

/** Cache lifetime by range: long ranges move by a rounding error per minute. */
export const ttlFor = (range: number) => (range === 1 ? 15_000 : range === 7 ? 60_000 : 300_000);

/** Resolves once every refresh in flight has landed, so a caller can pace its own work. */
export const settled = () => Promise.allSettled([...store.values()].map((e) => e.inflight).filter(Boolean));
