-- ============================================================================
-- 12 — Separate the platform Super Admin account from the KONTROL shop
-- ============================================================================
-- Purpose:
--   In this installation the `admin` account was a manager inside the KONTROL
--   shop, so it landed on the shop page (/) instead of the platform dashboard
--   (/admin). The `ehab` account was the only platform admin.
--
--   This migration makes the separation explicit:
--     * `admin` becomes the platform Super Admin and is deactivated inside the
--       KONTROL tenant (the membership row is kept, not deleted).
--     * `ehab` stays the active Tenant Owner of KONTROL and is removed from
--       platform_admins.
--     * The shop keeps all its data and memberships.
--
--   After this migration:
--     admin  -> logs in at /admin, has no active shop, sees the platform page.
--     ehab   -> logs in at /, owns and manages KONTROL only.
--
-- Prerequisites:
--   * Migration 07 completed (platform_admins + RLS).
--   * Migration 11 completed, or a tenant with slug 'kontrol'/'kontrol-default'.
--   * Both `ehab` and `admin` profiles exist and have auth.users rows.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 11.
--   Edit the three variables below if your usernames/slug differ.
--
-- Risks:
--   Platform-level access changes. The migration aborts if `admin` is missing,
--   if `ehab` is not an active owner of the shop, or if the shop is missing.
--   It never deletes a tenant, profile, session, order, payment, device, or
--   product. It only flips one membership to inactive and moves the platform
--   admin row.
--
-- Safe to re-run: yes.
--
-- Verification:
--   SELECT p.username, p.name
--   FROM public.platform_admins pa
--   JOIN public.profiles p ON p.id = pa.user_id;
--   -- Expected: admin
--
--   SELECT p.username, t.name, m.role, m.is_active
--   FROM public.memberships m
--   JOIN public.profiles p ON p.id = m.user_id
--   JOIN public.tenants t ON t.id = m.tenant_id
--   WHERE lower(t.slug) IN ('kontrol', 'kontrol-default')
--   ORDER BY p.username;
--   -- Expected: ehab owner true, admin ... false
--
-- Rollback:
--   BEGIN;
--   DELETE FROM public.platform_admins
--   WHERE user_id = (SELECT id FROM public.profiles WHERE lower(username) = lower('admin'));
--   INSERT INTO public.platform_admins (user_id)
--   SELECT id FROM public.profiles WHERE lower(username) = lower('ehab')
--   ON CONFLICT (user_id) DO NOTHING;
--   UPDATE public.memberships m
--   SET is_active = true
--   FROM public.tenants t, public.profiles p
--   WHERE m.tenant_id = t.id
--     AND m.user_id = p.id
--     AND lower(t.slug) IN ('kontrol', 'kontrol-default')
--     AND lower(p.username) = lower('admin');
--   COMMIT;
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_admin_username text := 'admin';   -- ← platform Super Admin account
  v_owner_username text := 'ehab';    -- ← KONTROL shop owner (stays owner)
  v_shop_slug      text := 'kontrol'; -- ← migration 11 sets this
  v_admin_id  uuid;
  v_owner_id  uuid;
  v_tenant_id uuid;
BEGIN
  SELECT p.id INTO v_admin_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(v_admin_username)
    AND p.is_active
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION
      'Platform admin profile % is missing, inactive, or has no auth user.',
      v_admin_username;
  END IF;

  SELECT p.id INTO v_owner_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(p.username) = lower(v_owner_username)
    AND p.is_active
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION
      'Shop owner profile % is missing, inactive, or has no auth user.',
      v_owner_username;
  END IF;

  IF v_admin_id = v_owner_id THEN
    RAISE EXCEPTION
      'The platform admin and shop owner must be different accounts.';
  END IF;

  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE lower(slug) = lower(v_shop_slug)
  LIMIT 1;

  IF v_tenant_id IS NULL AND lower(v_shop_slug) = 'kontrol' THEN
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE lower(slug) = 'kontrol-default'
    LIMIT 1;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'Shop tenant with slug % was not found. Run migration 11 first.',
      v_shop_slug;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.tenant_id = v_tenant_id
      AND m.user_id = v_owner_id
      AND m.role = 'owner'
      AND m.is_active
  ) THEN
    RAISE EXCEPTION
      '% must be an active owner of the shop before detaching the platform admin.',
      v_owner_username;
  END IF;

  -- Keep the membership row for audit/rollback, but make it inactive so the
  -- platform admin has no active shop and lands on /admin after login.
  UPDATE public.memberships
  SET is_active = false
  WHERE tenant_id = v_tenant_id
    AND user_id = v_admin_id;

  INSERT INTO public.platform_admins (user_id)
  VALUES (v_admin_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- ehab stays the shop owner, but is no longer a platform admin.
  DELETE FROM public.platform_admins
  WHERE user_id = v_owner_id;

  IF EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id NOT IN (v_admin_id, v_owner_id)
  ) THEN
    RAISE NOTICE 'Other platform admins exist; this migration only changed % and %.',
      v_admin_username, v_owner_username;
  END IF;

  RAISE NOTICE 'Platform admin: %. Shop owner: %. Shop slug: %.',
    v_admin_username, v_owner_username, v_shop_slug;
END $$;

COMMIT;
