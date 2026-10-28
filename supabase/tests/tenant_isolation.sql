-- ============================================================================
-- Tenant isolation verification (run manually in Supabase SQL Editor)
-- ============================================================================
-- Prerequisites:
--   * Migrations 01–12 completed (09 optional, after all users can sign in).
--   * Run the whole file in one go. It starts a transaction and rolls back at
--     the end, so it does NOT leave test data behind.
--
-- What it proves:
--   1. Tenant A cannot read or write tenant B rows (including ID tampering).
--   2. Workers cannot read salaries, edit prices, or write audit rows.
--   3. A suspended tenant's members lose access, while the platform admin keeps it.
--   4. A removed member loses access immediately.
--   5. Managers can still perform normal CRUD in their own tenant.
--   6. The anon key has no direct table access.
--   7. Cross-tenant RPC calls (start_session / close_session / create user) fail.
--
-- Expected result:
--   NOTICE:  ✓ ALL TENANT ISOLATION TESTS PASSED
--   ROLLBACK
-- ============================================================================

BEGIN;

-- ─── Fixtures (as the SQL Editor's postgres role) ──────────────────────────
-- Fixed UUIDs make failures easy to read.
-- A = tenant A, B = tenant B
-- 111… = A owner, 222… = B owner, 333… = A worker, 444… = platform admin

INSERT INTO public.tenants (id, name, slug, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Tenant A', 'test-tenant-a', true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Tenant B', 'test-tenant-b', true);

INSERT INTO public.profiles (id, username, name, role, is_active, email) VALUES
  ('11111111-0000-4000-8000-000000000001', 'test_a', 'A Owner',  'owner',  true, 'test_a@kontrol.local'),
  ('22222222-0000-4000-8000-000000000002', 'test_b', 'B Owner',  'owner',  true, 'test_b@kontrol.local'),
  ('33333333-0000-4000-8000-000000000003', 'test_c', 'C Worker', 'worker', true, 'test_c@kontrol.local'),
  ('44444444-0000-4000-8000-000000000004', 'test_d', 'D Admin',  'admin',  true, 'test_d@kontrol.local');

INSERT INTO public.platform_admins (user_id)
VALUES ('44444444-0000-4000-8000-000000000004');

INSERT INTO public.memberships (id, tenant_id, user_id, role, is_active) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'owner', true),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   '22222222-0000-4000-8000-000000000002', 'owner', true),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
   '33333333-0000-4000-8000-000000000003', 'worker', true);

INSERT INTO public.settings (tenant_id, rounding_mode, day_start_hour, low_stock_threshold) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'nearest_5_pounds', 6, 5),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'nearest_pound', 6, 5);

INSERT INTO public.devices (id, tenant_id, name, hourly_price, status, is_active) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'A Device', 20, 'available', true),
  ('d0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'B Device', 30, 'available', true);

INSERT INTO public.sessions (
  id, tenant_id, device_id, mode, hourly_price_snapshot, started_at, status, created_by
) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', 'open', 20, now() - interval '30 minutes', 'active',
   '11111111-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000002', 'open', 30, now() - interval '30 minutes', 'active',
   '22222222-0000-4000-8000-000000000002');

INSERT INTO public.orders (id, tenant_id, session_id, total, paid_amount, created_by) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 100, 0, '11111111-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000002', 200, 0, '22222222-0000-4000-8000-000000000002');

INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-000000000001', 10, '11111111-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002',
   'f0000000-0000-4000-8000-000000000002', 20, '22222222-0000-4000-8000-000000000002');

INSERT INTO public.salaries (tenant_id, user_id, month, year, base_salary, created_by) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000003',
   extract(month from now())::int, extract(year from now())::int, 5000,
   '11111111-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002',
   extract(month from now())::int, extract(year from now())::int, 9000,
   '22222222-0000-4000-8000-000000000002');

