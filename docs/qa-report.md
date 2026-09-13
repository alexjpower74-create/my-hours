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
