# Probe contract — REQUIRED before any analysis dispatch

Fill every field. A probe whose contract can't be filled isn't ready.

- **Target + artifact**: which artifact/source is analyzed? Authority tier:
  original-binary / official-source / informed-reconstruction (label it —
  lower tiers may not support load-bearing claims).
- **Depth budget**: minimum wall time and tool invocations committed.
  Below-budget results are regraded `preliminary`.
- **The surprise target**: name what a domain expert would NOT already
  know. (Test: if the finding is on the first page of the project's docs
  or Wikipedia, it fails this line.)
- **Evidence class sought**: measured / traced / restated.
- **Repro command** (for measured): the exact command the verifier runs.
- **Verifier**: a second agent, not the author; re-runs the repro command
  and checks anchors SUPPORT the claim (not merely exist).
