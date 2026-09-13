import { describe, it, expect, afterEach } from 'vitest'
import {
  STORAGE_KEY,
  DEFAULT_LENGTH_DAYS,
  dateKey,
  parseDateKey,
  isDateKey,
  inclusiveDays,
  periodForDate,
  shiftPeriod,
  sanitizeHours,
  totalHours,
  defaultState,
  normalizeState,
  loadState,
  saveState,
} from '../../src/core/hours.js'

// Node re-reads process.env.TZ at runtime, so we can run the same date
// checks under several real zones: Newfoundland (-3:30 with DST), Pacific
// (-8), Auckland (+12/+13), and UTC itself.
const ZONES = ['America/St_Johns', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC']
const originalTZ = process.env.TZ
afterEach(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _map: map,
  }
}

describe('dateKey / parseDateKey (local calendar dates)', () => {
  it('uses the local date, not UTC, late in the evening in every zone', () => {
    for (const tz of ZONES) {
      process.env.TZ = tz
      const late = new Date(2026, 2, 8, 23, 30) // 8 Mar 2026 23:30 local
      expect(dateKey(late), tz).toBe('2026-03-08')
      const early = new Date(2026, 2, 9, 0, 15) // just after local midnight
      expect(dateKey(early), tz).toBe('2026-03-09')
    }
  })

  it('round-trips a key through parseDateKey to local midnight in every zone', () => {
    for (const tz of ZONES) {
      process.env.TZ = tz
      const d = parseDateKey('2026-11-01')
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(10)
      expect(d.getDate()).toBe(1)
      expect(d.getHours(), tz).toBe(0)
      expect(dateKey(d), tz).toBe('2026-11-01')
    }
  })

  it('zero-pads month and day', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('rejects impossible or malformed keys', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '20260105', '', null, undefined, 42, '2026-02-29']) {
      expect(isDateKey(bad), String(bad)).toBe(false)
      expect(() => parseDateKey(bad)).toThrow()
    }
    expect(isDateKey('2028-02-29')).toBe(true) // real leap day
  })

  it('rejects an invalid Date', () => {
    expect(() => dateKey(new Date('nope'))).toThrow(TypeError)
    expect(() => dateKey('2026-01-01')).toThrow(TypeError)
  })
})

describe('inclusiveDays', () => {
  it('counts both ends', () => {
    expect(inclusiveDays('2026-08-09', '2026-08-22')).toBe(14)
    expect(inclusiveDays('2026-08-09', '2026-08-09')).toBe(1)
  })

  it('is exact across DST changes in a DST zone', () => {
    process.env.TZ = 'America/St_Johns'
    // 8 Mar 2026 is the spring-forward day in Newfoundland (23-hour day).
    expect(inclusiveDays('2026-03-07', '2026-03-09')).toBe(3)
    // 1 Nov 2026 is fall-back (25-hour day).
    expect(inclusiveDays('2026-10-31', '2026-11-02')).toBe(3)
  })

  it('crosses leap day, month and year boundaries', () => {
    expect(inclusiveDays('2028-02-28', '2028-03-01')).toBe(3) // leap year
    expect(inclusiveDays('2027-02-28', '2027-03-01')).toBe(2) // not leap
    expect(inclusiveDays('2026-12-25', '2027-01-07')).toBe(14)
  })

  it('returns zero or negative when end is before start, and throws on bad keys', () => {
    expect(inclusiveDays('2026-08-10', '2026-08-09')).toBe(0)
    expect(inclusiveDays('2026-08-12', '2026-08-09')).toBe(-2)
    expect(() => inclusiveDays('2026-08-9', '2026-08-10')).toThrow(TypeError)
  })
})

