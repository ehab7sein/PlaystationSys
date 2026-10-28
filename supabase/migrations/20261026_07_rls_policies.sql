-- ============================================================================
-- 07 — Row Level Security policies (the actual tenant isolation)
-- ============================================================================
-- Purpose:
--   Replace the old permissive `USING (true)` policies with tenant-aware RLS.
--   After this migration the anon key can no longer read or write tenant data.
--
--   Read isolation:  auth.uid() must be an active member of the row's tenant
--                    (or a platform admin).
--   Write isolation: direct writes are allowed only on the small set of tables
--                    managers edit from the UI. All POS/user/tenant mutations
--                    go through the SECURITY DEFINER RPCs from migrations 05/06.
--   Suspension:      a suspended tenant's rows are invisible to its members,
--                    but remain readable by the platform admin.
--
-- Prerequisites:
--   * Migrations 01–06 completed.
--   * The new frontend is ready to deploy (the old anon-only client will stop
--     working immediately after this file is committed).
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migrations 01–06,
--   during the maintenance window. Deploy the new frontend immediately after.
--
-- Risks:
--   * This is the cutover point: the old client and any direct PostgREST writes
--     stop working. Legacy plaintext passwords are nulled here.
--   * If a policy/GRANT is wrong, users can be locked out or, worse, see another
--     tenant. Run the isolation test file immediately and keep the backup ready.
--   * Realtime publication additions are best-effort.
--
-- Safe to re-run: yes (policies are dropped first).
--
-- Verification:
--   -- with only the anon key, these must return 0 rows / 401:
--   GET /rest/v1/tenants
--   GET /rest/v1/devices
--   -- signed in as a tenant user, only their tenant rows are returned.
--
-- Rollback:
--   DROP POLICY ... (all policies below), then restore the permissive policies
--   from supabase/schema.sql. NOT recommended on production.
-- ============================================================================

BEGIN;

-- ─── Retire the legacy plaintext passwords ─────────────────────────────────
-- Auth users now hold the bcrypt hash. The old column is kept (nullable) until
-- migration 09 so a rollback is possible, but its values must never be readable
-- by tenant members. Running this here also means the old frontend must be
-- retired together with this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'password'
  ) THEN
    UPDATE public.profiles SET password = NULL WHERE password IS NOT NULL;
  END IF;
END $$;

-- ─── Enable RLS everywhere ──────────────────────────────────────────────────
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salaries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations     ENABLE ROW LEVEL SECURITY;

-- ─── Drop legacy + previous tenant policies (safe re-run) ──────────────────
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles','settings','devices','products','sessions','orders',
        'order_items','payments','salaries','audit_logs','tenants',
        'memberships','platform_admins','invitations'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ─── profiles ───────────────────────────────────────────────────────────────
-- A user sees their own profile, all profiles in a shared active tenant
-- (needed for names in reports), and a platform admin sees everyone.
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_platform_admin()
    OR public.shares_tenant_with(id)
  );

-- No INSERT/UPDATE/DELETE policies: profiles are created by the auth trigger
-- and changed only through RPCs.

-- ─── tenants ────────────────────────────────────────────────────────────────
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    -- SECURITY DEFINER helper: do NOT query memberships directly here.
    -- A direct policy subquery on memberships would recurse because the
    -- memberships policy also reads tenants.
    OR public.is_tenant_member(tenants.id)
  );

-- No write policies: create/update/suspend go through platform-admin RPCs.

-- ─── memberships ────────────────────────────────────────────────────────────
-- Own membership is always visible (so the app can explain a suspension).
-- Colleagues are visible only while their tenant is active.
CREATE POLICY memberships_select ON public.memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_platform_admin()
    OR (
      public.is_tenant_member(tenant_id)
      AND EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.id = memberships.tenant_id AND t.is_active
      )
    )
  );

-- No write policies: memberships are managed through RPCs only.

-- ─── platform_admins ────────────────────────────────────────────────────────
-- No policies at all: the table is invisible to every client role. The
-- is_platform_admin() helper (SECURITY DEFINER) is the only way to check it.

-- ─── invitations ────────────────────────────────────────────────────────────
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- ─── settings ───────────────────────────────────────────────────────────────
CREATE POLICY settings_select ON public.settings
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY settings_insert ON public.settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY settings_update ON public.settings
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id))
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY settings_delete ON public.settings
  FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- ─── devices ────────────────────────────────────────────────────────────────
CREATE POLICY devices_select ON public.devices
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY devices_insert ON public.devices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- Workers may update status (the trigger below blocks price/name/is_active).
CREATE POLICY devices_update ON public.devices
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant(tenant_id))
  WITH CHECK (public.can_access_tenant(tenant_id));

CREATE POLICY devices_delete ON public.devices
  FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- ─── products ───────────────────────────────────────────────────────────────
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id))
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- ─── operational tables: read for members, write only through RPCs ─────────
CREATE POLICY sessions_select ON public.sessions
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));

