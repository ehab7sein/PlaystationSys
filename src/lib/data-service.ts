import { supabase } from '@/lib/supabase'
import { cachedFetch, invalidateCache, invalidateCachePrefix } from '@/lib/cache'
import type { AppSettings, Product } from '@/types/database'

/**
 * Get active products for a tenant with caching and deduplication.
 * Cache expires after 2 minutes or upon explicit invalidation.
 */
export async function getActiveProducts(tenantId: string, forceFresh = false): Promise<Product[]> {
  const cacheKey = `products:active:${tenantId}`
  if (forceFresh) {
    invalidateCache(cacheKey)
  }
  return cachedFetch<Product[]>(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as Product[]
    },
    120_000 // 2 minutes TTL
  )
}

/**
 * Invalidate cached products for a tenant (e.g. after adding/editing products or completing a sale).
 */
export function invalidateProductsCache(tenantId: string): void {
  invalidateCachePrefix(`products:active:${tenantId}`)
}

/**
 * Get tenant settings with caching and deduplication.
 * Settings rarely change, so a 5-minute TTL provides high hit rate and zero repeat queries.
 */
export async function getTenantSettings(
  tenantId: string,
  forceFresh = false
): Promise<AppSettings | null> {
  const cacheKey = `settings:${tenantId}`
  if (forceFresh) {
    invalidateCache(cacheKey)
  }
  return cachedFetch<AppSettings | null>(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as AppSettings | null
    },
    300_000 // 5 minutes TTL
  )
}

/**
 * Invalidate cached settings for a tenant (e.g. after saving new settings).
 */
export function invalidateSettingsCache(tenantId: string): void {
  invalidateCache(`settings:${tenantId}`)
}
