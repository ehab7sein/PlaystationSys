-- السماح بتغيير سعر اللعب أثناء الجلسة (فردي / مالتي)
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

  UPDATE public.sessions
  SET hourly_price_snapshot = p_hourly_price
  WHERE id = s.id;

  PERFORM public._audit(
    s.tenant_id,
    'price_change',
    v_uid,
    (SELECT name FROM public.profiles WHERE id = v_uid),
    'تغيير سعر الجلسة إلى ' || p_hourly_price::text || ' ج/ساعة',
    s.id,
    (SELECT name FROM public.devices WHERE id = s.device_id),
    s.hourly_price_snapshot,
    0,
    0,
    0
  );

  RETURN jsonb_build_object('ok', true, 'hourly_price_snapshot', p_hourly_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.change_session_price(uuid, numeric) TO authenticated;
