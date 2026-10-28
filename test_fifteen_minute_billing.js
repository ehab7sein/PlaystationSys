import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcSessionPrice,
  calcCompletedPeriodsFromSeconds,
  getSecondsUntilNextPeriod,
  calcSessionPeriodsBreakdown,
  formatEGP,
  formatTimer,
} from './src/lib/utils.ts'

test('1. Mandatory Examples from Prompt (Hourly Rate = 20 EGP -> 5 EGP / 15-min period)', () => {
  const hourlyPrice = 20
  const baseTime = new Date('2026-10-28T12:00:00.000Z')

  const cases = [
    { label: '5 minutes (300s)', seconds: 5 * 60, expectedDue: 0, expectedPeriods: 0 },
    { label: '14 minutes and 59 seconds (899s)', seconds: 14 * 60 + 59, expectedDue: 0, expectedPeriods: 0 },
    { label: '15 minutes (900s)', seconds: 15 * 60, expectedDue: 5, expectedPeriods: 1 },
    { label: '20 minutes (1200s)', seconds: 20 * 60, expectedDue: 5, expectedPeriods: 1 },
    { label: '29 minutes and 59 seconds (1799s)', seconds: 29 * 60 + 59, expectedDue: 5, expectedPeriods: 1 },
    { label: '30 minutes (1800s)', seconds: 30 * 60, expectedDue: 10, expectedPeriods: 2 },
    { label: '44 minutes and 59 seconds (2699s)', seconds: 44 * 60 + 59, expectedDue: 10, expectedPeriods: 2 },
    { label: '45 minutes (2700s)', seconds: 45 * 60, expectedDue: 15, expectedPeriods: 3 },
    { label: '60 minutes (3600s)', seconds: 60 * 60, expectedDue: 20, expectedPeriods: 4 },
  ]

  for (const c of cases) {
    const startedAt = baseTime.toISOString()
    const endedAt = new Date(baseTime.getTime() + c.seconds * 1000).toISOString()

    const periods = calcCompletedPeriodsFromSeconds(c.seconds)
    assert.equal(periods, c.expectedPeriods, `${c.label}: expected ${c.expectedPeriods} periods, got ${periods}`)

    const price = calcSessionPrice(startedAt, endedAt, hourlyPrice)
    assert.equal(price, c.expectedDue, `${c.label}: expected ${c.expectedDue} EGP, got ${price}`)
  }
})

test('2. Early Session End (before 15 minutes)', () => {
  const baseTime = new Date('2026-10-28T10:00:00.000Z')
  const hourlyPrice = 40

  // End at 5 minutes
  const end5 = new Date(baseTime.getTime() + 5 * 60 * 1000).toISOString()
  assert.equal(calcSessionPrice(baseTime.toISOString(), end5, hourlyPrice), 0)

  // End at 10 minutes
  const end10 = new Date(baseTime.getTime() + 10 * 60 * 1000).toISOString()
  assert.equal(calcSessionPrice(baseTime.toISOString(), end10, hourlyPrice), 0)

  // End at 14m 59s
  const end1459 = new Date(baseTime.getTime() + 899 * 1000).toISOString()
  assert.equal(calcSessionPrice(baseTime.toISOString(), end1459, hourlyPrice), 0)
})

test('3. Remaining Time Countdown Until Next Period', () => {
  // At 0 seconds: 900 seconds remaining
  assert.equal(getSecondsUntilNextPeriod(0), 900)
  assert.equal(formatTimer(getSecondsUntilNextPeriod(0)), '15:00')

  // At 1 minute (60s): 840 seconds remaining
  assert.equal(getSecondsUntilNextPeriod(60), 840)
  assert.equal(formatTimer(getSecondsUntilNextPeriod(60)), '14:00')

  // At 14m 59s (899s): 1 second remaining
  assert.equal(getSecondsUntilNextPeriod(899), 1)
  assert.equal(formatTimer(getSecondsUntilNextPeriod(899)), '00:01')

  // At 15m 00s (900s): period 1 completed, period 2 begins -> 900 seconds remaining
  assert.equal(getSecondsUntilNextPeriod(900), 900)
  assert.equal(formatTimer(getSecondsUntilNextPeriod(900)), '15:00')

  // At 20m 00s (1200s): 600 seconds remaining
  assert.equal(getSecondsUntilNextPeriod(1200), 600)
  assert.equal(formatTimer(getSecondsUntilNextPeriod(1200)), '10:00')
})

