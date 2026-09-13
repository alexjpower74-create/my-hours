# Build report — c1 · Pay-period logic and device storage

Branch `rig/c1`. Owned paths: `src/core/**`, `tests/core/**`, this file. Nothing else touched.

## What I built — DONE

`src/core/hours.js`, pure functions, no DOM/network/timers. The shared contract exactly as PLAN.md
lists it, plus four small helpers the UI will need anyway:

| Export | Notes |
| --- | --- |
| `dateKey(Date)` | Local calendar `YYYY-MM-DD` via getFullYear/getMonth/getDate. Throws on invalid Date. |
| `parseDateKey(key)` | Local midnight via `new Date(y, m-1, d)`, never `new Date("YYYY-MM-DD")` (UTC). Throws on malformed or impossible keys (`2026-02-30`). |
| `isDateKey(key)` | Boolean form of the above, for validation text in the UI. |
| `inclusiveDays(start, end)` | Day counting on a DST-free calendar (`Date.UTC`), both ends counted. Returns ≤ 0 when end < start so the UI can say so in plain language. |
| `periodForDate(anchor, len, Date\|key)` | `Math.floor` of the day offset, so days before the anchor fall in the right earlier period. Returns `{ startKey, endKey, dates }`. |
| `shiftPeriod(period, ±n)` | Length taken from the period itself, so custom lengths carry over. |
| `sanitizeHours(value)` | blank/null → `null`; `0` valid; strings or numbers; comma decimal accepted; rounds to 2 dp decimal-exactly (`1.005 → 1.01`); rejects <0, >24, `1e2`, `7h`, NaN, objects. |
| `totalHours(entries, dates)` | Sums in whole hundredths, only over `dates`, ignores blanks/invalid. |
| `loadState(storage)` / `saveState(storage, state)` | Key `my-hours:v1`, `{ version: 1, anchorStartKey, lengthDays, entries }`. Never throws; salvages good fields from bad data; `saveState` returns `false` on missing/full/read-only storage. |
| `defaultState()`, `normalizeState(raw)` | Fresh state (`anchorStartKey === null` = setup not done) and the coercion both load and save go through. |
| constants | `STORAGE_KEY`, `STATE_VERSION`, `MAX_HOURS`, `DEFAULT_LENGTH_DAYS`. |

Design call worth knowing: `sanitizeHours` returns `null` for both "blank" and "rejected", as the
contract types it (`number | null`). Stored result is the same either way. If c2 wants to warn on a
rejected value it compares the raw input against `''` itself. `isDateKey` and `inclusiveDays ≤ 0` are
what the setup sheet should use for its plain-language validation.

## What I verified and how it could have failed

`tests/core/hours.test.js` — 39 tests; `tests/core/negative-control.test.js` — 4 tests. 43 pass.

Run under five real time zones by setting `process.env.TZ` inside the tests (Node re-reads it) AND by
launching vitest with `TZ=America/St_Johns`, `UTC`, `Pacific/Auckland`, `Asia/Kolkata`,
`America/Los_Angeles`. All 43 green in each. `npm test` (Cobalt's script) also green.

Coverage: evening/just-after-midnight keys per zone; parse round-trip to local midnight; impossible
keys; inclusive counts across Newfoundland spring-forward (8 Mar 2026) and fall-back (1 Nov 2026),
leap day 2028, non-leap 2027, New Year; 14-day anchor period first/middle/last day; forward 15
periods; backward to the day before the anchor and to 2025; custom lengths 1, 7, 10, 31; period
dates spanning 29 Feb and New Year listed in full; shift ±1 adjacency with no gap/overlap, shift 0
identity, ±3 round trip, agreement with `periodForDate` for every day of a shifted period; hours
blank/zero/decimal/comma/rounding/out-of-range/junk; decimal totals including triples that drift even
when scaled to hundredths (0.07×3); persistence round trip, simulated refresh, missing/throwing
storage, seven kinds of corrupt JSON, partial salvage, never persisting invalid data, quota failure.

**Negative controls (the checks were made red, not just described):**

1. The negative-control file runs the real assertions against four deliberately broken
   implementations (UTC `toISOString` key, naive float sum, hundredths-without-rounding sum,
   `Math.trunc` period index, trusting `JSON.parse` loader) and asserts each FAILS. If a broken variant
   passed, the file itself goes red and marks that check VOID.
2. I sabotaged the real module three times with `sed`, ran the suite, restored, and diffed:
   - UTC date key → 4 failures (incl. the negative control) under `TZ=America/St_Johns`.
   - `Math.trunc` period index → 2 additional failures (before-the-anchor tests).
   - Unrounded hundredths in `totalHours` → **initially 0 failures.** My first decimal test used
     0.1 + 0.2, which happens to land back on 0.3 after `/100`. I found inputs empirically that do
     split the two (0.07×3, 0.29×3, 0.55×3, 0.57×3), added them, re-ran the sabotage → 2 failures.
     Recorded here because it is exactly the "green check that measured nothing" the brief warns about.
   Module restored and `diff` confirmed identical to the pre-sabotage copy before commit.

## Left undone / not applicable

- No UI, no server, port 5411 unused.
- No migration path beyond v1 — only one version exists; an unknown `version` is salvaged field by
  field rather than rejected. Fine for now, flagged so whoever adds v2 knows where to hook in.

## Needs from other slices

- **c2:** import only from `src/core/hours.js`; use `isDateKey` + `inclusiveDays(start,end) ≤ 0` for
  setup validation, `periodForDate(state.anchorStartKey, state.lengthDays, new Date())` on open and
  on Refresh, `shiftPeriod` for prev/next, `totalHours(state.entries, period.dates)` for the sticky
  total, and check `saveState(...) === false` to show a "could not save" message. Blank input →
  `delete state.entries[key]` (or store `null`; `normalizeState` drops it either way).
- **Cobalt:** nothing. Vitest picks up `tests/core/*.test.js` with the default config. If e2e files
  end up matching vitest's default glob, an `exclude: ['tests/e2e/**']` in `vite.config.js` is yours.
- Cross-review of c2's UI: ready when their commit lands; nothing to review yet in this tree.

## Foreman fix 2026-09-13 — sanitizeHours(1e-7) returned NaN — DONE

Reproduced: `sanitizeHours(1e-7)` → `NaN`. Cause: `roundToHundredths` built its decimal string with
template interpolation, and `${1e-7}` is `"1e-7"`, so `"1e-7e2"` parsed to NaN. Fix: the string now
comes from `n.toFixed(8)` (never exponent notation within 0–24), and `sanitizeHours` returns `null`
for any non-finite result as a last guard. `1.005 → 1.01`, `7.257 → 7.26`, `0.004 → 0` unchanged.

Regression test added (tiny values, MIN_VALUE, 23.9999999999) and a negative control that runs the
same NaN assertion against the old interpolated rounding and requires it to FAIL. Proved live: reverting
the two lines with sed → 2 failures (regression + negative control), restored, diffed identical.
45/45 under default TZ, America/St_Johns, UTC, Pacific/Auckland. Main merged into rig/c1 first (fast-forward).
