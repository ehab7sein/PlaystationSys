import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format number as Egyptian Pounds (no decimals) */
export function formatEGP(amount: number): string {
  return `${Math.round(amount).toLocaleString('ar-EG')} ج`
}

/** Format seconds as MM:SS */
export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Format seconds as HH:MM:SS */
export function formatTimerLong(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Calculate session price
 * price = (minutes / 60) * hourlyRate
 * Rounding: 'nearest_pound' | 'nearest_5_pounds' | 'up_5_minutes'
 */
export function calcSessionPrice(
  startedAt: string,
  endedAt: string | null,
  hourlyPrice: number,
  roundingMode: 'nearest_pound' | 'nearest_5_pounds' | 'up_5_minutes' = 'nearest_5_pounds'
): number {
  const end = endedAt ? new Date(endedAt) : new Date()
  const start = new Date(startedAt)
  const totalMinutes = (end.getTime() - start.getTime()) / 60000

  let price: number

  if (roundingMode === 'up_5_minutes') {
    const roundedMinutes = Math.ceil(totalMinutes / 5) * 5
    price = (roundedMinutes / 60) * hourlyPrice
  } else {
    price = (totalMinutes / 60) * hourlyPrice
    if (roundingMode === 'nearest_5_pounds') {
      price = Math.ceil(price / 5) * 5
    } else {
      price = Math.round(price)
    }
  }

  return price
}

/** Get elapsed seconds from a start timestamp */
export function getElapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}
