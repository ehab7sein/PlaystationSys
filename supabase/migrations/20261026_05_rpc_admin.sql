-- ============================================================================
-- 05 — Admin RPCs (tenant creation, users, roles, passwords)
-- ============================================================================
-- Purpose:
--   All privileged writes go through SECURITY DEFINER functions. The anon key
--   can never create users, change roles, suspend tenants, or read password
--   hashes. Every function re-checks auth.uid() and the caller's membership.
--
-- Prerequisites:
--   * Migrations 01–04 completed.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 04.
--
-- Risks:
--   Adds/replaces SECURITY DEFINER functions. Direct auth.users writes are
--   used only when creating/resetting users. A wrong search_path or missing
--   pgcrypto in `extensions` would make password creation fail; verify the
--   extension schema first.
--
-- Safe to re-run: yes (CREATE OR REPLACE + idempotent inserts).
--
-- Verification:
--   SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--   AND proname IN ('create_tenant','admin_create_tenant_user',...);
-- ============================================================================

BEGIN;

-- ─── Internal: create or reuse a real Supabase Auth user ────────────────────
CREATE OR REPLACE FUNCTION public._ensure_auth_user(
  p_email     text,
  p_password  text,
  p_name      text,
  p_username  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_password text := coalesce(p_password, '');
  v_name     text := coalesce(nullif(trim(p_name), ''), split_part(v_email, '@', 1));
  v_username text;
  v_uid      uuid;
  v_profile_username text;
BEGIN
  IF v_email = '' OR position('@' in v_email) < 2 THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  SELECT u.id INTO v_uid
  FROM auth.users u
  WHERE lower(u.email) = v_email
  LIMIT 1;

  IF v_uid IS NOT NULL THEN
    -- Existing account: reuse it, never reset its password here.
    SELECT p.username INTO v_profile_username
    FROM public.profiles p WHERE p.id = v_uid;

    IF v_profile_username IS NULL THEN
      v_username := coalesce(
        nullif(trim(p_username), ''),
        split_part(v_email, '@', 1)
      );
      WHILE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE lower(p.username) = lower(v_username) AND p.id <> v_uid
      ) LOOP
        v_username := v_username || floor(random() * 10000)::text;
      END LOOP;

      INSERT INTO public.profiles (id, username, name, role, is_active, email)
      VALUES (v_uid, v_username, v_name, 'worker', true, v_email)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email;
    ELSE
      UPDATE public.profiles
      SET name = coalesce(nullif(trim(p_name), ''), name),
          email = v_email
      WHERE id = v_uid
        AND (name IS DISTINCT FROM coalesce(nullif(trim(p_name), ''), name)
             OR email IS DISTINCT FROM v_email);
    END IF;

    RETURN v_uid;
  END IF;

  -- Reject an email that is already attached to a different profile.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = v_email) THEN
    RAISE EXCEPTION 'EMAIL_ALREADY_USED';
  END IF;

  IF char_length(v_password) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;

  v_uid := gen_random_uuid();
  v_username := coalesce(nullif(trim(p_username), ''), split_part(v_email, '@', 1));
  WHILE EXISTS (
    SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(v_username)
  ) LOOP
    v_username := v_username || floor(random() * 10000)::text;
  END LOOP;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    phone_change, phone_change_token, email_change_token_current,
    reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('name', v_name, 'username', v_username),
    now(),
    now(),
    '', '', '', '',
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_uid::text,
    v_uid,
    jsonb_build_object(
      'sub', v_uid::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(), now(), now()
  );

  INSERT INTO public.profiles (id, username, name, role, is_active, email)
  VALUES (v_uid, v_username, v_name, 'worker', true, v_email)
  ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username,
        name = EXCLUDED.name,
        email = EXCLUDED.email;

  RETURN v_uid;
END;
$$;

-- ─── Internal: can the caller manage this existing tenant member? ──────────
CREATE OR REPLACE FUNCTION public._can_manage_tenant_user(
  p_tenant_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.is_platform_admin() THEN true
    WHEN public.tenant_role(p_tenant_id) = 'admin' THEN EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = p_user_id
        AND m.role IN ('admin', 'worker')
    )
    WHEN public.tenant_role(p_tenant_id) = 'owner' THEN EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = p_user_id
        AND m.role = 'worker'
    )
    ELSE false
  END;
