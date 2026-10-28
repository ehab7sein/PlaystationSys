import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format number as Egyptian Pounds (with clean decimals when needed) */
export function formatEGP(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0
  const formatted = Number.isInteger(safe)
    ? safe.toLocaleString('ar-EG')
    : safe.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${formatted} ج`
}

/** Format seconds as MM:SS */
export function formatTimer(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const m = Math.floor(safeSeconds / 60)
  const s = safeSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Format seconds as HH:MM:SS */
export function formatTimerLong(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(safeSeconds / 3600)
  const m = Math.floor((safeSeconds % 3600) / 60)
  const s = safeSeconds % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

let serverOffsetMs = 0

/**
 * Calibrate client clock against a server timestamp.
 * If a server timestamp is ahead of the client's local Date.now(),
 * we immediately align the offset so timers never stall waiting for the client clock to catch up.
 */
export function syncServerTime(serverTimestamp: string | number): void {
  const serverMs =
    typeof serverTimestamp === 'string' ? new Date(serverTimestamp).getTime() : serverTimestamp
  if (!Number.isFinite(serverMs)) return
  const localNow = Date.now()
  if (serverMs > localNow + serverOffsetMs) {
    serverOffsetMs = serverMs - localNow
  }
}

/**
 * Returns current timestamp aligned with server timeline.
 */
export function getServerNow(): number {
  return Date.now() + serverOffsetMs
}

/** Get elapsed seconds from a start timestamp, with auto clock-drift alignment */
export function getElapsedSeconds(startedAt: string): number {
  const startMs = new Date(startedAt).getTime()
  if (!Number.isFinite(startMs)) return 0

  const localNow = Date.now()
  if (startMs > localNow + serverOffsetMs) {
    serverOffsetMs = startMs - localNow
  }

  const effectiveNow = localNow + serverOffsetMs
  return Math.max(0, Math.floor((effectiveNow - startMs) / 1000))
}

/**
 * 15-Minute Rule:
 * Calculate completed 15-minute periods from duration in seconds:
 * Math.floor(seconds / 900)
 */
export function calcCompletedPeriodsFromSeconds(seconds: number): number {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return Math.floor(safeSeconds / 900)
}

/**
 * 15-Minute Rule:
 * Calculate remaining seconds until the next 15-minute mark completes:
 * 900 - (seconds % 900)
 */
export function getSecondsUntilNextPeriod(seconds: number): number {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const remainder = safeSeconds % 900
  return 900 - remainder
}

/**
 * Calculate session price based strictly on 15-minute blocks (900 seconds):
 * - 0 to 14m 59s: 0 EGP
 * - Each completed 15 minutes adds (hourlyPrice / 4)
 * - Due periods = Math.floor(durationSeconds / 900)
 * - Price = Due periods * (hourlyPrice / 4)
 */
export function calcSessionPrice(
  startedAt: string,
  endedAt: string | null,
  hourlyPrice: number,
  _roundingMode?: string
): number {
  const startMs = new Date(startedAt).getTime()
  const endMs = endedAt ? new Date(endedAt).getTime() : getServerNow()
  const safeHourlyPrice = Number.isFinite(hourlyPrice) ? Math.max(0, hourlyPrice) : 0

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0

  const totalSeconds = Math.floor((endMs - startMs) / 1000)
  const completedPeriods = Math.floor(totalSeconds / 900)

  const price = completedPeriods * (safeHourlyPrice / 4)
  return Number.isFinite(price) ? Math.max(0, price) : 0
}

export interface SessionPeriodItem {
  id?: string
  play_type?: 'single' | 'multi' | string
  hourly_price: number
  started_at: string
  ended_at: string | null
}

/**
 * Calculate breakdown for sessions with single or multiple periods.
 * Applies the 15-minute rule independently to each pricing period.
 */
export function calcSessionPeriodsBreakdown(
  periods: SessionPeriodItem[] | undefined,
  fallbackStartedAt: string,
  fallbackHourlyPrice: number,
  nowMs: number = getServerNow()
) {
  const items = periods && periods.length > 0 ? periods : null

  if (!items) {
    const startMs = new Date(fallbackStartedAt).getTime()
    const durationSeconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0
    const completedPeriods = Math.floor(durationSeconds / 900)
    const cost = completedPeriods * (Math.max(0, fallbackHourlyPrice) / 4)
    const secondsUntilNext = 900 - (durationSeconds % 900)

    return {
      totalCost: cost,
      totalCompletedPeriods: completedPeriods,
      secondsUntilNext,
      periods: [
        {
          id: 'single',
          play_type: 'single' as const,
          hourly_price: fallbackHourlyPrice,
          started_at: fallbackStartedAt,
          ended_at: null,
          durationSeconds,
          completedPeriods,
          cost,
          isActive: true,
        },
      ],
    }
  }

  let totalCost = 0
  let totalCompletedPeriods = 0
  let secondsUntilNext = 900

  const detailedPeriods = items.map((period, index) => {
    const pStart = new Date(period.started_at).getTime()
    const isActive = !period.ended_at
    const pEnd = period.ended_at ? new Date(period.ended_at).getTime() : nowMs
    const durationSeconds = Number.isFinite(pStart) && Number.isFinite(pEnd) && pEnd > pStart
      ? Math.floor((pEnd - pStart) / 1000)
      : 0
    const completedPeriods = Math.floor(durationSeconds / 900)
    const safeHourly = Number.isFinite(period.hourly_price) ? Math.max(0, period.hourly_price) : 0
    const cost = completedPeriods * (safeHourly / 4)

    totalCost += cost
    totalCompletedPeriods += completedPeriods

    // Active period (or last period) provides the countdown until its next 15-min mark
    if (isActive || index === items.length - 1) {
      secondsUntilNext = 900 - (durationSeconds % 900)
    }

    return {
      ...period,
      durationSeconds,
      completedPeriods,
      cost,
      isActive,
    }
  })

  return {
    totalCost,
    totalCompletedPeriods,
    secondsUntilNext,
    periods: detailedPeriods,
  }
}
