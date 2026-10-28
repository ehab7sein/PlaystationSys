/**
 * Lightweight, tenant-safe in-memory cache and request deduplicator.
 *
 * Rules:
 * 1. Every cache key is strictly prefixed with the tenantId to prevent any cross-tenant data leaks.
 * 2. In-flight requests are deduplicated so simultaneous calls share a single Promise.
 * 3. Stale-time allows instant response for frequently read, slowly changing data (e.g., settings, active products).
 * 4. Explicit invalidation allows instant refresh upon mutations.
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

const memoryStore = new Map<string, CacheEntry<unknown>>()
const inFlightRequests = new Map<string, Promise<unknown>>()

/**
 * Fetch data with cache and in-flight request deduplication.
 * @param key Unique key (MUST include tenantId if tenant-specific)
 * @param fetcher Async function returning the data
 * @param ttlMs Time to live in milliseconds (default: 60,000ms = 1 min)
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 60_000
): Promise<T> {
  const now = Date.now()
  const cached = memoryStore.get(key) as CacheEntry<T> | undefined

  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  // Deduplicate concurrent requests
  const existingPromise = inFlightRequests.get(key) as Promise<T> | undefined
  if (existingPromise) {
    return existingPromise
  }

  const promise = fetcher()
    .then(data => {
      memoryStore.set(key, {
        data,
        timestamp: now,
        expiresAt: now + ttlMs,
      })
      inFlightRequests.delete(key)
      return data
    })
    .catch(err => {
      inFlightRequests.delete(key)
      throw err
    })

  inFlightRequests.set(key, promise)
  return promise
}

/**
 * Invalidate a specific cache key.
 */
export function invalidateCache(key: string): void {
  memoryStore.delete(key)
  inFlightRequests.delete(key)
}

/**
 * Invalidate all keys matching a prefix (e.g., a specific tenant's data).
 */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key)
    }
  }
  for (const key of inFlightRequests.keys()) {
    if (key.startsWith(prefix)) {
      inFlightRequests.delete(key)
    }
  }
}

/**
 * Clear the entire cache (e.g. on logout or tenant switch).
 */
export function clearAllCache(): void {
  memoryStore.clear()
  inFlightRequests.clear()
}
