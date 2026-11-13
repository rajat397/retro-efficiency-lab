// M-16 transfer test — does the arrival shape generalize across workloads?
// See bench.mjs for the full model. Short form.

# M-16 transfer test: the arrival shape

**The question.** T9 measured the burst factor κ = E[X²]/E[X]² of real agent traffic at
≈1.47 and presented it as *the* shape. Is κ a property of the **fleet** (so one measurement
sizes any fleet) or of the **work** (so a fleet sized with another fleet's number is wrong)?

**Method.** Real traffic from this machine's opencode session store (30,096 bursts, 1 s
grouping window), segmented by agent type and by project directory — both proxies for the
kind of work. Per-segment κ carries a seeded bootstrap 95 % CI; the histograms are committed
so the bench recomputes the moments itself.

**The result.**

| segment | bursts | κ | 95 % CI |
|---|---|---|---|
| agent `rea` | 1,506 | **1.0818** | [1.0516, 1.1133] |
| agent `orchestrator` | 12,898 | 1.1293 | [1.1148, 1.1444] |
| agent `intent-driven` | 899 | 1.2636 | [1.2052, 1.3227] |
| agent `build` | 2,393 | 1.2993 | [1.2240, 1.3911] |
| agent `general` | 12,102 | **1.6016** | [1.5666, 1.6430] |
| project `~/Downloads` | 1,716 | 1.0913 | [1.0671, 1.1188] |
| project `~` | 16,345 | 1.1812 | [1.1658, 1.1962] |
| project `~/Documents/Default Project` | 9,954 | **1.6569** | [1.6170, 1.6984] |
| fleet-wide | 30,096 | 1.4684 | — |

- **53 % relative spread** (1.0818 → 1.6569).
- **24 of 28 segment pairs have non-overlapping 95 % CIs.**
- **The fleet-wide κ lies outside the CI of 8/8 segments** — the average describes none of
  the segments it averages.

**The finding.** κ is a property of the **work**, not the fleet — it tracks how much work is
launched at once (sequential calls → κ 1.08; parallel/fan-out calls → κ 1.66). M-13's burst
correction is therefore **not a fleet constant**: a capacity plan computed with a borrowed κ
is wrong by up to ~50 % on the delay, and the measurement is cheap (one pass over the
fleet's own traces) but must be done **per workload**.

**Scope.** One machine, one operator; the segments are work types, not independent fleets, and
the corpus includes this experiment's own traffic. The claim supported is "κ is a property of
the work"; fleet-to-fleet transfer remains open.

**Teeth.** Four mutants of the load-bearing computation exit **1** (κ computed as E[X]² · CI
helper always reporting disjoint · fleet κ averaged over segments instead of pooled · the
"average misleads" check disabled); the control exits 0. One mutant that does not refute the
claim is reported as such.

Run: `node bench.mjs`
