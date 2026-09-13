# QA report

Final results are recorded here only from the Rig QA worktree pinned to a committed SHA.

## Negative-control proof

Before the final run, Cobalt temporarily forced the visible running total to `0 hours`. The targeted
Playwright flow failed in both Chromium and WebKit at the positive `15.5 hours` assertion. The source
was restored before commit. This proves the total gate observes rendered behavior and can reject a
broken app.

The first draft of the browser matrix also exposed that the Chromium project had inherited WebKit
from the iPhone device descriptor. The configuration now explicitly selects Chromium; the offline
test consequently runs in a genuinely independent engine.

## Pinned final application run

Rig QA worktree: commit `36f328f`, port 5419.

- Vitest: 45/45 core checks passed.
- Playwright phone matrix: 7 passed; the one intentional skip is the duplicate WebKit offline smoke.
  The complete user flow, due-day reminder, save failure, hit targets, persistence, reload scroll,
  and keyboard order pass in both Chromium and WebKit. Offline install/reload passes in Chromium.
- Production build: passed (`index.html` 4.49 kB, CSS 6.68 kB, JavaScript 13.40 kB before gzip).
- Dependency audit: zero known vulnerabilities.
- Finder verification: C1 independently re-ran the integrated interface in both engines and confirmed
  every critical/high/medium/low cross-review finding fixed. C2 then fixed the two residual navigation
  and reload observations, which the committed Playwright suite now covers.
- Visual review: current-period and final-day phone captures are in `docs/screenshots/`; the reminder
  is fully visible at scroll position zero and the current day is clearly marked.
