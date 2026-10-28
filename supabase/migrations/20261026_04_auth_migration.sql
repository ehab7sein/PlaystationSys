-- ============================================================================
-- 04 — Migrate existing profiles to Supabase Auth
-- ============================================================================
-- Purpose:
--   The current app authenticates by comparing a PLAINTEXT password in
--   public.profiles. This migration replaces that with real Supabase Auth
--   identities while keeping the SAME profile UUIDs, so every existing
--   session/order/payment/salary foreign key keeps working.
--
--   For each existing profile:
--     * email    = <username>@kontrol.local  (or the email already stored)
--     * password = the current plaintext password, now hashed by bcrypt
--     * id       = profiles.id  (same UUID, so FKs are untouched)
--
-- Prerequisites:
--   * Migrations 01–03 completed.
--   * Full database backup.
--   * Run during a maintenance window. The old plaintext login keeps working
--     until migration 07; migration 04 creates the Auth identities in parallel.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 03.
--
-- Risks:
--   Inserts directly into auth.users/auth.identities (the same UUID and bcrypt
--   password). This is the highest-risk step: test it on a restored copy first.
--   It aborts on duplicate/unresolvable emails rather than dropping users.
--   Migration 07 nulls the legacy plaintext passwords; migration 09 drops the
--   column only after all users have signed in successfully.
--
-- Safe to re-run: yes. Existing auth users are skipped.
--
-- Verification:
--   SELECT count(*) FROM public.profiles p
--   LEFT JOIN auth.users u ON u.id = p.id
--   WHERE u.id IS NULL;   -- must be 0
--
-- Rollback:
--   This migration adds auth users/identities and an email column. Rolling back
--   requires deleting those auth users (only if they were created here) and
--   dropping profiles.email. Do this on a restored copy, not production.
-- ============================================================================

BEGIN;

-- ─── 1. Profile email column + nullable legacy password ────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ALTER COLUMN password DROP NOT NULL;

-- Starting point for the login email. Collisions are resolved in the block
-- below BEFORE the unique index is created.
UPDATE public.profiles p
SET email = (
  CASE
    WHEN coalesce(trim(p.username), '') = '' THEN 'user-' || substring(p.id::text, 1, 8)
    ELSE regexp_replace(lower(trim(p.username)), '[^a-z0-9._-]', '', 'g')
  END
) || '@kontrol.local'
WHERE p.email IS NULL OR trim(p.email) = '';

-- ─── 2. New Supabase Auth users automatically get a profile ─────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_username text;
  v_name     text;
BEGIN
  v_username := coalesce(
    nullif(trim(NEW.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
    'user-' || substring(NEW.id::text, 1, 8)
  );
  v_name := coalesce(
    nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
    v_username
  );

  -- Usernames are global because they are used as a human-friendly login
  -- alias. Make the trigger collision-safe for externally created accounts.
  WHILE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE lower(p.username) = lower(v_username)
      AND p.id <> NEW.id
  ) LOOP
    v_username := v_username || floor(random() * 10000)::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, name, role, is_active, email)
  VALUES (NEW.id, v_username, v_name, 'worker', true, NEW.email)
  ON CONFLICT (id) DO UPDATE
    SET email = coalesce(EXCLUDED.email, public.profiles.email);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── 3. Create a real auth identity for every existing profile ─────────────
DO $$
DECLARE
  p             record;
  v_email       text;
  v_local       text;
  v_auth_email  text;
  v_is_linked   boolean;
  v_password    text;
  v_try         integer;
BEGIN
  -- pgcrypto lives in the extensions schema on Supabase.
  PERFORM set_config('search_path', 'public, extensions, pg_temp', true);

  FOR p IN
    SELECT id, username, name, email, password, created_at
    FROM public.profiles
    ORDER BY created_at, id
  LOOP
    v_email := lower(trim(coalesce(p.email, '')));
    IF v_email = '' OR position('@' in v_email) < 2 THEN
      v_local := regexp_replace(
        lower(coalesce(nullif(trim(p.username), ''), 'user-' || substring(p.id::text, 1, 8))),
        '[^a-z0-9._-]', '', 'g'
      );
      IF v_local = '' THEN
        v_local := 'user-' || substring(p.id::text, 1, 8);
      END IF;
      v_email := v_local || '@kontrol.local';
    END IF;

    SELECT true, lower(u.email)
    INTO v_is_linked, v_auth_email
    FROM auth.users u
    WHERE u.id = p.id;

    -- Already linked (re-run or created through Supabase Auth).
    IF coalesce(v_is_linked, false) THEN
      IF v_auth_email IS NULL THEN
        RAISE EXCEPTION
          'Auth user % (profile %) has no email; resolve it manually before re-running 04.',
          p.id, p.username;
      END IF;

      -- The auth email is authoritative: the login page must resolve to it.
      IF v_auth_email <> v_email THEN
        UPDATE public.profiles SET email = v_auth_email WHERE id = p.id;
      END IF;
      CONTINUE;
    END IF;

    -- If the candidate is already used by another profile or auth user, add a
    -- deterministic suffix. This keeps login-by-username working and avoids
    -- aborting the migration for a fixable duplicate.
    IF EXISTS (
      SELECT 1 FROM public.profiles x
      WHERE lower(x.email) = v_email AND x.id <> p.id
    ) OR EXISTS (
      SELECT 1 FROM auth.users u
      WHERE lower(u.email) = v_email AND u.id <> p.id
    ) THEN
      v_local := split_part(v_email, '@', 1);
      v_email := v_local || '+' || substring(p.id::text, 1, 8) || '@kontrol.local';
      v_try := 1;

      WHILE EXISTS (
        SELECT 1 FROM public.profiles x
        WHERE lower(x.email) = v_email AND x.id <> p.id
      ) OR EXISTS (
        SELECT 1 FROM auth.users u
        WHERE lower(u.email) = v_email AND u.id <> p.id
      ) LOOP
        v_try := v_try + 1;
        v_email := v_local || '+' || substring(p.id::text, 1, 8) || '-' || v_try::text || '@kontrol.local';
      END LOOP;

      RAISE NOTICE 'Profile % had a conflicting email; assigned %', p.username, v_email;
    END IF;

    UPDATE public.profiles SET email = v_email WHERE id = p.id;

    -- Preserve the current password exactly as the old login did (trimmed).
    -- If it was empty, use the documented temporary password.
    v_password := coalesce(nullif(trim(coalesce(p.password, '')), ''), '123456');

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      phone_change,
      phone_change_token,
      email_change_token_current,
      reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      p.id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', p.name, 'username', p.username, 'migrated', true),
      coalesce(p.created_at, now()),
      now(),
      '', '', '', '',
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id,
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      p.id::text,
      p.id,
      jsonb_build_object(
        'sub', p.id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );

    UPDATE public.profiles SET email = v_email WHERE id = p.id;
  END LOOP;

  -- Every profile must be linked to an Auth user before the app cuts over.
  IF EXISTS (
    SELECT 1 FROM public.profiles pr
    LEFT JOIN auth.users u ON u.id = pr.id
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Some profiles could not be linked to auth users. Review the migration notices.';
  END IF;

  -- Auth users have unique emails, so profile emails must be unique as well.
  -- Abort with a clear message instead of failing later on index creation.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE email IS NOT NULL
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate profile emails remain. Resolve them before running the next step.';
  END IF;
END $$;

-- ─── 4. Protect the resolved email from accidental duplicates ───────────────
-- Created after the collision resolution above, so legacy duplicate usernames
-- do not abort an otherwise fixable migration.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

COMMIT;
