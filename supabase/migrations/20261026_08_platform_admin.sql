-- ============================================================================
-- 08 — Designate the platform Super Admin
-- ============================================================================
-- Purpose:
--   Create the first platform administrator. Platform admins are the only
--   users who can create/suspend tenants and see every tenant in the central
--   dashboard.
--
-- How to choose the account:
--   Edit `v_username` below to the username of the person who owns the
--   platform. The default is the dedicated `admin` account. If that username
--   is not found, the migration tries `ehab`, then the oldest active
--   owner/admin profile. Use migration 12 on an existing installation where
--   `admin` should become the platform admin and `ehab` should stay shop owner.
--
-- Prerequisites:
--   * Migrations 01–07 completed.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 07.
--   Edit v_username first if the platform owner is not `admin`.
--
-- Risks:
--   Grants platform-wide access to one account. Verify the chosen username
--   before running. The fallback picks the oldest active owner/admin; confirm
--   it is the intended person.
--
-- Safe to re-run: yes. It only inserts when platform_admins is empty.
--
-- Verification:
--   SELECT p.username, p.name FROM platform_admins pa
--   JOIN profiles p ON p.id = pa.user_id;
--
-- Rollback:
--   DELETE FROM platform_admins WHERE user_id = '<uuid>';
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_username text := 'admin';  -- ← change to your platform owner's username
  v_user_id  uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE NOTICE 'platform_admins already has a row; nothing to do.';
  ELSE
    SELECT p.id INTO v_user_id
    FROM public.profiles p
    WHERE lower(p.username) = lower(v_username)
      AND p.is_active
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
    LIMIT 1;

    IF v_user_id IS NULL THEN
      SELECT p.id INTO v_user_id
      FROM public.profiles p
      WHERE lower(p.username) = lower('ehab')
        AND p.is_active
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      SELECT p.id INTO v_user_id
      FROM public.profiles p
      WHERE p.is_active
        AND p.role IN ('owner', 'admin')
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
      ORDER BY p.created_at ASC
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION
        'No active owner/admin profile found. Create/activate a profile first, then re-run this migration.';
    END IF;

    INSERT INTO public.platform_admins (user_id)
    VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    RAISE NOTICE 'Platform Super Admin set to user %', v_user_id;
  END IF;
END $$;

COMMIT;
