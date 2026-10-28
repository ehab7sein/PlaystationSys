-- ============================================================================
-- 09 — Remove the legacy plaintext password column
-- ============================================================================
-- Purpose:
--   The old app stored passwords in clear text in public.profiles.password.
--   After migration 04 every profile has a real Supabase Auth identity with a
--   bcrypt hash in auth.users.encrypted_password. This file removes the
--   plaintext column so it can never be read again.
--
-- ⚠  RUN THIS ONLY AFTER:
--   1. The new frontend is deployed and every user can sign in.
--   2. You verified: SELECT count(*) FROM profiles p
--                      LEFT JOIN auth.users u ON u.id = p.id
--                      WHERE u.id IS NULL;  -- must be 0
--   3. You took a final backup.
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), only after every user has
--   successfully signed in through Supabase Auth.
--
-- Risks:
--   Drops the legacy plaintext password column permanently. There is no data
--   rollback except restoring the pre-cutover backup. Do not run early.
--
-- This is intentionally a separate file so a failed/early cutover does not
-- destroy the only copy of the passwords.
--
-- Safe to re-run: yes (DROP COLUMN IF EXISTS).
--
-- Rollback:
--   The column can be re-added, but the plaintext values cannot be recovered
--   from it. Restore from the pre-migration backup if you still need them.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE u.id IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION
      '% profile(s) have no Supabase Auth identity. Run migration 04 and resolve them before dropping profiles.password.',
      v_missing;
  END IF;
END $$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS password;

COMMIT;
