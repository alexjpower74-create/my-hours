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

## Integration pass (after merging main, against c1's real core) — DONE

The first commit was tested against a throwaway shim because c1 had not committed yet. After merging
`main` (c1 core 94f241b, PWA shell, Vitest config) the harness now runs against the real module.
Fixes made in this pass, all in owned files:

- **`period.dates` is `string[]`** (my cross-review finding, HIGH): keys are used directly for storage
  and `totalHours`; `parseDateKey(key)` only for display. No `dateKey()` call on a key string remains.
- **Save failure is reported, not hidden** (HIGH): `saveState`'s boolean is propagated from
  `writeSchedule`/`writeEntry`; a `false` shows "Could not save on this phone. Your hours may be lost
  when you close this page." in the status line (red, `role="status"`) instead of "Saved".
- **Core `isDateKey` imported** instead of a local copy; core `parseDateKey` throws on impossible days
  like 2026-02-30, which the local copy would have surfaced as a crash.
- c1's Playwright review: **reminder stays on screen** on the final day (no scroll-to-today);
  **invalid non-blank input clears the stored value immediately** so a half-typed "25" or "8x" is
  never counted or restored on reload; **`visibilitychange` re-selects today** for an installed app
  left open past midnight; **Enter moves focus to the next day's input** (last one blurs); every
  visible helper/badge/unit/error/status text raised to the **18px floor**.

Harness now 62 checks (31 × Chromium + WebKit), 0 VOID, against the real core. New checks and their red
condition: forced `setItem` throw on `my-hours:v1` → status must start "Could not save on this phone"
and never contain "Saved" (hours and schedule paths); 2026-02-30 typed into setup → plain error, no
crash; "8x" over a saved 7.5 → stored value gone, total drops, reload shows blank; Enter → next input /
blur on last; final day → reminder rect fully inside the viewport at scrollY 0; clock 23:50 → 00:10 +
visibilitychange → today row and period move to Sep 21; no visible text under 18px.
Red proofs this pass: persist forced to `return true` → 4 save-failure checks failed; `.hours-unit`
set to 15px → the 18px check failed in both engines. Both restored before commit.
`vite build` passes; c1's 43 unit tests pass in this worktree.

## Left undone / out of my slice
- `index.html` links `/manifest.webmanifest` and `app.js` registers `/sw.js` (guarded with `.catch`).
  Both files belong to Cobalt (`public/**`); until they exist the requests 404 harmlessly.
- Period length cap of 31 days is my choice (contract says "custom pay schedules work"); trivial to raise.
- Cross-review of c1 (94f241b) delivered to the foreman: no c1 change needed before merge; one LOW note
  that `loadState` ignores `version` despite the comment saying it salvages unknown versions.