describe('periodForDate', () => {
  const anchor = '2026-08-09' // a Sunday; 14-day periods end on Saturdays

  it('finds the anchor period itself for its first, middle and last day', () => {
    for (const k of ['2026-08-09', '2026-08-15', '2026-08-22']) {
      const p = periodForDate(anchor, 14, parseDateKey(k))
      expect(p.startKey).toBe('2026-08-09')
      expect(p.endKey).toBe('2026-08-22')
      expect(p.dates).toHaveLength(14)
      expect(p.dates[0]).toBe(p.startKey)
      expect(p.dates[13]).toBe(p.endKey)
    }
  })

  it('accepts a date key as the target too', () => {
    expect(periodForDate(anchor, 14, '2026-08-23').startKey).toBe('2026-08-23')
  })

  it('walks forward many periods', () => {
    // 2027-03-15 is 218 days after the anchor = 15 full periods + 8 days,
    // so it sits in the period starting 15 × 14 = 210 days on: 2027-03-07.
    const p = periodForDate(anchor, 14, '2027-03-15')
    expect(inclusiveDays(anchor, '2027-03-15') - 1).toBe(218)
    expect(p.startKey).toBe('2027-03-07')
    expect(p.endKey).toBe('2027-03-20')
    expect(p.dates).toContain('2027-03-15')
    expect((inclusiveDays(anchor, p.startKey) - 1) % 14).toBe(0)
  })

  it('walks backward before the anchor, including the day just before it', () => {
    const dayBefore = periodForDate(anchor, 14, '2026-08-08')
    expect(dayBefore.startKey).toBe('2026-07-26')
    expect(dayBefore.endKey).toBe('2026-08-08')

    const longAgo = periodForDate(anchor, 14, '2025-01-01')
    expect(longAgo.dates).toContain('2025-01-01')
    expect((inclusiveDays(longAgo.startKey, anchor) - 1) % 14).toBe(0)
    expect(longAgo.startKey).toBe('2024-12-29')
    expect(longAgo.endKey).toBe('2025-01-11')
  })

  it('handles custom lengths (7, 10, 1, 31)', () => {
    expect(periodForDate('2026-01-01', 7, '2026-01-08').startKey).toBe('2026-01-08')
    expect(periodForDate('2026-01-01', 7, '2026-01-07').endKey).toBe('2026-01-07')
    const ten = periodForDate('2026-01-01', 10, '2026-01-25')
    expect([ten.startKey, ten.endKey]).toEqual(['2026-01-21', '2026-01-30'])
    const one = periodForDate('2026-01-01', 1, '2026-06-06')
    expect([one.startKey, one.endKey, one.dates.length]).toEqual(['2026-06-06', '2026-06-06', 1])
    const month = periodForDate('2026-01-01', 31, '2026-02-01')
    expect([month.startKey, month.endKey]).toEqual(['2026-02-01', '2026-03-03'])
  })

  it('spans leap day, month ends and New Year correctly', () => {
    const leap = periodForDate('2028-02-20', 14, '2028-03-01')
    expect(leap.dates).toContain('2028-02-29')
    expect(leap.endKey).toBe('2028-03-04')

    const ny = periodForDate('2026-12-27', 14, '2027-01-03')
    expect(ny.dates).toEqual([
      '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05',
      '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09',
    ])
  })

  it('is stable across DST in every zone (no duplicated or skipped dates)', () => {
    for (const tz of ZONES) {
      process.env.TZ = tz
      const p = periodForDate('2026-03-01', 14, '2026-03-10')
      expect(new Set(p.dates).size, tz).toBe(14)
      expect(p.dates[7], tz).toBe('2026-03-08')
      expect(p.dates[8], tz).toBe('2026-03-09')
      const fall = periodForDate('2026-10-25', 14, '2026-11-01')
      expect(fall.dates[7], tz).toBe('2026-11-01')
      expect(fall.dates[8], tz).toBe('2026-11-02')
    }
  })

  it('rejects bad input loudly', () => {
    expect(() => periodForDate('bad', 14, '2026-01-01')).toThrow(TypeError)
    expect(() => periodForDate('2026-01-01', 0, '2026-01-01')).toThrow(RangeError)
    expect(() => periodForDate('2026-01-01', 14.5, '2026-01-01')).toThrow(RangeError)
    expect(() => periodForDate('2026-01-01', 14, 'yesterday')).toThrow(TypeError)
    expect(() => periodForDate('2026-01-01', 14, new Date('x'))).toThrow(TypeError)
  })
})

describe('shiftPeriod', () => {
  const base = periodForDate('2026-08-09', 14, '2026-08-09')

  it('goes to the previous and next period back-to-back with no gap or overlap', () => {
    const prev = shiftPeriod(base, -1)
    const next = shiftPeriod(base, 1)
    expect([prev.startKey, prev.endKey]).toEqual(['2026-07-26', '2026-08-08'])
    expect([next.startKey, next.endKey]).toEqual(['2026-08-23', '2026-09-05'])
    expect(inclusiveDays(prev.endKey, base.startKey)).toBe(2) // adjacent days
    expect(inclusiveDays(base.endKey, next.startKey)).toBe(2)
  })

  it('offset 0 returns an equal period; ±n composes; going and coming back is identity', () => {
    expect(shiftPeriod(base, 0)).toEqual(base)
    expect(shiftPeriod(shiftPeriod(base, 3), -3)).toEqual(base)
    expect(shiftPeriod(base, 5).startKey).toBe(periodForDate('2026-08-09', 14, '2026-10-20').startKey)
  })

  it('keeps a custom length', () => {
    const ten = periodForDate('2026-01-01', 10, '2026-01-01')
    const next = shiftPeriod(ten, 1)
    expect(next.dates).toHaveLength(10)
    expect([next.startKey, next.endKey]).toEqual(['2026-01-11', '2026-01-20'])
  })

  it('agrees with periodForDate for every day of the shifted period', () => {
    const next = shiftPeriod(base, 2)
    for (const k of next.dates) {
      expect(periodForDate('2026-08-09', 14, k).startKey).toBe(next.startKey)
    }
  })

  it('rejects non-integer offsets and malformed periods', () => {
    expect(() => shiftPeriod(base, 0.5)).toThrow(RangeError)
    expect(() => shiftPeriod(null, 1)).toThrow(TypeError)
    expect(() => shiftPeriod({ startKey: '2026-01-10', endKey: '2026-01-01' }, 1)).toThrow(RangeError)
  })
})

