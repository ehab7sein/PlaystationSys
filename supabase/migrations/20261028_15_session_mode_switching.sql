-- ============================================================================
-- 15 — Session Mode Switching (Single ↔ Multi with accurate per-period billing)
-- ============================================================================
-- Purpose:
--   Implement accurate per-period billing when switching between single-player
--   and multiplayer modes mid-session.
--   Each period is billed at its own rate; no retroactive repricing.
--
--   Key changes:
--   • session_price_history table with play_type column
--   • change_session_price: open to all tenant members (not just admin/owner)
--   • Idempotency guard: same-price switch is a no-op
--   • start_session: records initial price period with play_type
--   • calc_session_total_by_periods: updated with fallback to snapshot
--   • close_session: closes open period then sums all periods
--
-- Safe to re-run: yes (CREATE IF NOT EXISTS, CREATE OR REPLACE).
-- ============================================================================

BEGIN;

-- ─── 1. session_price_history table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_price_history (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  session_id   uuid        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  play_type    text        NOT NULL DEFAULT 'single' CHECK (play_type IN ('single', 'multi')),
  hourly_price numeric(10,2) NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_by   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Add play_type column if table already existed without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'session_price_history'
      AND column_name  = 'play_type'
  ) THEN
    ALTER TABLE public.session_price_history
      ADD COLUMN play_type text NOT NULL DEFAULT 'single'
      CHECK (play_type IN ('single', 'multi'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS session_price_history_session_idx ON public.session_price_history(session_id);
CREATE INDEX IF NOT EXISTS session_price_history_tenant_idx  ON public.session_price_history(tenant_id);

-- ─── 2. RLS on session_price_history ───────────────────────────────────────
ALTER TABLE public.session_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sph_tenant_isolation" ON public.session_price_history;
CREATE POLICY "sph_tenant_isolation"
  ON public.session_price_history
  FOR ALL
  USING (public.can_access_tenant(tenant_id))
  WITH CHECK (public.can_access_tenant(tenant_id));

-- Allow realtime on this table (best-effort, ignore if already added)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.session_price_history;
EXCEPTION WHEN others THEN NULL; END $$;

-- ─── 3. start_session — record first price period with play_type ────────────
CREATE OR REPLACE FUNCTION public.start_session(
  p_device_id       uuid,
  p_mode            text,
  p_planned_minutes integer DEFAULT NULL,
  p_hourly_price    numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d           public.devices%ROWTYPE;
  v_session   uuid;
  v_price     numeric;
  v_play_type text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_mode NOT IN ('open', 'fixed') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF p_mode = 'fixed' AND (p_planned_minutes IS NULL OR p_planned_minutes < 1) THEN
    RAISE EXCEPTION 'PLANNED_MINUTES_REQUIRED';
  END IF;

  SELECT * INTO d FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(d.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT d.is_active THEN RAISE EXCEPTION 'DEVICE_INACTIVE'; END IF;
  IF d.status <> 'available' THEN RAISE EXCEPTION 'DEVICE_NOT_AVAILABLE'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.tenant_id = d.tenant_id AND s.device_id = d.id AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'DEVICE_ALREADY_BUSY';
  END IF;

  v_price := coalesce(p_hourly_price, d.hourly_price);

  -- Determine play_type by comparing price to device's multi price
  IF d.hourly_price_multi IS NOT NULL AND d.hourly_price_multi > 0
     AND abs(v_price - d.hourly_price_multi) < 0.01 THEN
    v_play_type := 'multi';
  ELSE
    v_play_type := 'single';
  END IF;

  INSERT INTO public.sessions (
    tenant_id, device_id, mode, planned_minutes,
    hourly_price_snapshot, started_at, status, created_by
  ) VALUES (
    d.tenant_id, d.id, p_mode,
    CASE WHEN p_mode = 'fixed' THEN p_planned_minutes ELSE NULL END,
    v_price, now(), 'active', auth.uid()
  )
  RETURNING id INTO v_session;

  -- Record initial price period
  INSERT INTO public.session_price_history (
    tenant_id, session_id, play_type, hourly_price, started_at, created_by
  ) VALUES (
    d.tenant_id, v_session, v_play_type, v_price, now(), auth.uid()
  );

  UPDATE public.devices SET status = 'busy' WHERE id = d.id;

  RETURN v_session;
END;
$$;

-- ─── 4. change_session_price ─────────────────────────────────────────────────
--   • Open to ALL authenticated tenant members (not just admin/owner).
--   • Idempotency: if the session already uses this exact price, return early.
--   • Closes the current open period and opens a new one atomically.
--   • Prevents overlapping open periods from concurrent requests.
CREATE OR REPLACE FUNCTION public.change_session_price(
  p_session_id   uuid,
  p_hourly_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s           public.sessions%ROWTYPE;
  d           public.devices%ROWTYPE;
  v_uid       uuid := auth.uid();
  v_now       timestamptz := now();
  v_play_type text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_hourly_price IS NULL OR p_hourly_price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  -- Lock the session row to prevent concurrent switch calls
  SELECT * INTO s FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(s.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;

  -- Idempotency guard: same price → no-op (covers double-click scenario)
  IF abs(s.hourly_price_snapshot - p_hourly_price) < 0.01 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'hourly_price_snapshot', p_hourly_price,
      'skipped', true
    );
  END IF;

  -- Determine new play_type
  SELECT * INTO d FROM public.devices WHERE id = s.device_id;
  IF d.hourly_price_multi IS NOT NULL AND d.hourly_price_multi > 0
     AND abs(p_hourly_price - d.hourly_price_multi) < 0.01 THEN
    v_play_type := 'multi';
  ELSE
    v_play_type := 'single';
  END IF;

  -- Close ALL open periods at exactly v_now (handles any concurrent leak)
  UPDATE public.session_price_history
  SET ended_at = v_now
  WHERE session_id = s.id AND ended_at IS NULL;

  -- Open a new period for the new price
  INSERT INTO public.session_price_history (
    tenant_id, session_id, play_type, hourly_price, started_at, created_by
  ) VALUES (
    s.tenant_id, s.id, v_play_type, p_hourly_price, v_now, v_uid
  );

  -- Update snapshot so the card displays the current rate
  UPDATE public.sessions
  SET hourly_price_snapshot = p_hourly_price
  WHERE id = s.id;

  PERFORM public._audit(
    s.tenant_id,
    'price_change',
    v_uid,
    (SELECT name FROM public.profiles WHERE id = v_uid),
    'تحويل إلى ' || v_play_type || ' — السعر ' || p_hourly_price::text || ' ج/ساعة',
    s.id,
    (SELECT name FROM public.devices WHERE id = s.device_id),
    p_hourly_price,
    0, 0, 0
  );

  RETURN jsonb_build_object(
    'ok', true,
    'hourly_price_snapshot', p_hourly_price,
    'play_type', v_play_type
  );
END;
$$;

-- ─── 5. calc_session_total_by_periods ────────────────────────────────────────
--   • Sums each period's cost at its own rate and rounding mode.
--   • Fallback to snapshot-based calculation if no history rows exist
--     (for sessions created before this migration).
--   • Uses LEAST(period.ended_at, v_end) to cap at the requested end time.
CREATE OR REPLACE FUNCTION public.calc_session_total_by_periods(
  p_session_id    uuid,
  p_rounding_mode text        DEFAULT 'nearest_5_pounds',
  p_end_time      timestamptz DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s            public.sessions%ROWTYPE;
  v_total      numeric := 0;
  h            record;
  v_end        timestamptz;
  v_period_end timestamptz;
  v_seconds    numeric;
  v_periods    integer;
  v_price      numeric;
  v_has_hist   boolean := false;
BEGIN
  SELECT * INTO s FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_end := COALESCE(p_end_time, s.ended_at, now());

  FOR h IN
    SELECT hourly_price, started_at, ended_at
    FROM public.session_price_history
    WHERE session_id = p_session_id
      AND started_at <= v_end
    ORDER BY started_at ASC
  LOOP
    v_has_hist := true;
    v_period_end := LEAST(COALESCE(h.ended_at, v_end), v_end);
    v_seconds    := GREATEST(0, EXTRACT(EPOCH FROM (v_period_end - h.started_at)));
    v_periods    := FLOOR(v_seconds / 900.0);
    IF v_periods <= 0 THEN CONTINUE; END IF;

    v_price := v_periods * (h.hourly_price / 4.0);
    v_total := v_total + v_price;
  END LOOP;

  -- Fallback: session predates the price-history feature
  IF NOT v_has_hist THEN
    v_seconds := GREATEST(0, EXTRACT(EPOCH FROM (v_end - s.started_at)));
    v_periods := FLOOR(v_seconds / 900.0);
    IF v_periods > 0 THEN
      v_total := v_periods * (s.hourly_price_snapshot / 4.0);
    END IF;
  END IF;

  RETURN ROUND(v_total, 2);
END;
$$;

-- ─── 6. close_session — period-aware billing ─────────────────────────────────
--   Closes the last open period at v_end, then delegates to
--   calc_session_total_by_periods. All other logic is unchanged.
CREATE OR REPLACE FUNCTION public.close_session(
  p_session_id       uuid,
  p_received         numeric,
  p_discount         numeric DEFAULT 0,
  p_discount_reason  text    DEFAULT NULL,
  p_manager_id       uuid    DEFAULT NULL,
  p_manager_password text    DEFAULT NULL,
  p_note             text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  s               public.sessions%ROWTYPE;
  d               public.devices%ROWTYPE;
  v_uid           uuid := auth.uid();
  v_role          text;
  v_is_manager    boolean := false;
  v_manager_name  text;
  v_rounding      text := 'nearest_5_pounds';
  v_end           timestamptz := now();
  v_time_price    numeric := 0;
  v_products      numeric := 0;
  v_gross         numeric := 0;
  v_discount      numeric := greatest(coalesce(p_discount, 0), 0);
  v_net           numeric := 0;
  v_received      numeric := greatest(coalesce(p_received, 0), 0);
  v_collected     numeric := 0;
  v_remaining     numeric := 0;
  v_order         uuid;
  v_other         uuid;
  v_caller        text;
  v_note          text := nullif(trim(p_note), '');
  v_notes         text;
  v_actions       text;
  v_audit         uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO s FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(s.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_ALREADY_CLOSED'; END IF;

  SELECT * INTO d FROM public.devices WHERE id = s.device_id;

  SELECT coalesce(
    (SELECT rounding_mode FROM public.settings WHERE tenant_id = s.tenant_id LIMIT 1),
    'nearest_5_pounds'
  ) INTO v_rounding;

  -- Close any open price periods at exactly v_end (idempotent)
  UPDATE public.session_price_history
  SET ended_at = v_end
  WHERE session_id = s.id AND ended_at IS NULL;

  -- ── 1. Time price from periods (with snapshot fallback for legacy sessions)
  v_time_price := public.calc_session_total_by_periods(s.id, v_rounding, v_end);

  -- ── 2. Products total
  SELECT coalesce(sum(oi.unit_price_snapshot * oi.qty), 0)
  INTO v_products
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id;

  v_gross := v_time_price + v_products;

  -- ── 3. Discount authorization
  SELECT public.tenant_role(s.tenant_id) INTO v_role;
  v_is_manager := public.is_platform_admin() OR v_role IN ('owner', 'admin');

  IF v_discount > 0 AND NOT v_is_manager THEN
    IF p_manager_id IS NULL OR coalesce(p_manager_password, '') = '' THEN
      RAISE EXCEPTION 'MANAGER_APPROVAL_REQUIRED';
    END IF;

    SELECT p.name INTO v_manager_name
    FROM public.profiles p
    JOIN public.memberships m ON m.user_id = p.id
    JOIN public.tenants t ON t.id = m.tenant_id
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_manager_id
      AND m.tenant_id = s.tenant_id
      AND m.role IN ('owner', 'admin')
      AND m.is_active
      AND p.is_active
      AND t.is_active
      AND u.encrypted_password = crypt(p_manager_password, u.encrypted_password)
    LIMIT 1;

    IF v_manager_name IS NULL THEN
      RAISE EXCEPTION 'INVALID_MANAGER_APPROVAL';
    END IF;
  END IF;

  IF v_discount > 0 AND coalesce(nullif(trim(p_discount_reason), ''), '') = '' THEN
    RAISE EXCEPTION 'DISCOUNT_REASON_REQUIRED';
  END IF;

  v_discount  := least(v_discount, v_gross);
  v_net       := greatest(0, v_gross - v_discount);
  v_collected := least(v_received, v_net);
  v_remaining := greatest(0, v_net - v_received);

  IF v_remaining > 0 AND coalesce(v_note, '') = '' THEN
    RAISE EXCEPTION 'NOTE_REQUIRED_FOR_PARTIAL';
  END IF;

  -- ── 4. Consolidate session order
  SELECT o.id INTO v_order
  FROM public.orders o
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_order IS NULL THEN
    INSERT INTO public.orders (
      tenant_id, session_id, total, paid_amount, discount_amount, notes, created_by
    ) VALUES (
      s.tenant_id, s.id, v_net, v_collected, v_discount, v_note, v_uid
    ) RETURNING id INTO v_order;
  ELSE
    FOR v_other IN
      SELECT o.id FROM public.orders o
      WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id AND o.id <> v_order
    LOOP
      UPDATE public.order_items SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.payments     SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.orders
        SET total = 0, paid_amount = 0, discount_amount = 0,
            notes = coalesce(notes, '') || ' [تم دمج الطلب تلقائياً]'
      WHERE id = v_other;
    END LOOP;

    UPDATE public.orders
    SET total = v_net, paid_amount = v_collected,
        discount_amount = v_discount, notes = v_note
    WHERE id = v_order;
  END IF;

  -- ── 5. Payment
  IF v_collected > 0 THEN
    INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by)
    VALUES (s.tenant_id, s.id, v_order, v_collected, v_uid);
  END IF;

  -- ── 6. Close session + free device
  UPDATE public.sessions
  SET status = 'closed', ended_at = v_end, time_amount = v_time_price
  WHERE id = s.id;

  UPDATE public.devices SET status = 'available' WHERE id = s.device_id;

  -- ── 7. Audit
  SELECT name INTO v_caller FROM public.profiles WHERE id = v_uid;
  v_actions := CASE
    WHEN v_discount > 0 THEN 'discount_applied'
    WHEN v_remaining > 0 THEN 'partial_payment'
    ELSE 'end_session'
  END;

  v_notes := concat_ws(' | ',
    v_note,
    CASE WHEN v_discount > 0
      THEN 'خصم ' || v_discount::text || ' ج — السبب: ' ||
           coalesce(nullif(trim(p_discount_reason), ''), 'غير مذكور')
      ELSE NULL END,
    CASE WHEN v_discount > 0 AND NOT v_is_manager
      THEN 'اعتماد مدير: ' || coalesce(v_manager_name, 'غير معروف')
      ELSE NULL END
  );

  v_audit := public._audit(
    s.tenant_id, v_actions, v_uid, v_caller, v_notes,
    s.id, d.name,
    v_gross, v_collected, v_discount, v_remaining
  );

  RETURN jsonb_build_object(
    'order_id',      v_order,
    'time_amount',   v_time_price,
    'products_total', v_products,
    'gross_total',   v_gross,
    'discount',      v_discount,
    'net_due',       v_net,
    'collected',     v_collected,
    'remaining',     v_remaining,
    'manager',       v_manager_name
  );
END;
$$;

-- ─── 7. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.change_session_price(uuid, numeric)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_session(uuid, text, integer)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_session(uuid, text, integer, numeric)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.change_session_price(uuid, numeric)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer, numeric)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text) TO authenticated;

COMMIT;