test('4. Mode Switching (Single ↔ Multi mid-session)', () => {
  // Customer starts Single @ 20 EGP/hr for 20 minutes (1200s).
  // Then switches to Multi @ 30 EGP/hr for 10 minutes (600s).
  const t0 = new Date('2026-10-28T14:00:00.000Z')
  const t1 = new Date(t0.getTime() + 20 * 60 * 1000) // +20 min
  const t2 = new Date(t1.getTime() + 10 * 60 * 1000) // +10 min (total 30 min)

  const periods = [
    {
      id: 'p1',
      play_type: 'single',
      hourly_price: 20,
      started_at: t0.toISOString(),
      ended_at: t1.toISOString(),
    },
    {
      id: 'p2',
      play_type: 'multi',
      hourly_price: 30,
      started_at: t1.toISOString(),
      ended_at: null, // active
    },
  ]

  // At t2:
  const breakdown = calcSessionPeriodsBreakdown(periods, t0.toISOString(), 20, t2.getTime())

  // Period 1 (Single, 20 EGP/h, 20 mins):
  // 1 completed 15-min period = 5 EGP. Remaining 5 mins are stored, not charged.
  assert.equal(breakdown.periods[0].completedPeriods, 1)
  assert.equal(breakdown.periods[0].cost, 5)

  // Period 2 (Multi, 30 EGP/h, 10 mins):
  // 0 completed 15-min periods = 0 EGP. Next 15-min mark in 5 mins (300s).
  assert.equal(breakdown.periods[1].completedPeriods, 0)
  assert.equal(breakdown.periods[1].cost, 0)

  // Total session cost = 5 + 0 = 5 EGP
  assert.equal(breakdown.totalCost, 5)
  assert.equal(breakdown.totalCompletedPeriods, 1)

  // Countdown for active Multi period: 10 mins into it -> 5 mins (300s) until 15 mins
  assert.equal(breakdown.secondsUntilNext, 300)

  // Now, what if the Multi period runs for another 5 minutes (total 15 min Multi)?
  const t3 = new Date(t1.getTime() + 15 * 60 * 1000) // +15 min multi
  const breakdownAtT3 = calcSessionPeriodsBreakdown(periods, t0.toISOString(), 20, t3.getTime())

  // Period 1: 5 EGP
  assert.equal(breakdownAtT3.periods[0].cost, 5)
  // Period 2: 15 min completed = 1 period * (30/4) = 7.5 EGP
  assert.equal(breakdownAtT3.periods[1].completedPeriods, 1)
  assert.equal(breakdownAtT3.periods[1].cost, 7.5)
  // Total = 5 + 7.5 = 12.5 EGP
  assert.equal(breakdownAtT3.totalCost, 12.5)
  assert.equal(breakdownAtT3.totalCompletedPeriods, 2)
})

test('5. Idempotency & Reload Stability', () => {
  const t0 = new Date('2026-10-28T16:00:00.000Z').toISOString()
  const tEnd = new Date('2026-10-28T16:30:00.000Z').toISOString() // exactly 30 min (1800s)

  // Calculation is pure function of timestamps:
  const cost1 = calcSessionPrice(t0, tEnd, 20)
  const cost2 = calcSessionPrice(t0, tEnd, 20)
  const cost3 = calcSessionPrice(t0, tEnd, 20)

  assert.equal(cost1, 10)
  assert.equal(cost2, 10)
  assert.equal(cost3, 10)
})

test('6. Acceptance Criteria: At minute 30 it is 2 periods, NOT 3', () => {
  const periodsAt30 = calcCompletedPeriodsFromSeconds(30 * 60)
  assert.equal(periodsAt30, 2)

  const periodsAt29m59s = calcCompletedPeriodsFromSeconds(29 * 60 + 59)
  assert.equal(periodsAt29m59s, 1)

  const periodsAt44m59s = calcCompletedPeriodsFromSeconds(44 * 60 + 59)
  assert.equal(periodsAt44m59s, 2)

  const periodsAt45 = calcCompletedPeriodsFromSeconds(45 * 60)
  assert.equal(periodsAt45, 3)
})

test('7. Financial Precision & formatEGP', () => {
  assert.equal(formatEGP(0), '٠ ج')
  assert.equal(formatEGP(5), '٥ ج')
  assert.equal(formatEGP(10), '١٠ ج')
  assert.equal(formatEGP(7.5), '٧٫٥ ج')
  assert.equal(formatEGP(12.5), '١٢٫٥ ج')
})
