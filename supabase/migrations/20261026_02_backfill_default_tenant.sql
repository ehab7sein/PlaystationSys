-- ============================================================================
-- 02 — Backfill the existing data into a default tenant
-- ============================================================================
-- Purpose:
--   * Create one normal tenant ("KONTROL") for the existing shop.
--   * Link every existing row to that tenant.
--   * Create one membership per existing profile using its current role.
--   * Make tenant_id NOT NULL.
--   * Replace global unique constraints with tenant-scoped ones where needed.
--
-- Prerequisites:
--   * Migration 01 completed successfully.
--   * Full backup exists.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 01.
--
-- Risks:
--   Rewrites tenant_id on legacy rows and adds NOT NULL/unique indexes. It
--   aborts with a clear error on duplicate active sessions, duplicate salary
--   periods, multiple settings rows, or orphan tenant links instead of deleting
--   anything automatically. Review those rows, then re-run.
--
-- Safe to re-run: yes. The backfill only touches rows where tenant_id IS NULL.
--
-- Rollback:
--   This migration does not delete rows. To roll back, drop the NOT NULL
--   constraints + tenant-scoped unique indexes and set tenant_id back to NULL:
--     ALTER TABLE ... ALTER COLUMN tenant_id DROP NOT NULL;
--     DROP INDEX IF EXISTS settings_tenant_unique;
--     DROP INDEX IF EXISTS salaries_tenant_user_period_unique;
--     DROP INDEX IF EXISTS sessions_tenant_device_active_unique;
--   Restore the old unique constraints from supabase/schema.sql if needed.
-- ============================================================================

BEGIN;

-- ─── Guard: settings must be a single legacy row before it becomes per-tenant ─
DO $$
BEGIN
  -- On a re-run after go-live there is one settings row per tenant, so only
  -- enforce the single-row rule while the legacy rows are still unscoped.
  IF (SELECT count(*) FROM public.settings) > 1
     AND NOT EXISTS (SELECT 1 FROM public.settings WHERE tenant_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'There are % legacy rows in settings. Keep one row before running this migration.',
      (SELECT count(*) FROM public.settings);
  END IF;
END $$;

-- ─── 1. Default tenant ──────────────────────────────────────────────────────
INSERT INTO public.tenants (name, slug, is_active)
SELECT 'KONTROL', 'kontrol', true
WHERE NOT EXISTS (SELECT 1 FROM public.tenants);

-- ─── 2. Backfill tenant_id ──────────────────────────────────────────────────
DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT id INTO v_tenant
  FROM public.tenants
  ORDER BY created_at ASC
  LIMIT 1;

  -- Legacy databases normally already have one settings row. If the table is
  -- empty, create the default row for the default tenant so the POS has
  -- explicit settings to edit.
  INSERT INTO public.settings (tenant_id, rounding_mode, day_start_hour, low_stock_threshold)
  SELECT v_tenant, 'nearest_5_pounds', 6, 5
  WHERE NOT EXISTS (SELECT 1 FROM public.settings);

  UPDATE public.settings    SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.devices     SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.products    SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.salaries    SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  UPDATE public.audit_logs  SET tenant_id = v_tenant WHERE tenant_id IS NULL;

  -- Sessions inherit the tenant from their device.
  UPDATE public.sessions s
  SET tenant_id = d.tenant_id
  FROM public.devices d
  WHERE s.device_id = d.id
    AND s.tenant_id IS NULL;

  -- Any session whose device is missing falls back to the default tenant.
  UPDATE public.sessions SET tenant_id = v_tenant WHERE tenant_id IS NULL;

  -- Orders inherit the tenant from their session, or the default tenant
  -- when they are standalone product sales.
  UPDATE public.orders o
  SET tenant_id = s.tenant_id
  FROM public.sessions s
  WHERE o.session_id = s.id
    AND o.tenant_id IS NULL;

  UPDATE public.orders SET tenant_id = v_tenant WHERE tenant_id IS NULL;

  -- Order items inherit the tenant from their order.
  UPDATE public.order_items oi
  SET tenant_id = o.tenant_id
  FROM public.orders o
  WHERE oi.order_id = o.id
    AND oi.tenant_id IS NULL;

  UPDATE public.order_items SET tenant_id = v_tenant WHERE tenant_id IS NULL;

  -- Payments inherit the tenant from the session or the order.
  UPDATE public.payments p
  SET tenant_id = s.tenant_id
  FROM public.sessions s
  WHERE p.session_id = s.id
    AND p.tenant_id IS NULL;

  UPDATE public.payments p
  SET tenant_id = o.tenant_id
  FROM public.orders o
  WHERE p.order_id = o.id
    AND p.tenant_id IS NULL;

  UPDATE public.payments SET tenant_id = v_tenant WHERE tenant_id IS NULL;

  -- ─── 3. Memberships for every existing profile ────────────────────────────
  -- Legacy profiles all belong to the default tenant on the FIRST run. If any
  -- membership already exists, this is a re-run after go-live: never attach a
  -- newer global account to the legacy default tenant.
  IF NOT EXISTS (SELECT 1 FROM public.memberships) THEN
    INSERT INTO public.memberships (tenant_id, user_id, role, is_active)
    SELECT
      v_tenant,
      p.id,
      CASE
        WHEN p.role IN ('owner', 'admin', 'worker') THEN p.role
        ELSE 'worker'
      END,
      coalesce(p.is_active, true)
    FROM public.profiles p
    ON CONFLICT (tenant_id, user_id) DO NOTHING;
  ELSE
    RAISE NOTICE 'memberships already contain rows; skipping legacy membership backfill.';
  END IF;
END $$;

-- ─── 3b. Harden tenant deletion (RESTRICT, not CASCADE) ─────────────────────
-- Migration 01 creates these FKs with RESTRICT. This block also upgrades a
-- database where 01 was run before that change. It never deletes tenant data.
DO $$
DECLARE
  t text;
  v_orphans integer;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'settings', 'devices', 'products', 'sessions', 'orders',
    'order_items', 'payments', 'salaries', 'audit_logs'
  ] LOOP
    -- Abort with a readable error if a row points at a missing tenant.
    EXECUTE format(
      'SELECT count(*) FROM public.%I x
       LEFT JOIN public.tenants tn ON tn.id = x.tenant_id
       WHERE x.tenant_id IS NOT NULL AND tn.id IS NULL',
      t
    ) INTO v_orphans;

    IF v_orphans > 0 THEN
      RAISE EXCEPTION
        'Found % row(s) in % with a tenant_id that does not exist. Fix them before migration 02.',
        v_orphans, t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_tenant_id_fkey'
        AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, t || '_tenant_id_fkey');
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT',
      t, t || '_tenant_id_fkey'
    );
  END LOOP;
