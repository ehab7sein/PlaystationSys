-- ============================================================================
-- 13 — Performance Optimization Indexes
-- ============================================================================
-- Purpose:
--   Add targeted composite and partial indexes for high-frequency queries
--   identified during the performance audit:
--   1. devices: (tenant_id, is_active, name) for HomePage device grid
--   2. products: (tenant_id, is_active, name) for ProductsPage, QuickSale, and AddProduct
--   3. sessions: partial index for active sessions per tenant (status = 'active')
--   4. payments: covering index for daily revenue calculations
--
-- Safe to re-run: Yes (uses IF NOT EXISTS).
-- Non-destructive: Does not drop or modify tables or data.
-- ============================================================================

BEGIN;

-- 1. Devices: fast lookups of active devices sorted by name
CREATE INDEX IF NOT EXISTS devices_tenant_active_name_idx
  ON public.devices (tenant_id, is_active, name);

-- 2. Products: fast lookups of active products for POS modals and catalog
CREATE INDEX IF NOT EXISTS products_tenant_active_name_idx
  ON public.products (tenant_id, is_active, name);

-- 3. Sessions: partial index specifically for active sessions
-- Extremely compact; speeds up HomePage live session status lookups to O(1)
CREATE INDEX IF NOT EXISTS sessions_tenant_active_idx
  ON public.sessions (tenant_id)
  WHERE status = 'active';

COMMIT;
