/**
 * My Hours — core pay-period logic and device storage.
 *
 * Pure functions only. No DOM, no network, no timers. Everything here works on
 * LOCAL calendar dates: a date key is the string "YYYY-MM-DD" for the day the
 * phone's clock says it is, never a UTC date. That matters because a UTC-based
 * key can be a day off in the evening (or morning) depending on the time zone,
 * and an hours tracker that files today's hours under yesterday is broken.
 *
 * Exports (the shared contract, see PLAN.md):
 *   dateKey(date)                                  -> "YYYY-MM-DD"
 *   parseDateKey(key)                              -> Date at local midnight
 *   isDateKey(key)                                 -> boolean
 *   inclusiveDays(startKey, endKey)                -> number of days, both ends counted
 *   periodForDate(anchorStartKey, lengthDays, date)-> { startKey, endKey, dates }
 *   shiftPeriod(period, offset)                    -> { startKey, endKey, dates }
 *   sanitizeHours(value)                           -> number | null
 *   totalHours(entries, dates, categoryId?)        -> number (2 decimal places)
 *   categoryTotals(entries, dates)                 -> { [categoryId]: number, all: number }
 *   sanitizeNote(value)                            -> string | null
 *   loadState(storage) / saveState(storage, state) -> persisted under "my-hours:v1"
 *   defaultState()                                 -> a fresh, valid state
 *   STORAGE_KEY, STATE_VERSION, MAX_HOURS, DEFAULT_LENGTH_DAYS, MAX_NOTE_LENGTH
 *   CATEGORIES, EARLIER_CATEGORY, CATEGORY_IDS
 */

// The key keeps its v1 name so hours saved before categories existed are still found.
export const STORAGE_KEY = 'my-hours:v1'
export const STATE_VERSION = 2
export const MAX_NOTE_LENGTH = 500

/** The three kinds of work hours are logged against, in display order. */
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'heavy-duty', label: 'Dennis Heavy Duty' }),
  Object.freeze({ id: 'automotive', label: 'Dennis Automotive' }),
  Object.freeze({ id: 'customer', label: 'Customer' }),
])

/**
 * Hours typed before categories existed (version 1 stored one number per
 * day). They are kept and counted in the overall total under this id rather
 * than guessed into one of the real categories.
 */
export const EARLIER_CATEGORY = Object.freeze({ id: 'earlier', label: 'No category' })

export const CATEGORY_IDS = Object.freeze([...CATEGORIES.map((c) => c.id), EARLIER_CATEGORY.id])
export const MAX_HOURS = 24
export const DEFAULT_LENGTH_DAYS = 14

const MS_PER_DAY = 86_400_000
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// ---------------------------------------------------------------------------
// Local calendar dates
// ---------------------------------------------------------------------------

