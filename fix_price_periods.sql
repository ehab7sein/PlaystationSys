-- إصلاح: حساب كل فترة سعر داخل نفس الجلسة مع استمرار العداد
CREATE TABLE IF NOT EXISTS public.session_price_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  hourly_price numeric(10,2) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_price_history_session_idx ON public.session_price_history(session_id);
CREATE INDEX IF NOT EXISTS session_price_history_tenant_idx ON public.session_price_history(tenant_id);

ALTER TABLE public.session_price_history ENABLE ROW LEVEL SECURITY;

-- عند بدء الجلسة، سجل أول فترة
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

  -- أول فترة سعر تبدأ من بداية الجلسة
  INSERT INTO public.session_price_history (tenant_id, session_id, hourly_price, started_at, created_by)
  VALUES (d.tenant_id, v_session, v_price, now(), auth.uid());

  UPDATE public.devices SET status = 'busy' WHERE id = d.id;

  RETURN v_session;
END;
$$;

-- تحويل السعر داخل نفس الجلسة بدون إيقاف العداد
CREATE OR REPLACE FUNCTION public.change_session_price(
  p_session_id uuid,
  p_hourly_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sessions%ROWTYPE;
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_hourly_price IS NULL OR p_hourly_price <= 0 THEN RAISE EXCEPTION 'INVALID_PRICE'; END IF;

  SELECT * INTO s FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF NOT public.can_access_tenant(s.tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF s.status <> 'active' THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;

  SELECT public.tenant_role(s.tenant_id) INTO v_role;
  IF v_role NOT IN ('owner', 'admin') AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- أغلق الفترة الحالية في وقت التحويل
  UPDATE public.session_price_history
  SET ended_at = now()
  WHERE session_id = s.id AND ended_at IS NULL;

  -- ابدأ فترة جديدة بالسعر الجديد من نفس اللحظة
  INSERT INTO public.session_price_history (tenant_id, session_id, hourly_price, started_at, created_by)
  VALUES (s.tenant_id, s.id, p_hourly_price, now(), v_uid);

  -- حدّث snapshot للعرض فقط
  UPDATE public.sessions
  SET hourly_price_snapshot = p_hourly_price
  WHERE id = s.id;

  PERFORM public._audit(
    s.tenant_id,
    'price_change',
    v_uid,
    (SELECT name FROM public.profiles WHERE id = v_uid),
    'تحويل سعر الجلسة إلى ' || p_hourly_price::text || ' ج/ساعة',
    s.id,
    (SELECT name FROM public.devices WHERE id = s.device_id),
    p_hourly_price,
    0,
    0,
    0
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- حساب حسب الفترات
CREATE OR REPLACE FUNCTION public.calc_session_total_by_periods(
  p_session_id uuid,
  p_rounding_mode text DEFAULT 'nearest_5_pounds',
  p_end_time timestamptz DEFAULT now()
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.sessions%ROWTYPE;
  v_total numeric := 0;
  h record;
  v_end timestamptz;
  v_period_end timestamptz;
  v_seconds numeric;
  v_periods integer;
  v_price numeric;
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
    v_period_end := LEAST(COALESCE(h.ended_at, v_end), v_end);
    v_seconds    := GREATEST(0, EXTRACT(EPOCH FROM (v_period_end - h.started_at)));
    v_periods    := FLOOR(v_seconds / 900.0);
    IF v_periods <= 0 THEN CONTINUE; END IF;

    v_price := v_periods * (h.hourly_price / 4.0);
    v_total := v_total + v_price;
  END LOOP;

  RETURN ROUND(v_total, 2);
END;
$$;

-- تعديل close_session ليحسب حسب الفترات
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

  -- أغلق آخر فترة سعر
  UPDATE public.session_price_history
  SET ended_at = v_end
  WHERE session_id = s.id AND ended_at IS NULL;

  -- حساب حسب الفترات
  v_time_price := public.calc_session_total_by_periods(s.id, v_rounding, v_end);

  -- حساب المنتجات
  SELECT coalesce(sum(oi.unit_price_snapshot * oi.qty), 0)
  INTO v_products
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id;

  v_gross := v_time_price + v_products;

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
    FOR v_other IN
      SELECT o.id FROM public.orders o
      WHERE o.tenant_id = s.tenant_id AND o.session_id = s.id AND o.id <> v_order
    LOOP
      UPDATE public.order_items SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.payments SET order_id = v_order WHERE order_id = v_other;
      UPDATE public.orders
      SET total = 0, paid_amount = 0, discount_amount = 0,
          notes = coalesce(notes, '') || ' [merged]'
      WHERE id = v_other;
    END LOOP;

    UPDATE public.orders
    SET total = v_net,
        paid_amount = v_collected,
        discount_amount = v_discount,
        notes = v_note
    WHERE id = v_order;
  END IF;

  IF v_collected > 0 THEN
    INSERT INTO public.payments (tenant_id, session_id, order_id, amount, created_by)
    VALUES (s.tenant_id, s.id, v_order, v_collected, v_uid);
  END IF;

  UPDATE public.sessions
  SET status = 'closed', ended_at = v_end, time_amount = v_time_price
  WHERE id = s.id;

  UPDATE public.devices SET status = 'available' WHERE id = s.device_id;

  SELECT name INTO v_caller FROM public.profiles WHERE id = v_uid;
  v_actions := CASE
    WHEN v_discount > 0 THEN 'discount_applied'
    WHEN v_remaining > 0 THEN 'partial_payment'
    ELSE 'end_session'
  END;

  v_notes := concat_ws(' | ',
    v_note,
    CASE WHEN v_discount > 0
      THEN 'خصم ' || v_discount::text || ' ج'
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

GRANT EXECUTE ON FUNCTION public.change_session_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_session(uuid, numeric, numeric, text, uuid, text, text) TO authenticated;
