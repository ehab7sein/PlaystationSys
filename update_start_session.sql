-- أضف عمود سعر مالتي لو مش موجود
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS hourly_price_multi NUMERIC(10,2);

-- تحديث دالة start_session لقبول السعر المختار
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

GRANT EXECUTE ON FUNCTION public.start_session(uuid, text, integer, numeric) TO authenticated;