INSERT INTO public.audit_logs (
  tenant_id, action_type, user_id, user_name, expected_amount, paid_amount, notes
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'test_a_log',
   '11111111-0000-4000-8000-000000000001', 'A Owner', 100, 10, 'A audit'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'test_b_log',
   '22222222-0000-4000-8000-000000000002', 'B Owner', 200, 20, 'B audit');

-- ─── Helper to act as a user ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1 — Tenant A can read its own rows but not tenant B's
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SELECT pg_temp.act_as('11111111-0000-4000-8000-000000000001');
SET LOCAL role authenticated;

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.tenants
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 1a: A sees % tenants (expected 1)', n; END IF;

  SELECT count(*) INTO n FROM public.devices
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1b: A sees % B devices', n; END IF;

  SELECT count(*) INTO n FROM public.sessions
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1c: A sees % B sessions', n; END IF;

  SELECT count(*) INTO n FROM public.orders
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1d: A sees % B orders', n; END IF;

  SELECT count(*) INTO n FROM public.payments
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1e: A sees % B payments', n; END IF;

  SELECT count(*) INTO n FROM public.profiles
  WHERE id = '22222222-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1f: A sees B owner profile'; END IF;

  SELECT count(*) INTO n FROM public.profiles
  WHERE id = '33333333-0000-4000-8000-000000000003';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 1g: A cannot see its own worker profile'; END IF;

  SELECT count(*) INTO n FROM public.audit_logs
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1h: A sees B audit logs'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2 — Tenant A cannot write tenant B (RLS WITH CHECK / privilege)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_state text;
  v_rows  int;
BEGIN
  -- Insert a device in tenant B → must fail.
  BEGIN
    INSERT INTO public.devices (tenant_id, name, hourly_price)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'Hacked', 0);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FAIL 2a: cross-tenant device insert was not blocked (state %)', coalesce(v_state, 'success');
  END IF;

  -- Update tenant B device → 0 rows.
  v_state := NULL;
  UPDATE public.devices SET status = 'maintenance'
  WHERE id = 'd0000000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL 2b: A updated % B device rows', v_rows; END IF;

  -- Update tenant B session → must be denied (no UPDATE grant) or affect 0 rows.
  v_state := NULL;
  BEGIN
    UPDATE public.sessions SET status = 'closed'
    WHERE id = 'e0000000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    v_rows := 0;
  END;
  IF v_state IS NOT NULL AND v_state <> '42501' THEN
    RAISE EXCEPTION 'FAIL 2c: unexpected error updating B session (state %)', v_state;
  END IF;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL 2c: A closed % B sessions', v_rows; END IF;

  -- Direct audit insert/update → must fail.
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, action_type, user_name)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'forged', 'A Owner');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FAIL 2d: direct audit insert was not blocked (state %)', coalesce(v_state, 'success');
  END IF;

  -- Move own settings row to tenant B → must fail (RLS + trigger).
  v_state := NULL;
  BEGIN
    UPDATE public.settings
    SET tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'FAIL 2e: settings row was moved to another tenant';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3 — Normal manager CRUD inside the own tenant still works
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.devices (tenant_id, name, hourly_price)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'A New Device', 25)
  RETURNING id INTO v_id;

  UPDATE public.devices SET hourly_price = 26 WHERE id = v_id;
  DELETE FROM public.devices WHERE id = v_id;

  INSERT INTO public.products (tenant_id, name, price, stock_qty)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'A Product', 10, 5);

  UPDATE public.settings SET low_stock_threshold = 7
  WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4 — Worker limits (no salaries, no price edits, no audit writes)
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SELECT pg_temp.act_as('33333333-0000-4000-8000-000000000003');
SET LOCAL role authenticated;

DO $$
DECLARE
  n int;
  v_state text;
