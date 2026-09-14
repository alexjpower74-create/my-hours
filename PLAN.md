# My Hours — build contract

## Product

**My Hours** is a generic, phone-first personal hours tracker for one employee. It stores everything
on the device, opens on today, totals the active pay period while the employee fills it in, and shows
a large reminder on the final day. It is intentionally limited: no employer account, sign-in, cloud
sync, payroll rules, overtime, breaks, wages, reports, or administrative settings.

**Categories (added 2026-09-14 at Alexander's request):** every day has three hour boxes, one per
category, in this order: **Dennis Heavy Duty**, **Dennis Automotive**, **Customer**. Each box has an
optional note under it. The sticky total shows each category's period total side by side, with the
overall total for all three below. Hours saved before categories existed (one number per day) are kept
as "No category": shown on their day and in the totals only where present, never guessed into a
category. Everything else (look, setup, navigation, reminder) is unchanged.

The user chooses the start and end of one known pay period during setup. That inclusive period length
then repeats continuously backward and forward. A normal choice is 14 days, but custom pay schedules
work too. The only ongoing controls are daily hours, previous/current/next period navigation, Edit
dates, and Refresh. The device's local calendar date selects and highlights today on open.

## Experience contract

- One visual theme only: ShopBoard **Classic** — white ground, black text/rules, restrained red accent.
  Unlike ShopBoard Classic, every surface and control uses friendly rounded corners (14–20px).
- Designed first for 390×844 phones and fully usable on iPhone and Android as an installable PWA.
- Plain language, minimum 18px body text, minimum 48×48px controls, strong focus states, no icon-only
  mystery controls, no hidden gestures, no motion required, and `prefers-reduced-motion` respected.
- Setup asks only for pay-period start and end. End defaults to 13 days after start. Validation is
  written in plain language. Edit dates reopens the same two-field sheet.
- Main screen shows a large period range, fourteen (or configured count) day rows, three numeric
  hours fields per day (one per category, each with a note), today clearly marked, and a sticky running total at the bottom.
- Hours accept 0–24 with up to two decimals. Blank means no entry; zero is a valid day off. Changes
  save locally on input/blur and update the total immediately.
- On the final day, show a prominent reminder: “Pay period ends today. Remember to submit your hours.”
  Include the completed total in the reminder. No notification permission prompt.
- Offline-first. No network, account, analytics, employer data, or sending. Entries survive refresh.

## Shared module contract

`src/core/hours.js` exports:

- `dateKey(Date): string` and `parseDateKey(string): Date`, using local calendar dates safely.
- `inclusiveDays(startKey, endKey): number`.
- `periodForDate(anchorStartKey, lengthDays, targetDate): { startKey, endKey, dates }`.
- `shiftPeriod(period, offset): { startKey, endKey, dates }`.
- `sanitizeHours(value): number | null`, accepting blank as null and rejecting outside 0–24.
- `totalHours(entries, dates): number` with decimal-safe summing.
- `loadState(storage)` / `saveState(storage, state)` using key `my-hours:v1`, versioned data, and
  graceful recovery from missing/corrupt storage.

The UI must not duplicate period math. Core must not touch the DOM.

## Rules

- Own only the files listed under your slice. Report requests for cross-slice changes instead of
  editing outside ownership. `rig guard` enforces this.
- Verify, commit only your paths, then report in `docs/build-report-<id>.md`.
- State what would make every check fail and prove at least one negative control.
- No deploy. Cobalt integrates and grades committed code from a pinned QA worktree.
- Cross-review happens before final integration: c1 reviews c2's phone UI and c2 reviews c1's logic.

## Agents

### c1 — Pay-period logic and device storage
Owns:
- src/core/**
- tests/core/**

Report: docs/build-report-c1.md

Task:
Implement the shared module contract with Vitest coverage for local-date handling, 14-day and custom
periods, dates before/after the anchor, leap/month/year boundaries, shift navigation, decimal totals,
valid/invalid hours, persistence, and corrupt-data recovery. Keep the API small and documented in
code. Do not build UI. Use port 5411 only if you need a server.

### c2 — Accessible Classic mobile interface
Owns:
- index.html
- src/app.js
- src/styles.css

Report: docs/build-report-c2.md

Task:
Build the complete phone-first DOM interface against the shared module contract above. Use only the
Classic white/black/red look, but with rounded corners. Make direct hour entry, today-first behavior,
period navigation, setup/edit dates, final-day reminder, refresh, save feedback, keyboard support,
screen-reader labels, and the sticky total exceptionally obvious. No theme selector and no extra
features. Use semantic HTML and no external font/network dependency. Do not implement duplicate date
math or storage. Use port 5412 only if you need a server.

## Cobalt integration ownership

Cobalt owns `package.json`, lockfile, Vite/test configuration, `public/**`, `tests/e2e/**`, README,
integration fixes that cannot remain in a slice, QA worktree, PWA/offline wiring, screenshots, and
final commits. QA port: 5419.

## Acceptance gates

1. Unit tests pass and include a demonstrated negative control.
2. Playwright Chromium + WebKit at 390×844: setup, enter/edit hours, total, refresh persistence,
   period navigation, edit dates, today selection, and final-day reminder via a controlled clock.
3. Touch-target hit tests use `elementFromPoint`; no critical target under 48×48 CSS pixels.
4. Accessibility: no serious/critical automated findings, 200% text usable, visible focus, labelled
   inputs, logical reading/tab order, contrast suitable for older users.
5. PWA manifest and service worker make the shell work offline after first load.
6. Production build passes. Screenshots reviewed at 390×844 and a small Android viewport.

## Open questions

None. Prefer the simplest visible behavior consistent with this contract.
