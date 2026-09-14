/**
 * Negative control.
 *
 * A check that cannot fail measures nothing. This file takes the same
 * assertions the real suite relies on and points them at deliberately
 * broken implementations — the exact bugs the core exists to prevent.
 * Every one of these MUST fail against the broken code. If any broken
 * variant passes, the corresponding real test is VOID and this file goes
 * red, which is the signal we want.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { dateKey, totalHours, periodForDate, loadState, sanitizeHours, STORAGE_KEY } from '../../src/core/hours.js'

const originalTZ = process.env.TZ
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

// Bug 1: the "obvious" UTC date key. Wrong in the evening west of Greenwich.
const brokenDateKeyUTC = (d) => d.toISOString().slice(0, 10)

// Bug 2: naive float summing.
const brokenTotal = (entries, dates) => dates.reduce((s, k) => s + (Number(entries[k]) || 0), 0)
// Bug 2b: scales to hundredths but forgets to round each term.
const brokenTotalUnrounded = (entries, dates) => dates.reduce((s, k) => s + (Number(entries[k]) || 0) * 100, 0) / 100

// Bug 3: truncating instead of flooring the period index.
function brokenPeriodStart(anchorKey, len, targetKey) {
  const a = new Date(anchorKey + 'T00:00:00Z')
  const t = new Date(targetKey + 'T00:00:00Z')
  const days = Math.round((t - a) / 86_400_000)
  const idx = Math.trunc(days / len)
  const s = new Date(a.getTime() + idx * len * 86_400_000)
  return s.toISOString().slice(0, 10)
}

// Bug 5: rounding through template interpolation; `${1e-7}` is "1e-7".
const brokenRoundInterpolated = (n) => Math.round(Number(`${n}e2`)) / 100

// Bug 6: an upgrade that only understands the new per-category shape and
// silently drops version 1 hours (one number per day).
const brokenCategoryTotal = (entries, dates) =>
  dates.reduce((s, k) => s + (entries[k] && typeof entries[k] === 'object'
    ? Object.values(entries[k]).reduce((a, h) => a + Math.round(h * 100), 0) : 0), 0) / 100

// Bug 7: a category total that ignores the category and adds up every hour.
const brokenOneCategory = (entries, dates) => totalHours(entries, dates)

// Bug 4: trusting stored JSON.
const brokenLoad = (storage) => JSON.parse(storage.getItem(STORAGE_KEY))

function checkPasses(fn) {
  try {
    fn()
    return true
  } catch {
    return false
  }
}

describe('negative control — the real checks go red against broken code', () => {
  it('local-date check fails for a UTC-based key in a western zone (and passes for the real one)', () => {
    process.env.TZ = 'America/St_Johns'
    const late = new Date(2026, 2, 8, 23, 30)
    const assertion = (fn) => () => expect(fn(late)).toBe('2026-03-08')
    expect(checkPasses(assertion(brokenDateKeyUTC))).toBe(false) // VOID if true
    expect(checkPasses(assertion(dateKey))).toBe(true)
  })

  it('decimal-total check fails for naive float summing (and passes for the real one)', () => {
    const entries = { a: 0.1, b: 0.2 }
    const assertion = (fn) => () => expect(fn(entries, ['a', 'b'])).toBe(0.3)
    expect(checkPasses(assertion(brokenTotal))).toBe(false) // VOID if true
    expect(checkPasses(assertion(totalHours))).toBe(true)

    const triple = { a: 0.07, b: 0.07, c: 0.07 }
    const assertion2 = (fn) => () => expect(fn(triple, ['a', 'b', 'c'])).toBe(0.21)
    expect(checkPasses(assertion2(brokenTotalUnrounded))).toBe(false) // VOID if true
    expect(checkPasses(assertion2(totalHours))).toBe(true)
  })

  it('before-the-anchor check fails for a truncating period index (and passes for the real one)', () => {
    // 8 Aug 2026 is the day before the anchor; its period must START 26 Jul.
    const assertion = (fn) => () => expect(fn('2026-08-09', 14, '2026-08-08')).toBe('2026-07-26')
    expect(checkPasses(assertion(brokenPeriodStart))).toBe(false) // VOID if true
    expect(checkPasses(assertion((a, l, t) => periodForDate(a, l, t).startKey))).toBe(true)
  })

  it('tiny-number check fails for interpolated rounding (and passes for the real one)', () => {
    const assertion = (fn) => () => expect(Number.isNaN(fn(1e-7))).toBe(false)
    expect(checkPasses(assertion(brokenRoundInterpolated))).toBe(false) // VOID if true
    expect(checkPasses(assertion(sanitizeHours))).toBe(true)
    // and the fix must not regress the human-rounding case
    expect(sanitizeHours(1.005)).toBe(1.01)
  })

  it('upgrade check fails for a total that drops version 1 hours (and passes for the real one)', () => {
    const mixed = { a: 8, b: { customer: 2 } }
    const assertion = (fn) => () => expect(fn(mixed, ['a', 'b'])).toBe(10)
    expect(checkPasses(assertion(brokenCategoryTotal))).toBe(false) // VOID if true
    expect(checkPasses(assertion(totalHours))).toBe(true)
  })

  it('per-category check fails for a total that mixes categories (and passes for the real one)', () => {
    const day = { a: { 'heavy-duty': 4, customer: 3 } }
    const assertion = (fn) => () => expect(fn(day, ['a'], 'customer')).toBe(3)
    expect(checkPasses(assertion(brokenOneCategory))).toBe(false) // VOID if true
    expect(checkPasses(assertion(totalHours))).toBe(true)
  })

  it('corrupt-storage check fails for a trusting loader (and passes for the real one)', () => {
    const storage = { getItem: () => '{oops' }
    const assertion = (fn) => () => expect(fn(storage)).toHaveProperty('entries')
    expect(checkPasses(assertion(brokenLoad))).toBe(false) // VOID if true
    expect(checkPasses(assertion(loadState))).toBe(true)
  })
})