describe('sanitizeHours', () => {
  it('treats blank as no entry', () => {
    for (const v of ['', '   ', null, undefined]) expect(sanitizeHours(v), String(v)).toBeNull()
  })

  it('keeps zero as a valid day off', () => {
    expect(sanitizeHours('0')).toBe(0)
    expect(sanitizeHours(0)).toBe(0)
    expect(sanitizeHours('0.00')).toBe(0)
  })

  it('accepts 0–24 with up to two decimals, from strings or numbers', () => {
    expect(sanitizeHours('7.5')).toBe(7.5)
    expect(sanitizeHours(' 7,5 ')).toBe(7.5)
    expect(sanitizeHours('.5')).toBe(0.5)
    expect(sanitizeHours('8.')).toBe(8)
    expect(sanitizeHours(24)).toBe(24)
    expect(sanitizeHours('24.00')).toBe(24)
    expect(sanitizeHours(7.25)).toBe(7.25)
  })

  it('rounds extra decimals to two places', () => {
    expect(sanitizeHours('7.257')).toBe(7.26)
    expect(sanitizeHours(1.005)).toBe(1.01)
    expect(sanitizeHours('0.004')).toBe(0)
  })

  it('never returns NaN for tiny or exponent-notation numbers (regression)', () => {
    // `${1e-7}` is "1e-7"; the old rounding built "1e-7e2" and returned NaN.
    for (const v of [1e-7, 1e-8, 5e-7, 0.0000001, 1e-7 + 0, 23.9999999999, 1e-300, Number.MIN_VALUE]) {
      const out = sanitizeHours(v)
      expect(Number.isNaN(out), String(v)).toBe(false)
      expect(out === null || Number.isFinite(out), String(v)).toBe(true)
    }
    expect(sanitizeHours(1e-7)).toBe(0)
    expect(sanitizeHours(5e-3)).toBe(0.01)
    expect(sanitizeHours(23.9999999999)).toBe(24)
    expect(sanitizeHours('1e-7')).toBeNull() // exponent strings are still rejected as typed input
  })

  it('rejects out-of-range and junk', () => {
    for (const v of ['-1', -0.01, '24.01', 25, 'abc', '7h', '1e2', '0x10', NaN, Infinity, -Infinity, {}, [], true, '.', '7.5.1', '1 2']) {
      expect(sanitizeHours(v), JSON.stringify(v) ?? String(v)).toBeNull()
    }
  })
})

describe('totalHours', () => {
  const dates = ['2026-08-09', '2026-08-10', '2026-08-11']

  it('sums decimals without floating-point drift', () => {
    expect(totalHours({ '2026-08-09': 0.1, '2026-08-10': 0.2 }, dates)).toBe(0.3)
    expect(totalHours({ '2026-08-09': 7.35, '2026-08-10': 7.35, '2026-08-11': 7.3 }, dates)).toBe(22)
    expect(0.1 + 0.2).not.toBe(0.3) // the thing we are guarding against
    // These triples drift even when each value is scaled to hundredths
    // before adding (0.07 * 100 * 3 / 100 = 0.21000000000000005), so they
    // catch a summing routine that forgets to round each term.
    for (const [v, want] of [[0.07, 0.21], [0.29, 0.87], [0.55, 1.65], [0.57, 1.71]]) {
      expect(totalHours({ '2026-08-09': v, '2026-08-10': v, '2026-08-11': v }, dates), String(v)).toBe(want)
    }
  })

  it('only counts the given dates, ignores blanks/invalid, and tolerates strings', () => {
    const entries = { '2026-08-09': '8', '2026-08-10': '', '2026-08-11': 'x', '2026-08-12': 100, '2026-08-13': 5 }
    expect(totalHours(entries, dates)).toBe(8)
    expect(totalHours(entries, [...dates, '2026-08-13'])).toBe(13)
  })

  it('handles empty inputs', () => {
    expect(totalHours({}, dates)).toBe(0)
    expect(totalHours(null, dates)).toBe(0)
    expect(totalHours({ '2026-08-09': 8 }, [])).toBe(0)
    expect(() => totalHours({}, 'not-an-array')).toThrow(TypeError)
  })

  it('totals a full 14-day period and returns at most two decimals', () => {
    const p = periodForDate('2026-08-09', 14, '2026-08-09')
    const entries = Object.fromEntries(p.dates.map((k) => [k, 7.33]))
    expect(totalHours(entries, p.dates)).toBe(102.62)
  })
})