$$;

-- ─── Internal: count active owners of a tenant ─────────────────────────────
CREATE OR REPLACE FUNCTION public._count_active_owners(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.tenant_id = p_tenant_id
    AND m.role = 'owner'
    AND m.is_active
    AND p.is_active;
$$;

-- ─── Internal: write an audit row (append-only, all amounts) ───────────────
DROP FUNCTION IF EXISTS public._audit(uuid, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public._audit(
  p_tenant_id  uuid,
  p_action     text,
  p_user_id    uuid,
  p_user_name  text,
  p_notes      text,
  p_session_id uuid DEFAULT NULL,
  p_device_name text DEFAULT NULL,
  p_expected   numeric DEFAULT 0,
  p_paid       numeric DEFAULT 0,
  p_discount   numeric DEFAULT 0,
  p_remaining  numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_logs (
    tenant_id, action_type, session_id, device_name,
    user_id, user_name,
    expected_amount, paid_amount, discount_amount, remaining_amount,
    notes
  ) VALUES (
    p_tenant_id, p_action, p_session_id, p_device_name,
    p_user_id, coalesce(p_user_name, 'مستخدم'),
    coalesce(p_expected, 0), coalesce(p_paid, 0),
    coalesce(p_discount, 0), coalesce(p_remaining, 0),
    p_notes
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── Login alias: username or email → auth email (public for login page) ───
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
  SELECT p.email
  FROM public.profiles p
  WHERE p.is_active
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
    AND (
      (position('@' in lower(trim(p_identifier))) > 1
        AND lower(p.email) = lower(trim(p_identifier)))
      OR
      (position('@' in lower(trim(p_identifier))) = 0
        AND lower(p.username) = lower(trim(p_identifier)))
    )
  LIMIT 1;
$$;

-- ─── My context: profile + memberships + super-admin flag ──────────────────
CREATE OR REPLACE FUNCTION public.get_my_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'username', p.username,
      'name', p.name,
      'role', p.role,
      'is_active', p.is_active,
      'email', p.email,
      'created_at', p.created_at
    ),
    'is_platform_admin', public.is_platform_admin(),
    'memberships', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'tenant_id', m.tenant_id,
          'role', m.role,
          'is_active', m.is_active,
          'created_at', m.created_at,
          'tenant', jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'slug', t.slug,
            'is_active', t.is_active,
            'created_at', t.created_at
          )
        )
        ORDER BY t.name
      )
      FROM public.memberships m
      JOIN public.tenants t ON t.id = m.tenant_id
      WHERE m.user_id = p.id
    ), '[]'::jsonb)
  )
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

