-- ============================================================================
-- 11 — Make the legacy default tenant a normal shop
-- ============================================================================
-- Purpose:
--   Migration 02 created the legacy backfill tenant with the technical name
--   "KONTROL — النظام الحالي" and the slug "kontrol-default". Those labels were
--   only meant to identify the backfill target. They make the shop look like a
--   special/platform tenant in the UI.
--
--   This migration renames that one row to a normal tenant:
--     name = 'KONTROL'
--     slug = 'kontrol'
--
--   It does NOT delete the tenant, its data, its memberships, or change who
--   owns it. `ehab` remains the Tenant Owner in this example; edit the
--   variables below if you want a different normal name/slug for your shop.
--
-- Prerequisites:
--   * Migration 02 completed (the tenant exists).
--   * Migration 10 completed (the RLS recursion hotfix).
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role).
--
-- What changes:
--   * public.tenants.name and public.tenants.slug for the row whose slug is
--     currently 'kontrol-default'.
--   * One audit_logs row recording the rename.
--
-- Risks:
--   The new slug must be unique. If another tenant already uses 'kontrol', the
--   migration aborts before changing anything. Edit v_new_slug in that case.
--
-- Safe to re-run: yes. If the old slug no longer exists it only prints a NOTICE.
--
-- Verification:
--   SELECT id, name, slug, is_active
--   FROM public.tenants
--   WHERE lower(slug) = 'kontrol';
--
--   No tenant should still have slug = 'kontrol-default'.
--
-- Rollback:
--   UPDATE public.tenants
--   SET name = 'KONTROL — النظام الحالي', slug = 'kontrol-default'
--   WHERE lower(slug) = 'kontrol';
--   Only do that on a copy/backup; the normalized values are the intended state.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_old_slug text := 'kontrol-default';  -- ← legacy backfill slug
  v_new_name text := 'KONTROL';          -- ← normal shop name
  v_new_slug text := 'kontrol';          -- ← normal shop slug (must be unique)
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE lower(slug) = lower(v_old_slug)
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant with slug % was not found; nothing to rename.', v_old_slug;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants
    WHERE lower(slug) = lower(v_new_slug)
      AND id <> v_tenant_id
  ) THEN
    RAISE EXCEPTION
      'Cannot rename tenant: slug % is already used by another tenant. Choose another v_new_slug.',
      v_new_slug;
  END IF;

  UPDATE public.tenants
  SET name = v_new_name,
      slug = v_new_slug,
      updated_at = now()
  WHERE id = v_tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id, action_type, user_id, user_name, notes
  ) VALUES (
    v_tenant_id,
    'tenant_updated',
    NULL,
    'system migration 11',
    'Renamed legacy default tenant from ' || v_old_slug || ' to ' || v_new_slug
  );

  RAISE NOTICE 'Renamed tenant % from % to % (%).',
    v_tenant_id, v_old_slug, v_new_slug, v_new_name;
END $$;

COMMIT;