describe('persistence', () => {
  it('saves under the contract key and loads back the same state', () => {
    const storage = makeStorage()
    const state = { version: 1, anchorStartKey: '2026-08-09', lengthDays: 14, entries: { '2026-08-10': 7.5, '2026-08-11': 0 } }
    expect(saveState(storage, state)).toBe(true)
    expect(STORAGE_KEY).toBe('my-hours:v1')
    expect(storage._map.has('my-hours:v1')).toBe(true)
    expect(JSON.parse(storage._map.get('my-hours:v1')).version).toBe(1)
    expect(loadState(storage)).toEqual(state)
  })

  it('keeps entries across a simulated refresh (new load from the same storage)', () => {
    const storage = makeStorage()
    const s1 = loadState(storage)
    s1.anchorStartKey = '2026-08-09'
    s1.entries['2026-08-09'] = 8
    saveState(storage, s1)
    const s2 = loadState(storage)
    s2.entries['2026-08-10'] = 6.5
    saveState(storage, s2)
    expect(loadState(storage).entries).toEqual({ '2026-08-09': 8, '2026-08-10': 6.5 })
  })

  it('returns a fresh default when storage is missing, empty, or throws', () => {
    expect(loadState(undefined)).toEqual(defaultState())
    expect(loadState(null)).toEqual(defaultState())
    expect(loadState({})).toEqual(defaultState())
    expect(loadState(makeStorage())).toEqual(defaultState())
    expect(loadState({ getItem: () => { throw new Error('SecurityError') } })).toEqual(defaultState())
    expect(defaultState().lengthDays).toBe(DEFAULT_LENGTH_DAYS)
    expect(defaultState().anchorStartKey).toBeNull()
  })

  it('recovers from corrupt JSON and wrong shapes', () => {
    for (const junk of ['{not json', '', 'null', '[]', '"str"', '42', '{"entries":[1,2]}']) {
      expect(loadState(makeStorage({ [STORAGE_KEY]: junk })), junk).toEqual(defaultState())
    }
  })

  it('salvages the good fields and drops only the bad ones', () => {
    const stored = JSON.stringify({
      version: 99,
      anchorStartKey: '2026-08-09',
      lengthDays: '14',
      entries: { '2026-08-10': 7.5, '2026-08-11': 'lots', '2026-02-30': 8, 'garbage': 1, '2026-08-12': 30, '2026-08-13': '6,25' },
    })
    const state = loadState(makeStorage({ [STORAGE_KEY]: stored }))
    expect(state.version).toBe(1)
    expect(state.anchorStartKey).toBe('2026-08-09')
    expect(state.lengthDays).toBe(14)
    expect(state.entries).toEqual({ '2026-08-10': 7.5, '2026-08-13': 6.25 })
  })

  it('falls back to defaults for a bad anchor or length but keeps entries', () => {
    const state = loadState(makeStorage({ [STORAGE_KEY]: JSON.stringify({ anchorStartKey: 'soon', lengthDays: 0, entries: { '2026-01-01': 1 } }) }))
    expect(state.anchorStartKey).toBeNull()
    expect(state.lengthDays).toBe(14)
    expect(state.entries).toEqual({ '2026-01-01': 1 })
  })

  it('never persists invalid data and reports write failures', () => {
    const storage = makeStorage()
    saveState(storage, { anchorStartKey: 'x', lengthDays: -3, entries: { '2026-01-01': '99', '2026-01-02': '4' } })
    expect(JSON.parse(storage._map.get(STORAGE_KEY))).toEqual({ version: 1, anchorStartKey: null, lengthDays: 14, entries: { '2026-01-02': 4 } })

    expect(saveState(null, defaultState())).toBe(false)
    expect(saveState({ setItem: () => { throw new Error('QuotaExceededError') } }, defaultState())).toBe(false)
  })

  it('normalizeState is idempotent', () => {
    const once = normalizeState({ anchorStartKey: '2026-08-09', entries: { '2026-08-09': '7.5' } })
    expect(normalizeState(once)).toEqual(once)
  })
})
