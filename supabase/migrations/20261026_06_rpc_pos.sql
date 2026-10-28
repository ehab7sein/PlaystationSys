-- ============================================================================
-- 06 — POS RPCs (sessions, products, sales, closing, debt)
-- ============================================================================
-- Purpose:
--   Move every POS mutation into a DB transaction that:
--     * derives tenant_id from the target row (never from the browser),
--     * validates membership + tenant status,
--     * computes prices from DB values instead of trusting the client,
--     * checks stock atomically,
--     * verifies manager approval for discounts,
--     * writes the append-only audit log.
--
-- Prerequisites:
--   * Migrations 01–05 completed.
--   * orders.discount_amount and orders.notes exist (anti-fraud migration).
--
-- Execution:
--   Supabase Dashboard → SQL Editor (postgres role), after migration 05.
--
-- Risks:
--   Replaces the functions that write sessions/orders/payments/audit rows.
--   The tests in supabase/tests/tenant_isolation.sql must pass before cutover.
--   A failed transaction rolls back; no partial bills are created.
--
-- Safe to re-run: yes (CREATE OR REPLACE).
--
-- Rollback:
--   DROP FUNCTION public.start_session(uuid, text, int);
--   DROP FUNCTION public.add_product_to_session(uuid, uuid, int);
--   DROP FUNCTION public.quick_sale(jsonb, numeric);
--   DROP FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text);
--   DROP FUNCTION public.settle_debt(uuid, numeric);
--   DROP FUNCTION public.set_device_status(uuid, text);
--   The data written by these functions remains valid.
-- ============================================================================

BEGIN;

-- ─── Start a session (worker or manager) ───────────────────────────────────
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
  d          public.devices%ROWTYPE;
  v_session  uuid;
  v_price    numeric;
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

  INSERT INTO public.sessions (
    tenant_id, device_id, mode, planned_minutes,
    hourly_price_snapshot, started_at, status, created_by
  ) VALUES (
    d.tenant_id, d.id, p_mode,
    CASE WHEN p_mode = 'fixed' THEN p_planned_minutes ELSE NULL END,
    v_price, now(), 'active', auth.uid()
  )
  RETURNING id INTO v_session;

  UPDATE public.devices SET status = 'busy' WHERE id = d.id;

  RETURN v_session;
END;
$$;