BEGIN
  SELECT count(*) INTO n FROM public.devices
  WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n < 1 THEN RAISE EXCEPTION 'FAIL 4a: worker cannot see own devices'; END IF;

  SELECT count(*) INTO n FROM public.salaries
  WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4b: worker sees salaries'; END IF;

  SELECT count(*) INTO n FROM public.audit_logs
  WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4c: worker sees audit logs'; END IF;

  BEGIN
    UPDATE public.products SET price = 0
    WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    n := 0;
  END;
  IF v_state IS NOT NULL AND v_state <> '42501' THEN
    RAISE EXCEPTION 'FAIL 4d: unexpected error editing products (state %)', v_state;
  END IF;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 4d: worker changed % product rows', n;
  END IF;

  v_state := NULL;
  BEGIN
    UPDATE public.devices SET hourly_price = 0
    WHERE id = 'd0000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'FAIL 4e: worker changed a device price';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5 — Cross-tenant RPC calls fail (ID tampering)
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SELECT pg_temp.act_as('11111111-0000-4000-8000-000000000001');
SET LOCAL role authenticated;

DO $$
DECLARE
  v_msg text;
BEGIN
  -- A owner tries to start a session on B's device.
  BEGIN
    PERFORM public.start_session('d0000000-0000-4000-8000-000000000002', 'open', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 5a: cross-tenant start_session (got %)', coalesce(v_msg, 'no error');
  END IF;

  -- A owner tries to close B's session.
  v_msg := NULL;
  BEGIN
    PERFORM public.close_session('e0000000-0000-4000-8000-000000000002', 0, 0, NULL, NULL, NULL, 'x');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 5b: cross-tenant close_session (got %)', coalesce(v_msg, 'no error');
  END IF;

  -- A owner tries to add a user to B.
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_create_tenant_user(
      'bbbbbbbb-0000-4000-8000-000000000002',
      'intruder@kontrol.local', '123456', 'Intruder', 'intruder', 'worker'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 5c: cross-tenant add user (got %)', coalesce(v_msg, 'no error');
  END IF;

  -- A owner cannot promote a worker to owner (platform-only).
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_set_membership_role('c0000000-0000-4000-8000-000000000003', 'owner');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'ONLY_PLATFORM_ADMIN_CAN_ASSIGN_OWNER' THEN
    RAISE EXCEPTION 'FAIL 5d: owner promoted worker to owner (got %)', coalesce(v_msg, 'no error');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6 — Suspended tenant: members lose access, platform admin keeps it
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
UPDATE public.tenants SET is_active = false WHERE id = 'bbbbbbbb-0000-4000-8000-000000000002';
SELECT pg_temp.act_as('22222222-0000-4000-8000-000000000002');
SET LOCAL role authenticated;

DO $$
DECLARE
  n int;
  v_state text;
BEGIN
  SELECT count(*) INTO n FROM public.devices
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6a: suspended tenant member still sees devices'; END IF;

  -- Own membership is still visible so the UI can explain the suspension.
  SELECT count(*) INTO n FROM public.memberships
  WHERE user_id = '22222222-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6b: suspended member cannot see own membership'; END IF;

  -- Writes must be blocked too, not just reads.
  v_state := NULL;
  BEGIN
    INSERT INTO public.devices (tenant_id, name, hourly_price)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'Blocked Device', 30);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FAIL 6c: suspended member inserted a device (state %)', coalesce(v_state, 'success');
  END IF;

  UPDATE public.settings SET low_stock_threshold = 99
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6d: suspended member changed % settings row(s)', n;
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM public.start_session('d0000000-0000-4000-8000-000000000002', 'open', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM 'P0001' THEN
    RAISE EXCEPTION 'FAIL 6e: suspended member reached start_session (state %)', coalesce(v_state, 'success');
  END IF;
END $$;

RESET role;
SELECT pg_temp.act_as('44444444-0000-4000-8000-000000000004');
SET LOCAL role authenticated;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.tenants
  WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 6f: platform admin sees % tenants (expected 2)', n; END IF;

  SELECT count(*) INTO n FROM public.devices
  WHERE tenant_id = 'bbbbbbbb-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6g: platform admin lost suspended tenant data'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7 — Removed member loses access immediately
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
DELETE FROM public.memberships WHERE id = 'c0000000-0000-4000-8000-000000000003';
SELECT pg_temp.act_as('33333333-0000-4000-8000-000000000003');
SET LOCAL role authenticated;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.devices
  WHERE tenant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7: removed member still sees tenant devices'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7b — Super Admin platform flows (create/manage tenant, add member)
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SELECT pg_temp.act_as('44444444-0000-4000-8000-000000000004');
SET LOCAL role authenticated;

DO $$
DECLARE
  v_tenant uuid;
  n int;
BEGIN
  v_tenant := public.create_tenant(
    'Test C', 'test-c', 'c_owner@kontrol.local', '123456', 'C Owner', 'c_owner'
  );
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FAIL 7b: create_tenant returned NULL'; END IF;

  SELECT count(*) INTO n FROM public.tenants
  WHERE id = v_tenant AND name = 'Test C' AND is_active;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7c: created tenant not visible to platform admin'; END IF;

  SELECT count(*) INTO n FROM public.memberships
  WHERE tenant_id = v_tenant AND role = 'owner' AND is_active;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7d: created tenant has % owners (expected 1)', n; END IF;

  PERFORM public.set_tenant_status(v_tenant, false);
  SELECT count(*) INTO n FROM public.tenants WHERE id = v_tenant AND is_active = false;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7e: tenant suspension did not persist'; END IF;

  PERFORM public.set_tenant_status(v_tenant, true);
  PERFORM public.admin_create_tenant_user(
    v_tenant, 'c_worker@kontrol.local', '123456', 'C Worker', 'c_worker', 'worker'
  );
  SELECT count(*) INTO n FROM public.memberships
  WHERE tenant_id = v_tenant AND role = 'worker' AND is_active;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7f: platform admin could not add a worker'; END IF;

  PERFORM public.update_tenant(v_tenant, 'Test C2', 'test-c2');
  SELECT count(*) INTO n FROM public.tenants
  WHERE id = v_tenant AND name = 'Test C2' AND slug = 'test-c2';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7g: platform admin could not update a tenant'; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7c — A tenant owner cannot escalate to platform-level actions
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SELECT pg_temp.act_as('11111111-0000-4000-8000-000000000001');
SET LOCAL role authenticated;

DO $$
DECLARE
  v_msg text;
BEGIN
  v_msg := NULL;
  BEGIN
    PERFORM public.create_tenant(
      'Hacked', 'hacked', 'hacked@kontrol.local', '123456', 'Hacked', 'hacked'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 7h: tenant owner created a tenant (got %)', coalesce(v_msg, 'no error');
  END IF;

  v_msg := NULL;
  BEGIN
    PERFORM public.set_tenant_status('aaaaaaaa-0000-4000-8000-000000000001', false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 7i: tenant owner suspended a tenant (got %)', coalesce(v_msg, 'no error');
  END IF;

  v_msg := NULL;
  BEGIN
    PERFORM public.admin_set_profile_active('33333333-0000-4000-8000-000000000003', false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 7j: tenant owner deactivated a global account (got %)', coalesce(v_msg, 'no error');
  END IF;

  -- Shared global user: resetting the other tenant owner's password would be
  -- a cross-tenant takeover and must be denied.
  v_msg := NULL;
  BEGIN
    PERFORM public.admin_set_user_password('22222222-0000-4000-8000-000000000002', 'abcdef');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_msg IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'FAIL 7k: tenant owner reset another owner password (got %)', coalesce(v_msg, 'no error');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8 — Anon key has no direct table access
-- ─────────────────────────────────────────────────────────────────────────────
RESET role;
SET LOCAL role anon;

DO $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    PERFORM 1 FROM public.tenants LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FAIL 8: anon can read tenants (state %)', coalesce(v_state, 'success');
  END IF;
END $$;

RESET role;

DO $$ BEGIN
  RAISE NOTICE '✓ ALL TENANT ISOLATION TESTS PASSED';
END $$;

ROLLBACK;
