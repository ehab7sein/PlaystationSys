-- ============================================================================
-- Tests: 15-Minute Billing Rule for PlayStation Sessions
-- ============================================================================
-- Run in Supabase SQL Editor.
-- Tests all mandatory cases from prompt:
--   • 0 to 14m 59s: 0 EGP
--   • 15m: 5 EGP (at 20 EGP/h)
--   • 20m: 5 EGP
--   • 29m 59s: 5 EGP
--   • 30m: 10 EGP (2 periods, NOT 3)
--   • 44m 59s: 10 EGP
--   • 45m: 15 EGP
--   • 60m: 20 EGP
--   • Tariff switch: Single (20m @ 20/h) + Multi (10m @ 30/h) = 5 EGP
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant   uuid;
  v_device   uuid;
  v_session  uuid;
  v_result   numeric;
  v_pass     integer := 0;
  v_fail     integer := 0;
BEGIN

  -- Setup: isolated test tenant + device
  INSERT INTO public.tenants (name, slug, is_active)
  VALUES ('__Test 15Min__', '__test-15min-' || extract(epoch from now())::bigint::text, true)
  RETURNING id INTO v_tenant;

  INSERT INTO public.devices (tenant_id, name, hourly_price, hourly_price_multi, status, is_active)
  VALUES (v_tenant, 'PS Test Device', 20, 30, 'available', true)
  RETURNING id INTO v_device;

  --------------------------------------------------------------------------
  -- TEST 1: Under 15 minutes — 5 minutes @ 20/hr = 0 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '5 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '5 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T1: 5 min @ 20/hr = % (expected 0)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T1: expected 0, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 2: Under 15 minutes — 14m 59s @ 20/hr = 0 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '899 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '899 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T2: 14m 59s @ 20/hr = % (expected 0)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T2: expected 0, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 3: Exactly 15 minutes — 15m @ 20/hr = 5 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '900 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '900 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T3: 15m @ 20/hr = % (expected 5)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T3: expected 5, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 4: 20 minutes — 20m @ 20/hr = 5 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '20 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '20 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T4: 20m @ 20/hr = % (expected 5)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T4: expected 5, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 5: 29m 59s — 29m 59s @ 20/hr = 5 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '1799 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '1799 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T5: 29m 59s @ 20/hr = % (expected 5)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T5: expected 5, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 6: Exactly 30 minutes — 30m @ 20/hr = 10 EGP (2 periods, NOT 3)
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '1800 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '1800 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 10 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T6: 30m @ 20/hr = % (expected 10)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T6: expected 10, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 7: 44m 59s — @ 20/hr = 10 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '2699 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '2699 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 10 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T7: 44m 59s @ 20/hr = % (expected 10)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T7: expected 10, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 8: 45 minutes — @ 20/hr = 15 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '2700 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '2700 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 15 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T8: 45m @ 20/hr = % (expected 15)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T8: expected 15, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 9: 60 minutes — @ 20/hr = 20 EGP
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 20, now() - interval '3600 seconds', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '3600 seconds');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 20 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T9: 60m @ 20/hr = % (expected 20)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T9: expected 20, got %', v_result;
  END IF;

  DELETE FROM public.session_price_history WHERE session_id = v_session;
  DELETE FROM public.sessions WHERE id = v_session;

  --------------------------------------------------------------------------
  -- TEST 10: Mode Switching — Single 20m @ 20/hr + Multi 10m @ 30/hr = 5 EGP
  -- Single: 1 period (15m) = 5 EGP. Remaining 5m = 0 EGP.
  -- Multi: 0 periods (<15m) = 0 EGP.
  -- Total = 5 EGP.
  --------------------------------------------------------------------------
  INSERT INTO public.sessions (tenant_id, device_id, mode, hourly_price_snapshot, started_at, status)
  VALUES (v_tenant, v_device, 'open', 30, now() - interval '30 minutes', 'active')
  RETURNING id INTO v_session;

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at, ended_at)
  VALUES (v_tenant, v_session, 'single', 20, now() - interval '30 minutes', now() - interval '10 minutes');

  INSERT INTO public.session_price_history (tenant_id, session_id, play_type, hourly_price, started_at)
  VALUES (v_tenant, v_session, 'multi', 30, now() - interval '10 minutes');

  v_result := public.calc_session_total_by_periods(v_session, 'nearest_pound', now());
  IF v_result = 5 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'PASS T10: Single 20m + Multi 10m = % (expected 5)', v_result;
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'FAIL T10: expected 5, got %', v_result;
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
    RAISE EXCEPTION 'TEST SUITE FAILED: % test(s) failed', v_fail;
  END IF;
END;
$$;

ROLLBACK;
