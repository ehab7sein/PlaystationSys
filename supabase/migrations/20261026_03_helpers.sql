-- ============================================================================
-- 03 — Authorization helper functions
-- ============================================================================
-- Purpose:
--   Central place for the tenant/role checks used by RLS policies and RPCs.
--   Keeping them SECURITY DEFINER avoids recursive RLS lookups on memberships.
--
-- Prerequisites:
--   * Migration 01 and 02 completed.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 02.
--
-- Risks:
--   Replaces helper functions only; no table data is changed. If a helper is
--   wrong, RLS/RPC checks can be too strict or too loose, so run the tests in
--   supabase/tests/tenant_isolation.sql immediately after migration 07.
--
-- Notes:
--   * auth.uid() comes from the Supabase Auth JWT. It is never supplied by the
--     browser as a query parameter, so it cannot be spoofed through PostgREST.
--   * These helpers are safe to expose: they only answer boolean/role questions
--     about the CALLER's own identity.
-- ============================================================================

BEGIN;

-- ─── Is the caller a platform (Super Admin) user? ───────────────────────────
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    JOIN public.profiles p ON p.id = pa.user_id
    WHERE pa.user_id = auth.uid()
      AND p.is_active
  );
$$;

-- ─── Is the caller an active member of this tenant? ─────────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = auth.uid()
      AND m.is_active
      AND p.is_active
  );
$$;

-- ─── Caller's role inside an ACTIVE tenant (NULL when not a member) ─────────
-- A suspended tenant intentionally returns NULL: every manager/owner check
-- must fail while the platform has suspended the tenant.
CREATE OR REPLACE FUNCTION public.tenant_role(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.role
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  JOIN public.tenants t ON t.id = m.tenant_id
  WHERE m.tenant_id = p_tenant_id
    AND m.user_id = auth.uid()
    AND m.is_active
    AND p.is_active
    AND t.is_active
  LIMIT 1;
$$;

-- ─── Tenant Owner or Tenant Admin in an active tenant? ─────────────────────
CREATE OR REPLACE FUNCTION public.is_tenant_manager(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = auth.uid()
      AND m.is_active
      AND p.is_active
      AND t.is_active
      AND m.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.tenant_id = p_tenant_id
      AND m.user_id = auth.uid()
      AND m.is_active
      AND p.is_active
      AND t.is_active
      AND m.role = 'owner'
  );
$$;

-- ─── Can the caller read/write tenant data? ────────────────────────────────
-- Platform admins can access all tenants (support / central dashboard).
-- Tenant users lose access while their tenant is suspended.
CREATE OR REPLACE FUNCTION public.can_access_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.is_platform_admin()
    OR (
      public.is_tenant_member(p_tenant_id)
      AND EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.id = p_tenant_id AND t.is_active
      )
    );
$$;

-- ─── Does the caller share an active tenant with another user? ─────────────
-- Used by the profiles SELECT policy so a staff member can see colleagues
-- (names/roles in the UI) but never users from another tenant.
CREATE OR REPLACE FUNCTION public.shares_tenant_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships mine
    JOIN public.memberships theirs
      ON theirs.tenant_id = mine.tenant_id
    JOIN public.tenants t
      ON t.id = mine.tenant_id
    JOIN public.profiles me
      ON me.id = mine.user_id
    WHERE mine.user_id = auth.uid()
      AND mine.is_active
      AND me.is_active
      AND theirs.user_id = p_user_id
      AND theirs.is_active
      AND t.is_active
  );
$$;

-- ─── updated_at maintenance ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_touch_updated_at ON public.tenants;
CREATE TRIGGER tenants_touch_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- ─── Grants ────────────────────────────────────────────────────────────────
-- Policies are evaluated with the caller's role, so the caller must be able
-- to execute these helpers. They do not expose tenant rows.
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_tenant_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_tenant_with(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_role(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_manager(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_owner(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shares_tenant_with(uuid) TO anon, authenticated;

COMMIT;
