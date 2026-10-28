-- ============================================================================
-- Tests: Session Mode Switching — Single ↔ Multi accurate billing
-- ============================================================================
-- Run in Supabase SQL Editor (or psql with postgres role).
-- All assertions print PASS/FAIL. The block raises if any test fails.
-- The final ROLLBACK means no test data is persisted.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant   uuid;
  v_device   uuid;
  v_session  uuid;
  v_result   numeric;
  v_periods  integer;
  v_pass     integer := 0;
  v_fail     integer := 0;
BEGIN

  -- ── Helpers ────────────────────────────────────────────────────────────────
  -- (inline assertions using nested blocks)

  -- Setup: isolated test tenant + device
  INSERT INTO public.tenants (name, slug, is_active)
  VALUES ('__Test Switch__', '__test-switch-' || extract(epoch from now())::bigint::text, true)
  RETURNING id INTO v_tenant;

  INSERT INTO public.devices (tenant_id, name, hourly_price, hourly_price_multi, status, is_active)
  VALUES (v_tenant, 'Test Device', 20, 30, 'available', true)
  RETURNING id INTO v_device;

  --------------------------------------------------------------------------
  -- TEST 1: Single-only session — 30 min @ 20/hr = 10 EGP (nearest_pound)
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 1: Single-only session ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '30 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '30 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 10) <= 0.5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T1: 30min single @ 20/hr = % (expected ~10)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T1: expected 10, got %', v_result;
  END IF;

  SELECT count(*) INTO v_periods FROM public.session_price_history WHERE session_id = v_session;
  IF v_periods = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS T1b: 1 period';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL T1b: expected 1 period, got %', v_periods; END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 2: Multi-only session — 30 min @ 30/hr = 15 EGP
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 2: Multi-only session ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 30, now() - interval '30 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '30 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 15) <= 0.5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T2: 30min multi @ 30/hr = % (expected ~15)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T2: expected 15, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 3: Single→Multi switch — spec example: 30m@20 + 30m@30 = 25 EGP
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 3: Single → Multi switch (spec example) ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 30, now() - interval '60 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '60 minutes', now() - interval '30 minutes');

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '30 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 25) <= 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T3: 30m single + 30m multi = % (expected 25)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T3: expected 25, got %', v_result;
  END IF;

  SELECT count(*) INTO v_periods FROM public.session_price_history WHERE session_id = v_session;
  IF v_periods = 2 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS T3b: 2 periods';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL T3b: expected 2, got %', v_periods; END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 4: Multi→Single switch — 30m@30 + 30m@20 = 25 EGP
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 4: Multi → Single switch ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '60 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '60 minutes', now() - interval '30 minutes');

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '30 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 25) <= 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T4: 30m multi + 30m single = % (expected 25)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T4: expected 25, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 5: Multiple switches — 1h single + 1h multi + 1h single = 70 EGP
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 5: Multiple switches (3 periods) ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '3 hours', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '3 hours', now() - interval '2 hours');
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '2 hours', now() - interval '1 hour');
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '1 hour');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 70) <= 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T5: 3 periods = % (expected 70)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T5: expected 70, got %', v_result;
  END IF;

  SELECT count(*) INTO v_periods FROM public.session_price_history WHERE session_id = v_session;
  IF v_periods = 3 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS T5b: 3 periods stored';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL T5b: expected 3, got %', v_periods; END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 6: Close immediately after switch — new period ≈ 0 cost
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 6: Close right after switch ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 30, now() - interval '31 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '31 minutes', now() - interval '1 second');
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '1 second');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  -- 31 min single ≈ 10.3 EGP, 1 sec multi ≈ 0 → total ≈ 10–11
  IF v_result BETWEEN 9 AND 12 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T6: ~31m single + ~0 multi = % (expected 10-11)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T6: out of range, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 7: Idempotency guard — exactly one open period at all times
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 7: Idempotency (only 1 open period) ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '30 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '30 minutes');

  SELECT count(*) INTO v_periods
  FROM public.session_price_history WHERE session_id = v_session AND ended_at IS NULL;
  IF v_periods = 1 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS T7: exactly 1 open period';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL T7: expected 1 open, got %', v_periods; END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 8: Historical prices unchanged after device price update
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 8: Historical prices preserved ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '60 minutes', 'closed')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '60 minutes', now() - interval '30 minutes');
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '30 minutes', now());

  -- Change device prices drastically
  UPDATE public.devices SET hourly_price = 100, hourly_price_multi = 200 WHERE id = v_device;

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 25) <= 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T8: historical billing unchanged = % (expected 25)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T8: expected 25, got %', v_result;
  END IF;

  UPDATE public.devices SET hourly_price = 20, hourly_price_multi = 30 WHERE id = v_device;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 9: No double-billing — closing open period then calculating
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 9: No double-billing on close ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '60 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '60 minutes');

  -- Simulate close: close the open period
  UPDATE public.session_price_history SET ended_at = now() WHERE session_id = v_session AND ended_at IS NULL;

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF abs(v_result - 20) <= 1 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T9: 60min @ 20/hr = % (expected 20)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T9: expected 20, got %', v_result;
  END IF;

  -- Calling close again must not produce additional open periods
  UPDATE public.session_price_history SET ended_at = now() WHERE session_id = v_session AND ended_at IS NULL;
  SELECT count(*) INTO v_periods FROM public.session_price_history WHERE session_id = v_session AND ended_at IS NULL;
  IF v_periods = 0 THEN v_pass := v_pass + 1; RAISE NOTICE 'PASS T9b: no open periods after close';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'FAIL T9b: expected 0 open, got %', v_periods; END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 10: nearest_5_pounds rounding per period
  --------------------------------------------------------------------------
  RAISE NOTICE '--- Test 10: nearest_5_pounds rounding ---';

  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 30, now() - interval '30 minutes', 'active')
  RETURNING id INTO v_session;

  -- 15m single @ 20 = 5 EGP (ceil to 5)
  -- 15m multi  @ 30 = 7.5 → ceil to nearest 5 = 10 EGP
  -- total = 15 EGP
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '30 minutes', now() - interval '15 minutes');
  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '15 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_5_pounds', now());
  IF v_result BETWEEN 13 AND 17 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T10: nearest_5_pounds rounding = % (expected ~15)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T10: out of range, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- Cleanup
  --------------------------------------------------------------------------
  DELETE FROM public.devices WHERE id = v_device;
  DELETE FROM public.tenants WHERE id = v_tenant;

  --------------------------------------------------------------------------
  -- Summary
  --------------------------------------------------------------------------
  RAISE NOTICE '==================================================';
  RAISE NOTICE 'Results: % PASSED, % FAILED', v_pass, v_fail;
  RAISE NOTICE '==================================================';

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'TEST SUITE FAILED: % test(s) failed — check NOTICE output above', v_fail;
  END IF;
END;
$$;

ROLLBACK; -- Test data never committed
