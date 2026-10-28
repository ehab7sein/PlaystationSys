-- ============================================================================
-- 16 — 15-Minute Billing Rule for PlayStation Sessions
-- ============================================================================
-- Purpose:
--   Enforce strict 15-minute billing blocks (900 seconds) across all sessions:
--   • 0 to 14m 59s: 0 EGP
--   • Each completed 15 minutes adds (hourly_price / 4)
--   • Completed periods = FLOOR(duration_seconds / 900.0)
--   • Cost = Completed periods * (hourly_price / 4.0)
--   • When play mode switches (Single ↔ Multi), each period is billed
--     independently according to its own completed 15-minute blocks.
--   • Uncompleted minutes within a period are preserved in history but
--     are not charged as due fees.
--   • Existing historical / closed sessions are NOT modified.
--
-- Safe to re-run: yes (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

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

REVOKE ALL ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calc_session_total_by_periods(uuid, text, timestamptz) TO service_role;

COMMIT;
