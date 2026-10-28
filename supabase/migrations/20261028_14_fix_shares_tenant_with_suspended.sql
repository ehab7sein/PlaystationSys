-- ============================================================================
-- 14 — Fix shares_tenant_with for Suspended Members
-- ============================================================================
-- Purpose:
--   Allow active tenant managers and staff to view profiles of colleagues
--   belonging to the same tenant even when their membership is suspended.
--   Previously, `AND theirs.is_active` prevented managers from seeing suspended
--   members in the User Management UI, causing suspended members to disappear
--   and preventing their reactivation.
--
-- Safe to re-run: Yes.
-- Non-destructive: Replaces function definition only.
-- ============================================================================

BEGIN;

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
      AND t.is_active
  );
$$;

COMMIT;
