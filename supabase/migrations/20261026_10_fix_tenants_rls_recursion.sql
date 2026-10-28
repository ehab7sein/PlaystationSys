-- ============================================================================
-- 10 — Fix infinite recursion between tenants and memberships RLS policies
-- ============================================================================
-- Purpose:
--   The first version of `tenants_select` queried `public.memberships`
--   directly:
--
--     USING (is_platform_admin() OR EXISTS (SELECT 1 FROM memberships ...))
--
--   The memberships policy also reads tenants, which makes PostgreSQL raise:
--
--     ERROR: infinite recursion detected in policy for relation "memberships"
--
--   This migration replaces the tenants policy with a call to the existing
--   SECURITY DEFINER helper `public.is_tenant_member(tenant_id)`. The helper
--   runs as its owner and therefore bypasses RLS, breaking the cycle.
--
-- Prerequisites:
--   * Migration 03 (helpers) completed.
--   * Migration 07 (RLS policies) completed.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role).
--   Run this once after migration 07 on any database that was created with the
--   original tenants policy. Fresh installations that already ran the updated
--   migration 07 can still run this file; it is idempotent.
--
-- What changes:
--   * Drop and recreate ONLY public.tenants_select.
--   * No table data, grants, memberships or tenant statuses are changed.
--
-- Risks:
--   Temporarily drops one SELECT policy inside a transaction. The policy is
--   recreated before COMMIT. If the transaction fails, it rolls back.
--
-- Safe to re-run: yes.
--
-- Verification:
--   -- As a tenant member, selecting the tenant row must work:
--   SELECT id, name, is_active FROM public.tenants LIMIT 5;
--
--   -- The policy must not contain a direct SELECT from memberships:
--   SELECT qual
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename = 'tenants'
--     AND policyname = 'tenants_select';
--
-- Rollback:
--   Restore the old policy only on a copy/backup:
--   DROP POLICY IF EXISTS tenants_select ON public.tenants;
--   CREATE POLICY tenants_select ON public.tenants
--     FOR SELECT TO authenticated
--     USING (public.is_platform_admin() OR EXISTS (...));
--   Do NOT restore the recursive version on production.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS tenants_select ON public.tenants;

CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    -- SECURITY DEFINER, so this does not re-enter the memberships policy.
    OR public.is_tenant_member(tenants.id)
  );

COMMIT;