-- ─── salaries (managers only) ───────────────────────────────────────────────
CREATE POLICY salaries_select ON public.salaries
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY salaries_insert ON public.salaries
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY salaries_update ON public.salaries
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id))
  WITH CHECK (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

CREATE POLICY salaries_delete ON public.salaries
  FOR DELETE TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- ─── audit log (append-only, managers only) ────────────────────────────────
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_tenant_manager(tenant_id));

-- No INSERT/UPDATE/DELETE policies: only the SECURITY DEFINER RPCs write here.

-- ─── Triggers: protect integrity that RLS cannot express ───────────────────
-- Audit rows must never be edited or deleted, even by a manager or a future
-- RPC. This is what makes the log trustworthy.
CREATE OR REPLACE FUNCTION public.audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_immutable();

-- Workers may toggle device status but must not change pricing/visibility.
CREATE OR REPLACE FUNCTION public.protect_device_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_platform_admin() OR public.is_tenant_manager(OLD.tenant_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.hourly_price IS DISTINCT FROM OLD.hourly_price
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'FORBIDDEN_DEVICE_FIELDS';
  END IF;

  -- Workers may only toggle status, but it must stay consistent with the
  -- session table. The RPCs already enforce this; this blocks direct PATCHes.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'busy' AND NOT EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.tenant_id = OLD.tenant_id AND s.device_id = OLD.id AND s.status = 'active'
    ) THEN
      RAISE EXCEPTION 'DEVICE_STATUS_REQUIRES_SESSION';
    END IF;

    IF NEW.status IN ('available', 'maintenance') AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.tenant_id = OLD.tenant_id AND s.device_id = OLD.id AND s.status = 'active'
    ) THEN
      RAISE EXCEPTION 'DEVICE_HAS_ACTIVE_SESSION';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS devices_protect_fields ON public.devices;
CREATE TRIGGER devices_protect_fields
  BEFORE UPDATE ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_device_fields();

-- A row may never be moved to another tenant by a direct UPDATE.
CREATE OR REPLACE FUNCTION public.prevent_tenant_move()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'TENANT_ID_IS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS settings_tenant_immutable ON public.settings;
CREATE TRIGGER settings_tenant_immutable
  BEFORE UPDATE ON public.settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_move();

DROP TRIGGER IF EXISTS devices_tenant_immutable ON public.devices;
CREATE TRIGGER devices_tenant_immutable
  BEFORE UPDATE ON public.devices
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_move();

DROP TRIGGER IF EXISTS products_tenant_immutable ON public.products;
CREATE TRIGGER products_tenant_immutable
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_move();

DROP TRIGGER IF EXISTS salaries_tenant_immutable ON public.salaries;
CREATE TRIGGER salaries_tenant_immutable
  BEFORE UPDATE ON public.salaries
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_move();

-- Salaries are edited directly by managers, so validate the employee really
-- belongs to that tenant and that created_by cannot be forged. RLS alone only
-- checks the salary row's tenant_id.
CREATE OR REPLACE FUNCTION public.validate_salary_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.user_id = NEW.user_id
      AND m.is_active
  ) THEN
    RAISE EXCEPTION 'SALARY_USER_NOT_IN_TENANT';
  END IF;

  IF NOT public.is_platform_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'SALARY_CREATED_BY_IS_IMMUTABLE';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salaries_validate_membership ON public.salaries;
CREATE TRIGGER salaries_validate_membership
  BEFORE INSERT OR UPDATE ON public.salaries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_salary_row();

-- ─── Privileges: RLS is the second line, GRANT is the first ────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Read-only for the known tenant tables; RLS still filters the rows. Listing
-- them explicitly avoids accidentally exposing a future table/view.
GRANT SELECT ON
  public.profiles,
  public.settings,
  public.devices,
  public.products,
  public.sessions,
  public.orders,
  public.order_items,
  public.payments,
  public.salaries,
  public.audit_logs,
  public.tenants,
  public.memberships,
  public.invitations
TO authenticated;

-- The platform-admin table has no RLS policies (deny-all), but do not even
-- expose it through PostgREST. is_platform_admin() reads it as the owner.
REVOKE ALL ON public.platform_admins FROM anon, authenticated;

-- Direct writes are allowed only where the UI edits rows directly.
-- Everything else is RPC-only.
GRANT INSERT, UPDATE, DELETE ON public.settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.devices  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.salaries TO authenticated;

-- ─── Realtime publication ──────────────────────────────────────────────────
-- Supabase Realtime only streams tables that belong to the supabase_realtime
-- publication. Add the tables the POS subscribes to. The loop tolerates tables
-- that are already members and projects where Realtime is not enabled.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'devices', 'sessions', 'payments', 'orders', 'order_items'
    ] LOOP
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
        WHEN invalid_parameter_value THEN NULL;
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'Could not add % to supabase_realtime (insufficient privilege). Add it manually in Database → Replication.', t;
      END;
    END LOOP;
  END IF;
END $$;

-- PostgREST caches tables, columns, relationships and grants. After this much
-- DDL, force a schema-cache refresh so the dashboard can use the new tables and
-- embedded relationships immediately instead of failing with a stale schema.
NOTIFY pgrst, 'reload schema';

COMMIT;