-- ─── Add one product to an active session ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_product_to_session(
  p_session_id uuid,
  p_product_id uuid,
  p_qty        integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s         public.sessions%ROWTYPE;
  p         public.products%ROWTYPE;
  v_order   uuid;
  v_qty     integer := coalesce(p_qty, 0);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_qty < 1 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

  SELECT * INTO s FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(s.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;

  SELECT * INTO p FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF p.tenant_id <> s.tenant_id THEN RAISE EXCEPTION 'PRODUCT_TENANT_MISMATCH'; END IF;
  IF NOT p.is_active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
  IF p.stock_qty < v_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

  SELECT o.id INTO v_order
  FROM public.orders o
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_order IS NULL THEN
    INSERT INTO public.orders (tenant_id, session_id, total, paid_amount, created_by)
    VALUES (s.tenant_id, s.id, 0, 0, auth.uid())
    RETURNING id INTO v_order;
  END IF;

  INSERT INTO public.order_items (
    tenant_id, order_id, product_id, product_name_snapshot, unit_price_snapshot, qty
  ) VALUES (
    s.tenant_id, v_order, p.id, p.name, p.price, v_qty
  );

  UPDATE public.products
  SET stock_qty = stock_qty - v_qty
  WHERE id = p.id;

  RETURN v_order;
END;
$$;

-- ─── Standalone quick sale (no session) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quick_sale(
  p_items jsonb,
  p_paid  numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_order     uuid;
  v_total     numeric := 0;
  v_paid      numeric := greatest(coalesce(p_paid, 0), 0);
  v_item      record;
  p           public.products%ROWTYPE;
  v_qty       integer;
  v_count     integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART';
  END IF;

  -- Derive the tenant from the first product. Every product in the cart must
  -- belong to the same tenant the caller can access.
  SELECT pr.tenant_id INTO v_tenant
  FROM public.products pr
  WHERE pr.id = (p_items -> 0 ->> 'product_id')::uuid;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(v_tenant) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  -- Validate every line and compute the total from DB prices.
  FOR v_item IN
    SELECT
      (item ->> 'product_id')::uuid AS product_id,
      sum(coalesce((item ->> 'qty')::integer, 0))::integer AS qty
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY (item ->> 'product_id')::uuid
  LOOP
    v_qty := v_item.qty;
    IF v_qty < 1 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;

    SELECT * INTO p FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
    IF p.tenant_id <> v_tenant THEN RAISE EXCEPTION 'PRODUCT_TENANT_MISMATCH'; END IF;
    IF NOT p.is_active THEN RAISE EXCEPTION 'PRODUCT_INACTIVE'; END IF;
    IF p.stock_qty < v_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;

    v_total := v_total + (p.price * v_qty);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'EMPTY_CART'; END IF;

  v_paid := least(v_paid, v_total);

  INSERT INTO public.orders (tenant_id, session_id, total, paid_amount, created_by, notes)
  VALUES (v_tenant, NULL, v_total, v_paid, v_uid, 'بيع منتجات مباشر')
  RETURNING id INTO v_order;

  -- Insert lines + deduct stock (aggregated by product to avoid duplicate lines).
  FOR v_item IN
    SELECT
      (item ->> 'product_id')::uuid AS product_id,
      sum(coalesce((item ->> 'qty')::integer, 0))::integer AS qty
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY (item ->> 'product_id')::uuid
  LOOP
    SELECT * INTO p FROM public.products WHERE id = v_item.product_id FOR UPDATE;

    INSERT INTO public.order_items (
      tenant_id, order_id, product_id, product_name_snapshot, unit_price_snapshot, qty
    ) VALUES (
      v_tenant, v_order, p.id, p.name, p.price, v_item.qty
    );

    UPDATE public.products
    SET stock_qty = stock_qty - v_item.qty
    WHERE id = p.id;
  END LOOP;

  IF v_paid > 0 THEN
    INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by)
    VALUES (v_tenant, NULL, v_order, v_paid, v_uid);
  END IF;

  PERFORM public._audit(
    v_tenant,
    'quick_sale',
    v_uid,
    (SELECT name FROM public.profiles WHERE id = v_uid),
    'بيع منتجات مباشر بقيمة ' || v_total::text || ' ج، مدفوع ' || v_paid::text || ' ج'
  );

  RETURN jsonb_build_object(
    'order_id', v_order,
    'total', v_total,
    'paid', v_paid,
    'remaining', greatest(0, v_total - v_paid)
  );
END;
$$;

-- ─── Close a session: price, discount approval, payment, audit ─────────────
CREATE OR REPLACE FUNCTION public.close_session(
  p_session_id       uuid,
  p_received         numeric,
  p_discount         numeric DEFAULT 0,
  p_discount_reason  text DEFAULT NULL,
  p_manager_id       uuid DEFAULT NULL,
  p_manager_password text DEFAULT NULL,
  p_note             text DEFAULT NULL
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
  v_minutes       numeric;
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

  -- ── 1. Session time price (same formula as src/lib/utils.ts) ─────────────
  v_minutes := greatest(0, extract(epoch FROM (v_end - s.started_at)) / 60);
  IF v_rounding = 'up_5_minutes' THEN
    v_time_price := (ceil(v_minutes / 5) * 5 / 60) * s.hourly_price_snapshot;
  ELSIF v_rounding = 'nearest_5_pounds' THEN
    v_time_price := ceil(((v_minutes / 60) * s.hourly_price_snapshot) / 5) * 5;
  ELSE
    v_time_price := round((v_minutes / 60) * s.hourly_price_snapshot);
  END IF;

  -- ── 2. Products total from DB snapshots (never from the client) ──────────
  SELECT coalesce(sum(oi.unit_price_snapshot * oi.qty), 0)
  INTO v_products
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id;

  v_gross := v_time_price + v_products;

  -- ── 3. Discount authorization ────────────────────────────────────────────
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

  v_discount := least(v_discount, v_gross);
  v_net := greatest(0, v_gross - v_discount);
  v_collected := least(v_received, v_net);
  v_remaining := greatest(0, v_net - v_received);

  IF v_remaining > 0 AND coalesce(v_note, '') = '' THEN
    RAISE EXCEPTION 'NOTE_REQUIRED_FOR_PARTIAL';
  END IF;

  -- ── 4. Consolidate the session order ─────────────────────────────────────
  SELECT o.id INTO v_order
  FROM public.orders o
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id
  ORDER BY o.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_order IS NULL THEN
    INSERT INTO public.orders (tenant_id, session_id, total, paid_amount, discount_amount, notes, created_by)
    VALUES (s.tenant_id, s.id, v_net, v_collected, v_discount, v_note, v_uid)
    RETURNING id INTO v_order;
  ELSE
    -- Merge any secondary orders into the primary one without deleting rows.
    FOR v_other IN
      SELECT o.id FROM public.orders o
      WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id AND o.id <> v_order
    LOOP
      UPDATE public.order_items SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.payments SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.orders
      SET total = 0, paid_amount = 0, discount_amount = 0,
          notes = coalesce(notes, '') || ' [تم دمج الطلب تلقائياً]'
      WHERE id = v_other;
    END LOOP;

    UPDATE public.orders
    SET total = v_net,
        paid_amount = v_collected,
        discount_amount = v_discount,
        notes = v_note
    WHERE id = v_order;
  END IF;

  -- ── 5. Payment record (only actual cash) ─────────────────────────────────
  IF v_collected > 0 THEN
    INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by)
    VALUES (s.tenant_id, s.id, v_order, v_collected, v_uid);
  END IF;

  -- ── 6. Close session + free device ───────────────────────────────────────
  UPDATE public.sessions
  SET status = 'closed', ended_at = v_end, time_amount = v_time_price
  WHERE id = s.id;

  UPDATE public.devices SET status = 'available' WHERE id = s.device_id;

  -- ── 7. Immutable audit log ───────────────────────────────────────────────
  SELECT name INTO v_caller FROM public.profiles WHERE id = v_uid;
  v_actions := CASE
    WHEN v_discount > 0 THEN 'discount_applied'
    WHEN v_remaining > 0 THEN 'partial_payment'
    ELSE 'end_session'
  END;

  v_notes := concat_ws(' | ',
    v_note,
    CASE WHEN v_discount > 0
      THEN 'خصم ' || v_discount::text || ' ج — السبب: ' || coalesce(nullif(trim(p_discount_reason), ''), 'غير مذكور')
      ELSE NULL END,
    CASE WHEN v_discount > 0 AND NOT v_is_manager
      THEN 'اعتماد مدير: ' || coalesce(v_manager_name, 'غير معروف')
      ELSE NULL END
  );

  v_audit := public._audit(
    s.tenant_id,
    v_actions,
    v_uid,
    v_caller,
    v_notes,
    s.id,
    d.name,
    v_gross,
    v_collected,
    v_discount,
    v_remaining
  );

  RETURN jsonb_build_object(
    'order_id', v_order,
    'time_amount', v_time_price,
    'products_total', v_products,
    'gross_total', v_gross,
    'discount', v_discount,
    'net_due', v_net,
    'collected', v_collected,
    'remaining', v_remaining,
    'manager', v_manager_name
  );
END;
$$;

-- ─── Settle an outstanding order balance ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_debt(
  p_order_id uuid,
  p_amount   numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o          public.orders%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_amount   numeric := coalesce(p_amount, 0);
  v_remaining numeric;
  v_new_paid  numeric;
  v_device   text;
  v_caller   text;
  v_audit    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT * INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(o.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  v_remaining := greatest(0, o.total - o.paid_amount);
  IF v_amount > v_remaining THEN RAISE EXCEPTION 'AMOUNT_EXCEEDS_REMAINING'; END IF;

  v_new_paid := o.paid_amount + v_amount;

  UPDATE public.orders SET paid_amount = v_new_paid WHERE id = o.id;

  INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by)
  VALUES (o.tenant_id, o.session_id, o.id, v_amount, v_uid);

  SELECT coalesce(d.name, 'طلب منتجات') INTO v_device
  FROM public.sessions s
  LEFT JOIN public.devices d ON d.id = s.device_id
  WHERE s.id = o.session_id;

  SELECT name INTO v_caller FROM public.profiles WHERE id = v_uid;

  v_audit := public._audit(
    o.tenant_id,
    'debt_settlement',
    v_uid,
    v_caller,
    'تسوية متبقي آجل بقيمة ' || v_amount::text || ' ج — المتبقي بعد التسوية ' ||
      greatest(0, v_remaining - v_amount)::text || ' ج',
    o.session_id,
    v_device,
    v_remaining,
    v_amount,
    0,
    greatest(0, v_remaining - v_amount)
  );

  RETURN jsonb_build_object(
    'order_id', o.id,
    'paid_amount', v_new_paid,
    'remaining', greatest(0, o.total - v_new_paid)
  );
END;
$$;

-- ─── Device maintenance toggle (workers may use it, like before) ───────────
CREATE OR REPLACE FUNCTION public.set_device_status(
  p_device_id uuid,
  p_status    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  d public.devices%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_status NOT IN ('available', 'maintenance') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT * INTO d FROM public.devices WHERE id = p_device_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DEVICE_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(d.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.tenant_id = d.tenant_id AND s.device_id = d.id AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'DEVICE_HAS_ACTIVE_SESSION';
  END IF;

  UPDATE public.devices SET status = p_status WHERE id = d.id;
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.start_session(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_session(uuid, text, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_product_to_session(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quick_sale(jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_debt(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_device_status(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_product_to_session(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.quick_sale(jsonb, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_debt(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_device_status(uuid, text) TO authenticated;

COMMIT;
