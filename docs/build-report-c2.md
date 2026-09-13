# Build report — c2 · Accessible Classic mobile interface

Branch `rig/c2`. Owned paths: `index.html`, `src/app.js`, `src/styles.css`. Nothing else was edited or committed.

## What I built — DONE

- **Setup sheet** (`#setup`): two `type="date"` fields. Choosing a start date fills the end date with
  start + 13 days (via `periodForDate(start, 14, start).endKey`, no UI date math). Live summary
  "That is a 14-day pay period." Plain-language errors for missing dates, end before start, and
  periods over 31 days. First invalid field gets focus. **Edit dates** reopens the same sheet prefilled
  with today's period and adds a Cancel button.
- **Main screen**: kicker ("This / Past / Upcoming pay period") + large range heading; Previous /
  Go to today / Next period buttons; one row per period date with a visible short date, a "Today"
  badge, and a text input (`inputmode="decimal"`, `enterkeyhint="done"`). Today's row is red-outlined,
  `aria-current="date"`, and scrolled to centre on open.
- **Hour entry**: `sanitizeHours` on every `input`; valid → `saveState` immediately and the sticky total
  updates; invalid → red field, `aria-invalid`, inline message "Please enter a number from 0 to 24, like
  8 or 7.5.", not saved. Blank clears the entry. Blur normalises the number. Enter blurs.
- **Sticky total** (`<footer>`, fixed bottom): `<output aria-live="polite">` showing "15.5 hours"; a
  `role="status"` line underneath gives save feedback ("Saved 8 hours for Mon, Sep 14.", debounced
  400 ms so screen readers hear one message per pause). Body has bottom padding so the last row is
  never under the bar.
- **Final-day reminder**: shown only when local today equals the end of today's period *and* that
  period is on screen. Copy: "Pay period ends today. Remember to submit your hours. Your total for this
  period is N hours." No notification prompt.
- **Refresh**: re-runs `loadState`, re-renders today's period, announces "Refreshed."
- **Accessibility**: semantic landmarks, skip link, every input labelled (`label[for]` with a
  visually-hidden "hours worked, Monday, September 14"), `aria-describedby` to the hint and per-row
  error, 4px red `:focus-visible` ring, 18px+ text, all controls ≥52px tall, `prefers-reduced-motion`
  respected, `forced-colors` handled, no icon-only controls, no external fonts or network.
- **Classic look**: white ground, #111 text/rules, #c8102e red accent, 14–20px radii. No theme picker.
- **390px and below**: no horizontal scroll at 390, 360, and 195px (≈200% zoom); rows stack under 340px.
- Storage access is wrapped so a blocked `localStorage` falls back to in-memory for the visit.

## Verification — and what would make each red

Harness: `.rig/scratch/check.mjs` (gitignored; Playwright, iPhone 13 profile, Chromium **and**
WebKit, `page.clock` pinned to Mon 2026-09-14 and Sun 2026-09-20). Each `check()` runs a positive
assertion and a negative control; a check whose negative control also passes is reported VOID.
Result: **42/42 PASS, 0 VOID** in both engines.

Proof the harness can go red: I sabotaged `totalHours` once (returned 0). 8 checks failed (total,
invalid-not-added, reload persistence, reminder total — ×2 engines), the rest stayed green, then I
restored it. So the total-related checks measure the real thing.

Checks and their red condition:
- setup shows first, main hidden — red if main visible on first run
- end defaults to start + 13 — red if end ≠ 2026-09-20 for start 2026-09-07
- end-before-start error text present and sheet stays open
- 14 rows, today row `data-key` = 2026-09-14
- total = "15.5 hours" after typing 8 and 7.5
- "25" flagged `aria-invalid` and total unchanged
- values survive `page.reload()`
- Next → Sep 21–Oct 4 with no today row; Prev ×2 → Aug 24; Go to today → today row + focus on today's input
- Edit dates prefilled with current period + Cancel visible; Cancel returns to main
- hit tests: 7 critical controls ≥48×48 and `elementFromPoint` at their centre returns them; last-row
  input at page bottom is not under the sticky total
- every hours input has a `label[for]` mentioning "hours worked"; Tab from today lands on the next day
- clock at Sep 20: reminder visible with "15.5 hours"; hidden after Next; absent on Sep 14
- `scrollWidth <= innerWidth` at 390 (and separately at 195)
- corrupt JSON in `my-hours:v1` → setup screen, no crash
- `vite build` succeeds (4.5 kB HTML, 6.7 kB CSS, 11 kB JS)

Screenshots reviewed at 390×844 (Chromium + WebKit), 360×640, 195×422: main, setup, final-day, invalid entry.

## Important: tested against a local shim, not c1's module

`src/core/hours.js` did not exist on any branch while I built. I wrote a throwaway shim implementing
the PLAN contract, tested against it, and **deleted it before committing** (it was never staged; per
the foreman's instruction no core file is left in this worktree). Real verification against c1's
module is owed at integration.

### Assumption c1 needs to confirm (one-line fix if different)
The UI reads state as `{ version, anchorStartKey: string|null, lengthDays: int|null, entries: { [dateKey]: number } }`
and writes it back through `saveState(storage, state)` with the same shape. All field access is in
`readSchedule` / `writeSchedule` / `readEntries` / `writeEntry` at the top of `src/app.js`. Also assumed:
`loadState` returns a usable empty state (not `null`) on first run or corrupt data; `periodForDate`
accepts a `Date`; `sanitizeHours('')` → `null`; `totalHours` ignores dates with no entry.

## Left undone / out of my slice
- `index.html` links `/manifest.webmanifest` and `app.js` registers `/sw.js` (guarded with `.catch`).
  Both files belong to Cobalt (`public/**`); until they exist the requests 404 harmlessly.
- Period length cap of 31 days is my choice (contract says "custom pay schedules work"); trivial to raise.
- Cross-review of c1's logic: not yet possible, nothing committed on `rig/c1` at time of writing.