function pad2(n) {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Turn a Date into its local calendar key, e.g. 2026-03-08 at 23:30 local
 * time is "2026-03-08" even if UTC has already moved on to the 9th.
 * Throws on anything that is not a valid Date.
 */
export function dateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('dateKey expects a valid Date')
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * True only for a well-formed key naming a real calendar day
 * ("2026-02-30" and "2026-13-01" are false).
 */
export function isDateKey(key) {
  if (typeof key !== 'string') return false
  const m = KEY_PATTERN.exec(key)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  // Round-trip through a local Date; JS rolls invalid days into the next
  // month, so a mismatch means the day did not exist.
  const probe = new Date(y, mo - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d
}

/**
 * Parse "YYYY-MM-DD" into a Date at LOCAL midnight of that day.
 * (`new Date("2026-03-08")` would give UTC midnight, which is the previous
 * evening in the Americas — that is the bug this function exists to avoid.)
 * Throws on a malformed or impossible key.
 */
export function parseDateKey(key) {
  if (!isDateKey(key)) {
    throw new TypeError(`parseDateKey expects "YYYY-MM-DD" naming a real day, got ${JSON.stringify(key)}`)
  }
  const [, y, mo, d] = KEY_PATTERN.exec(key)
  return new Date(Number(y), Number(mo) - 1, Number(d))
}

/**
 * Whole days from the epoch for a key, counted on a DST-free calendar so a
 * 23- or 25-hour day never makes two neighbouring dates look 0 or 2 apart.
 */
function dayNumber(key) {
  const [, y, mo, d] = KEY_PATTERN.exec(key)
  return Math.round(Date.UTC(Number(y), Number(mo) - 1, Number(d)) / MS_PER_DAY)
}

/** Key for the day `offset` days after `key` (negative offsets go backward). */
function addDays(key, offset) {
  const [, y, mo, d] = KEY_PATTERN.exec(key)
  // Local-date arithmetic through the Date constructor: the constructor
  // normalises overflowing days into the right month/year for us.
  return dateKey(new Date(Number(y), Number(mo) - 1, Number(d) + offset))
}

function assertKey(key, name) {
  if (!isDateKey(key)) {
    throw new TypeError(`${name} must be a "YYYY-MM-DD" date key, got ${JSON.stringify(key)}`)
  }
}

function assertLength(lengthDays) {
  if (!Number.isInteger(lengthDays) || lengthDays < 1) {
    throw new RangeError(`lengthDays must be a whole number of at least 1, got ${JSON.stringify(lengthDays)}`)
  }
}

/**
 * Number of days from startKey to endKey counting both ends, so a period
 * that starts Monday and ends the second Sunday is 14. Returns a negative
 * or zero count when end is before start; callers validate that in plain
 * language. Throws on malformed keys.
 */
export function inclusiveDays(startKey, endKey) {
  assertKey(startKey, 'startKey')
  assertKey(endKey, 'endKey')
  return dayNumber(endKey) - dayNumber(startKey) + 1
}

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------

function buildPeriod(startKey, lengthDays) {
  const dates = new Array(lengthDays)
  for (let i = 0; i < lengthDays; i++) dates[i] = addDays(startKey, i)
  return { startKey, endKey: dates[lengthDays - 1], dates }
}

/**
 * The pay period containing `targetDate`, given one known period start and
 * the period length. Periods repeat back-to-back forever in both directions,
 * so a target years before the anchor still lands in exactly one period.
 *
 * @param {string} anchorStartKey  start of any one real pay period
 * @param {number} lengthDays      inclusive length (14 for fortnightly)
 * @param {Date|string} targetDate a Date (local calendar) or a date key
 * @returns {{ startKey: string, endKey: string, dates: string[] }}
 */
export function periodForDate(anchorStartKey, lengthDays, targetDate) {
  assertKey(anchorStartKey, 'anchorStartKey')
  assertLength(lengthDays)
  const targetKey = typeof targetDate === 'string' ? targetDate : dateKey(targetDate)
  assertKey(targetKey, 'targetDate')

  const offsetDays = dayNumber(targetKey) - dayNumber(anchorStartKey)
  // floor (not trunc) so days before the anchor fall into the period that
  // ends the day before the anchor, not into the anchor period itself.
  const periodIndex = Math.floor(offsetDays / lengthDays)
  return buildPeriod(addDays(anchorStartKey, periodIndex * lengthDays), lengthDays)
}

/**
 * The period `offset` periods away: -1 previous, 0 same, +1 next.
 * Length is taken from the period passed in, so custom lengths carry over.
 */
export function shiftPeriod(period, offset) {
  if (!period || typeof period !== 'object') throw new TypeError('shiftPeriod expects a period object')
  assertKey(period.startKey, 'period.startKey')
  assertKey(period.endKey, 'period.endKey')
  if (!Number.isInteger(offset)) throw new RangeError(`offset must be a whole number, got ${JSON.stringify(offset)}`)
  const lengthDays = inclusiveDays(period.startKey, period.endKey)
  assertLength(lengthDays)
  return buildPeriod(addDays(period.startKey, offset * lengthDays), lengthDays)
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Clean a typed hours value.
 *   ""  / whitespace / null / undefined  -> null   (no entry)
 *   "0" / 0                              -> 0      (a valid day off)
 *   "7.5", " 7,5 ", 7.25                 -> 7.5, 7.5, 7.25
 *   "7.257"                              -> 7.26   (rounded to two decimals)
 *   "-1", "25", "abc", NaN, Infinity, {} -> null   (rejected)
 *
 * Both "nothing typed" and "unusable" come back as null on purpose: the
 * stored result is the same (no hours for that day). A UI that wants to warn
 * about a rejected value can compare the raw input against `''` itself.
 */
export function sanitizeHours(value) {
  if (value === null || value === undefined) return null
  let n
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    const text = value.trim().replace(',', '.')
    if (text === '') return null
    // Only plain decimals: digits, optional one dot, digits. Rejects "1e2",
    // "0x10", "7.5h" and anything Number() would be too generous with.
    if (!/^\d*\.?\d*$/.test(text) || text === '.') return null
    n = Number(text)
  } else {
    return null
  }
  if (!Number.isFinite(n)) return null
  if (n < 0 || n > MAX_HOURS) return null
  const rounded = roundToHundredths(n)
  // Belt and braces: this function's contract is number | null, never NaN.
  return Number.isFinite(rounded) ? rounded : null
}

/**
 * Round to two decimals the way a person would: 1.005 -> 1.01.
 * `Math.round(1.005 * 100)` gives 100 because 1.005 * 100 is 100.49999…;
 * shifting the exponent through a plain decimal string avoids that.
 * The string comes from toFixed, not template interpolation: `${1e-7}` is
 * "1e-7", and "1e-7e2" parses to NaN. Within 0–24 toFixed never uses
 * exponent notation, and eight places is far more than the two we keep.
 */
function roundToHundredths(n) {
  return Math.round(Number(`${n.toFixed(8)}e2`)) / 100
}

/**
 * The hours for one category on one day entry. A day entry is either an
 * object of categoryId -> hours, or (version 1 data) a bare number, which
 * belongs to EARLIER_CATEGORY.
 */
function entryHours(entry, categoryId) {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.hasOwn(entry, categoryId) ? sanitizeHours(entry[categoryId]) : null
  }
  return categoryId === EARLIER_CATEGORY.id ? sanitizeHours(entry) : null
}

/**
 * Sum the hours for the given dates. Adds in whole hundredths so
 * 0.1 + 0.2 comes out as 0.3, not 0.30000000000000004. Entries that are
 * missing or fail sanitizeHours count as nothing. Dates outside `dates`
 * are ignored, so passing a period's `dates` gives that period's total.
 *
 * @param {Record<string, object|number|string|null>} entries  dateKey -> { categoryId: hours } (or v1 hours)
 * @param {string[]} dates                                     keys to total
 * @param {string} [categoryId]                                one category; omit for every category
 */
export function totalHours(entries, dates, categoryId) {
  if (!Array.isArray(dates)) throw new TypeError('totalHours expects an array of date keys')
  if (categoryId !== undefined && !CATEGORY_IDS.includes(categoryId)) {
    throw new RangeError(`Unknown category ${JSON.stringify(categoryId)}`)
  }
  if (!entries || typeof entries !== 'object') return 0
  const ids = categoryId === undefined ? CATEGORY_IDS : [categoryId]
  let hundredths = 0
  for (const key of dates) {
    for (const id of ids) {
      const hours = entryHours(entries[key], id)
      if (hours !== null) hundredths += Math.round(hours * 100)
    }
  }
  return hundredths / 100
}

/** Every category's total for the dates, plus `all`, the overall total. */
export function categoryTotals(entries, dates) {
  const totals = {}
  for (const id of CATEGORY_IDS) totals[id] = totalHours(entries, dates, id)
  totals.all = totalHours(entries, dates)
  return totals
}

/**
 * Clean a typed note. Whitespace-only and non-strings mean no note (null).
 * The text is otherwise kept exactly as typed (a trailing space mid-typing
 * must survive a save), capped at MAX_NOTE_LENGTH characters.
 */
export function sanitizeNote(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value.slice(0, MAX_NOTE_LENGTH)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * A fresh state. `anchorStartKey === null` means setup has not been done.
 *   {
 *     version: 2,
 *     anchorStartKey: "YYYY-MM-DD" | null,   start of the period chosen in setup
 *     lengthDays: number,                    inclusive period length (default 14)
 *     entries: { [dateKey]: { [categoryId]: number } }  hours per day per category, valid values only
 *     notes:   { [dateKey]: { [categoryId]: string } }  optional note per day per category
 *   }
 */
export function defaultState() {
  return { version: STATE_VERSION, anchorStartKey: null, lengthDays: DEFAULT_LENGTH_DAYS, entries: {}, notes: {} }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Coerce anything (parsed JSON, a half-built object, garbage) into a valid
 * state. Never throws. Bad fields fall back to defaults individually, so one
 * corrupt entry does not wipe a fortnight of hours.
 */
export function normalizeState(raw) {
  const state = defaultState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state

  if (isDateKey(raw.anchorStartKey)) state.anchorStartKey = raw.anchorStartKey

  const len = Number(raw.lengthDays)
  if (Number.isInteger(len) && len >= 1) state.lengthDays = len

  if (isPlainObject(raw.entries)) {
    for (const key of Object.keys(raw.entries)) {
      if (!isDateKey(key)) continue
      const day = {}
      for (const id of CATEGORY_IDS) {
        const hours = entryHours(raw.entries[key], id)
        if (hours !== null) day[id] = hours
      }
      if (Object.keys(day).length > 0) state.entries[key] = day
    }
  }

  if (isPlainObject(raw.notes)) {
    for (const key of Object.keys(raw.notes)) {
      if (!isDateKey(key) || !isPlainObject(raw.notes[key])) continue
      const day = {}
      for (const id of CATEGORY_IDS) {
        const note = Object.hasOwn(raw.notes[key], id) ? sanitizeNote(raw.notes[key][id]) : null
        if (note !== null) day[id] = note
      }
      if (Object.keys(day).length > 0) state.notes[key] = day
    }
  }
  return state
}

/**
 * Read state from a Storage-like object (localStorage, or anything with
 * getItem/setItem). Missing storage, a missing key, unparsable JSON, a wrong
 * version, or a throwing getItem all come back as a usable state rather than
 * an error. Recovery keeps whatever fields were still good.
 */
export function loadState(storage) {
  let text = null
  try {
    if (storage && typeof storage.getItem === 'function') text = storage.getItem(STORAGE_KEY)
  } catch {
    return defaultState()
  }
  if (typeof text !== 'string') return defaultState()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return defaultState()
  }
  // Version 1 (one number per day) is upgraded in normalizeState. An unknown
  // version is either from the future or corrupt; salvage what we recognise
  // rather than trusting it wholesale.
  return normalizeState(parsed)
}

/**
 * Write state under STORAGE_KEY. The state is normalised first so nothing
 * invalid is ever persisted. Returns true on success, false if storage is
 * missing, read-only, or full (quota errors are swallowed — the app keeps
 * working in memory and the UI can tell the user the save did not stick).
 */
export function saveState(storage, state) {
  if (!storage || typeof storage.setItem !== 'function') return false
  const clean = normalizeState(state)
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(clean))
    return true
  } catch {
    return false
  }
}