END $$;

-- ─── 4. Make tenant_id mandatory ────────────────────────────────────────────
ALTER TABLE public.settings    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.devices     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.products    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.sessions    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.orders      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.payments    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.salaries    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.audit_logs  ALTER COLUMN tenant_id SET NOT NULL;

-- ─── 5. Tenant-scoped uniqueness ────────────────────────────────────────────
-- Guard against legacy duplicates. Abort with a readable message instead of
-- failing halfway through index creation; nothing is deleted automatically.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT tenant_id, device_id
    FROM public.sessions
    WHERE status = 'active'
    GROUP BY tenant_id, device_id
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Found % device(s) with more than one active session. Close or review them before running migration 02.',
      v_dupes;
  END IF;

  SELECT count(*) INTO v_dupes
  FROM (
    SELECT tenant_id, user_id, month, year
    FROM public.salaries
    GROUP BY tenant_id, user_id, month, year
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Found % duplicate salary row(s) per employee/period. Resolve them before running migration 02.',
      v_dupes;
  END IF;

  SELECT count(*) INTO v_dupes
  FROM (
    SELECT tenant_id
    FROM public.settings
    GROUP BY tenant_id
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Found % tenant(s) with more than one settings row. Keep one row per tenant before running migration 02.',
      v_dupes;
  END IF;
END $$;

-- One settings row per tenant (also required by the app's upsert).
CREATE UNIQUE INDEX IF NOT EXISTS settings_tenant_unique
  ON public.settings (tenant_id);

-- One salary per (tenant, employee, month, year).
ALTER TABLE public.salaries DROP CONSTRAINT IF EXISTS salaries_user_id_month_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS salaries_tenant_user_period_unique
  ON public.salaries (tenant_id, user_id, month, year);

-- Only one active session per device inside each tenant.
DROP INDEX IF EXISTS public.sessions_device_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_tenant_device_active_unique
  ON public.sessions (tenant_id, device_id)
  WHERE status = 'active';

COMMIT;
