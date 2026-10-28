-- جدول تاريخ أسعار الجلسة لحساب كل فترة بسعرها
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

-- تحديث دالة تغيير السعر لتسجيل فترات منفصلة
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

  UPDATE public.session_price_history
  SET ended_at = now()
  WHERE session_id = s.id AND ended_at IS NULL;

  INSERT INTO public.session_price_history (tenant_id, session_id, hourly_price, started_at, created_by)
  VALUES (s.tenant_id, s.id, p_hourly_price, now(), v_uid);

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

  RETURN jsonb_build_object('ok', true, 'hourly_price_snapshot', p_hourly_price);
END;
$$;

-- تحديث start_session لتسجيل أول فترة سعر
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

  INSERT INTO public.session_price_history (tenant_id, session_id, hourly_price, started_at, created_by)
  VALUES (d.tenant_id, v_session, v_price, now(), auth.uid());

  UPDATE public.devices SET status = 'busy' WHERE id = d.id;

  RETURN v_session;
END;
$$;

-- حساب السعر حسب فترات متعددة
CREATE OR REPLACE FUNCTION public.calc_session_total(
  p_session_id uuid,
  p_rounding_mode text DEFAULT 'nearest_5_pounds'
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
  v_minutes numeric;
  v_price numeric;
BEGIN
  SELECT * INTO s FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  v_end := COALESCE(s.ended_at, now());

  FOR h IN
    SELECT hourly_price, started_at, COALESCE(ended_at, v_end) as end_at
    FROM public.session_price_history
    WHERE session_id = p_session_id
    ORDER BY started_at ASC
  LOOP
    v_minutes := GREATEST(0, EXTRACT(EPOCH FROM (h.end_at - h.started_at)) / 60);
    IF v_minutes <= 0 THEN CONTINUE; END IF;
    
    IF p_rounding_mode = 'up_5_minutes' THEN
      v_price := (CEIL(v_minutes / 5) * 5 / 60) * h.hourly_price;
    ELSIF p_rounding_mode = 'nearest_5_pounds' THEN
      v_price := CEIL(((v_minutes / 60) * h.hourly_price) / 5) * 5;
    ELSE
      v_price := ROUND((v_minutes / 60) * h.hourly_price);
    END IF;
    v_total := v_total + v_price;
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_session_price(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_session_total(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer, numeric) TO authenticated;