-- ─── Create tenant + owner (platform admin only) ───────────────────────────
CREATE OR REPLACE FUNCTION public.create_tenant(
  p_name           text,
  p_slug           text,
  p_owner_email    text,
  p_owner_password text,
  p_owner_name     text,
  p_owner_username text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_slug      text;
  v_owner_id  uuid;
  v_caller    text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED';
  END IF;

  v_slug := regexp_replace(lower(coalesce(nullif(trim(p_slug), ''), p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'tenant-' || substring(gen_random_uuid()::text, 1, 8);
  END IF;
  WHILE EXISTS (SELECT 1 FROM public.tenants t WHERE lower(t.slug) = v_slug) LOOP
    v_slug := v_slug || '-' || floor(random() * 1000)::text;
  END LOOP;

  INSERT INTO public.tenants (name, slug, is_active)
  VALUES (trim(p_name), v_slug, true)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.settings (tenant_id, rounding_mode, day_start_hour, low_stock_threshold)
  VALUES (v_tenant_id, 'nearest_5_pounds', 6, 5);

  v_owner_id := public._ensure_auth_user(
    p_owner_email,
    p_owner_password,
    p_owner_name,
    p_owner_username
  );

  INSERT INTO public.memberships (tenant_id, user_id, role, is_active)
  VALUES (v_tenant_id, v_owner_id, 'owner', true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = 'owner', is_active = true;

  INSERT INTO public.invitations (tenant_id, email, role, status, invited_by, accepted_at)
  VALUES (v_tenant_id, lower(trim(p_owner_email)), 'owner', 'accepted', auth.uid(), now())
  ON CONFLICT (tenant_id, lower(email)) DO UPDATE
    SET role = 'owner', status = 'accepted', accepted_at = now();

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  PERFORM public._audit(
    v_tenant_id,
    'tenant_created',
    auth.uid(),
    v_caller,
    'تم إنشاء النظام "' || trim(p_name) || '" وربط المالك ' || coalesce(p_owner_name, p_owner_email)
  );

  RETURN v_tenant_id;
END;
$$;

-- ─── Update tenant name/slug (platform admin only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.update_tenant(
  p_tenant_id uuid,
  p_name      text,
  p_slug      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug   text;
  v_caller text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'TENANT_NAME_REQUIRED';
  END IF;

  v_slug := regexp_replace(lower(coalesce(nullif(trim(p_slug), ''), trim(p_name))), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  IF v_slug = '' THEN
    v_slug := 'tenant-' || substring(p_tenant_id::text, 1, 8);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE lower(t.slug) = v_slug AND t.id <> p_tenant_id
  ) THEN
    RAISE EXCEPTION 'SLUG_ALREADY_USED';
  END IF;

  UPDATE public.tenants
  SET name = trim(p_name), slug = v_slug, updated_at = now()
  WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  PERFORM public._audit(
    p_tenant_id, 'tenant_updated', auth.uid(), v_caller,
    'تم تحديث بيانات النظام إلى "' || trim(p_name) || '"'
  );
END;
$$;

-- ─── Suspend / activate tenant (platform admin only) ───────────────────────
CREATE OR REPLACE FUNCTION public.set_tenant_status(
  p_tenant_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.tenants
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  PERFORM public._audit(
    p_tenant_id,
    CASE WHEN p_is_active THEN 'tenant_activated' ELSE 'tenant_suspended' END,
    auth.uid(),
    v_caller,
    CASE WHEN p_is_active THEN 'تم تفعيل النظام' ELSE 'تم إيقاف النظام مؤقتاً' END
  );
END;
$$;

-- ─── Create a user inside a tenant (by email) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_tenant_user(
  p_tenant_id uuid,
  p_email     text,
  p_password  text,
  p_name      text,
  p_username  text,
  p_role      text DEFAULT 'worker'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_uid       uuid;
  v_caller    text;
  v_my_role   text := public.tenant_role(p_tenant_id);
  v_existing  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT (public.is_platform_admin() OR public.is_tenant_manager(p_tenant_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_role NOT IN ('owner', 'admin', 'worker') THEN
    RAISE EXCEPTION 'INVALID_ROLE';
  END IF;
  IF p_role = 'owner' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'ONLY_PLATFORM_ADMIN_CAN_ASSIGN_OWNER';
  END IF;
  IF v_my_role = 'owner' AND p_role <> 'worker' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'OWNER_CAN_ONLY_CREATE_STAFF';
  END IF;

  v_uid := public._ensure_auth_user(p_email, p_password, p_name, p_username);

  -- Never let a tenant admin/owner overwrite an existing owner membership.
  SELECT m.role INTO v_existing
  FROM public.memberships m
  WHERE m.tenant_id = p_tenant_id AND m.user_id = v_uid;

  IF v_existing IS NOT NULL
     AND v_existing = 'owner'
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_TENANT_OWNER';
  END IF;
  IF v_existing IS NOT NULL
     AND v_existing = 'admin'
     AND v_my_role = 'owner'
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'OWNER_CANNOT_MODIFY_ADMIN';
  END IF;
  IF v_existing = 'owner'
     AND p_role <> 'owner'
     AND public._count_active_owners(p_tenant_id) <= 1 THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_LAST_OWNER';
  END IF;

  INSERT INTO public.memberships (tenant_id, user_id, role, is_active)
  VALUES (p_tenant_id, v_uid, p_role, true)
  ON CONFLICT (tenant_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = true;

  INSERT INTO public.invitations (tenant_id, email, role, status, invited_by, accepted_at)
  VALUES (p_tenant_id, lower(trim(p_email)), p_role, 'accepted', auth.uid(), now())
  ON CONFLICT (tenant_id, lower(email)) DO UPDATE
    SET role = EXCLUDED.role, status = 'accepted', accepted_at = now();

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  PERFORM public._audit(
    p_tenant_id, 'user_added', auth.uid(), v_caller,
    'تمت إضافة ' || coalesce(p_name, p_email) || ' بدور ' || p_role
  );

  RETURN v_uid;
END;
$$;

-- ─── Change a tenant member's role ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_membership_role(
  p_membership_id uuid,
  p_role          text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m         public.memberships%ROWTYPE;
  v_caller  text;
  v_target  text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_role NOT IN ('owner', 'admin', 'worker') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;

  SELECT * INTO m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;

  IF NOT public._can_manage_tenant_user(m.tenant_id, m.user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF m.role = 'owner' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_TENANT_OWNER';
  END IF;
  IF p_role = 'owner' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'ONLY_PLATFORM_ADMIN_CAN_ASSIGN_OWNER';
  END IF;
  IF p_role = 'admin'
     AND NOT public.is_platform_admin()
     AND public.tenant_role(m.tenant_id) = 'owner' THEN
    RAISE EXCEPTION 'OWNER_CAN_ONLY_MANAGE_STAFF';
  END IF;
  IF m.role = 'owner' AND p_role <> 'owner' AND public._count_active_owners(m.tenant_id) <= 1 THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_LAST_OWNER';
  END IF;

  UPDATE public.memberships SET role = p_role WHERE id = p_membership_id;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_target FROM public.profiles WHERE id = m.user_id;
  PERFORM public._audit(
    m.tenant_id, 'membership_role_changed', auth.uid(), v_caller,
    'تم تغيير دور ' || coalesce(v_target, m.user_id::text) || ' من ' || m.role || ' إلى ' || p_role
  );
END;
$$;

-- ─── Activate / suspend a membership (not the global account) ──────────────
CREATE OR REPLACE FUNCTION public.admin_set_membership_active(
  p_membership_id uuid,
  p_is_active     boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m        public.memberships%ROWTYPE;
  v_caller text;
  v_target text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;

  IF NOT public._can_manage_tenant_user(m.tenant_id, m.user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF m.user_id = auth.uid() AND NOT p_is_active THEN
    RAISE EXCEPTION 'CANNOT_SUSPEND_YOURSELF';
  END IF;
  IF NOT p_is_active
     AND m.role = 'owner'
     AND public._count_active_owners(m.tenant_id) <= 1 THEN
    RAISE EXCEPTION 'CANNOT_SUSPEND_LAST_OWNER';
  END IF;

  UPDATE public.memberships SET is_active = p_is_active WHERE id = p_membership_id;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_target FROM public.profiles WHERE id = m.user_id;
  PERFORM public._audit(
    m.tenant_id,
    CASE WHEN p_is_active THEN 'membership_activated' ELSE 'membership_suspended' END,
    auth.uid(), v_caller,
    CASE WHEN p_is_active THEN 'تم تفعيل عضوية ' ELSE 'تم إيقاف عضوية ' END
      || coalesce(v_target, m.user_id::text)
  );
END;
$$;

-- ─── Remove a user from a tenant (does NOT delete auth/profile/history) ────
CREATE OR REPLACE FUNCTION public.admin_remove_membership(p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  m        public.memberships%ROWTYPE;
  v_caller text;
  v_target text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;

  IF NOT public._can_manage_tenant_user(m.tenant_id, m.user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF m.user_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_YOURSELF';
  END IF;
  IF m.role = 'owner' AND public._count_active_owners(m.tenant_id) <= 1 THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_LAST_OWNER';
  END IF;

  DELETE FROM public.memberships WHERE id = p_membership_id;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_target FROM public.profiles WHERE id = m.user_id;
  PERFORM public._audit(
    m.tenant_id, 'membership_removed', auth.uid(), v_caller,
    'تمت إزالة ' || coalesce(v_target, m.user_id::text) || ' من النظام'
  );
END;
$$;

-- ─── Global account lock (platform admin only) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_profile_active(
  p_user_id   uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller text;
  v_target text;
  v_m      record;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_is_active THEN
    RAISE EXCEPTION 'CANNOT_SUSPEND_YOURSELF';
  END IF;

  -- Do not deactivate the only usable owner of a tenant. A suspended owner
  -- profile cannot administer the tenant, so it must not count as coverage.
  IF NOT p_is_active AND EXISTS (
    SELECT 1
    FROM public.memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id = p_user_id
      AND m.role = 'owner'
      AND m.is_active
      AND p.is_active
      AND (
        SELECT count(*)
        FROM public.memberships o
        JOIN public.profiles op ON op.id = o.user_id
        WHERE o.tenant_id = m.tenant_id
          AND o.role = 'owner'
          AND o.is_active
          AND op.is_active
      ) <= 1
  ) THEN
    RAISE EXCEPTION 'CANNOT_SUSPEND_LAST_OWNER';
  END IF;

  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_target FROM public.profiles WHERE id = p_user_id;

  FOR v_m IN
    SELECT tenant_id FROM public.memberships WHERE user_id = p_user_id
  LOOP
    PERFORM public._audit(
      v_m.tenant_id,
      CASE WHEN p_is_active THEN 'user_activated' ELSE 'user_suspended' END,
      auth.uid(), v_caller,
      CASE WHEN p_is_active THEN 'تم تفعيل حساب ' ELSE 'تم إيقاف حساب ' END
        || coalesce(v_target, p_user_id::text) || ' على مستوى المنصة'
    );
  END LOOP;
END;
$$;

-- ─── Set another user's password (hierarchy enforced) ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_password(
  p_user_id      uuid,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_allowed boolean := false;
  v_caller  text;
  v_target  text;
  v_tenant  uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'USE_CHANGE_MY_PASSWORD';
  END IF;
  IF char_length(coalesce(p_new_password, '')) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;

  IF public.is_platform_admin() THEN
    v_allowed := true;
  ELSE
    -- Global accounts are shared between tenants. A tenant manager may only
    -- reset a password when every tenant membership of that user is under
    -- their own control; otherwise a reset would be a cross-tenant takeover.
    SELECT
      EXISTS (
        SELECT 1
        FROM public.memberships target
        WHERE target.user_id = p_user_id
          AND public._can_manage_tenant_user(target.tenant_id, p_user_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.memberships other
        WHERE other.user_id = p_user_id
          AND NOT public._can_manage_tenant_user(other.tenant_id, p_user_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_user_id
      )
    INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_FOUND';
  END IF;

  SELECT name INTO v_caller FROM public.profiles WHERE id = auth.uid();
  SELECT name INTO v_target FROM public.profiles WHERE id = p_user_id;
  SELECT tenant_id INTO v_tenant
  FROM public.memberships
  WHERE user_id = p_user_id
  ORDER BY created_at
  LIMIT 1;

  IF v_tenant IS NOT NULL THEN
    PERFORM public._audit(
      v_tenant, 'password_reset', auth.uid(), v_caller,
      'تمت إعادة تعيين كلمة مرور ' || coalesce(v_target, p_user_id::text)
    );
  END IF;
END;
$$;

-- ─── Change my own password ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.change_my_password(
  p_old_password text,
  p_new_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF char_length(coalesce(p_new_password, '')) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.encrypted_password = crypt(p_old_password, u.encrypted_password)
  ) THEN
    RAISE EXCEPTION 'INVALID_OLD_PASSWORD';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;

-- ─── Manager approval for discounts (used by the end-session UI) ──────────
CREATE OR REPLACE FUNCTION public.verify_manager_password(
  p_manager_id uuid,
  p_password   text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'name', p.name,
    'role', m.role
  )
  FROM public.profiles p
  JOIN public.memberships m ON m.user_id = p.id
  JOIN public.tenants t ON t.id = m.tenant_id
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_manager_id
    AND m.role IN ('owner', 'admin')
    AND m.is_active
    AND p.is_active
    AND t.is_active
    AND u.encrypted_password = crypt(p_password, u.encrypted_password)
    AND EXISTS (
      SELECT 1
      FROM public.memberships mine
      WHERE mine.user_id = auth.uid()
        AND mine.tenant_id = m.tenant_id
        AND mine.is_active
    )
  LIMIT 1;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public._ensure_auth_user(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._can_manage_tenant_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._count_active_owners(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._audit(uuid, text, uuid, text, text, uuid, text, numeric, numeric, numeric, numeric) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_my_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_context() TO authenticated;

REVOKE ALL ON FUNCTION public.create_tenant(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tenant(text, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_tenant(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tenant(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_tenant_status(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_status(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_create_tenant_user(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_tenant_user(uuid, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_membership_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_membership_role(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_membership_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_membership_active(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_remove_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_membership(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_profile_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_active(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.change_my_password(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_my_password(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_manager_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_manager_password(uuid, text) TO authenticated;

COMMIT;
