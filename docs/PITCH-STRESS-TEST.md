# Investor-pitch stress test — 2026-11-13

The operator asked for a 3-bullet seed pitch defending the lab, then challenged it
against the repo. This file records the exchange verbatim-in-substance and the
bar-raising plan that follows from it. Standing rule: **the pitch never lowers the
bar; the artifacts rise to it.**

## The 3-bullet pitch (as delivered)

1. *Eleven mechanisms proven, zero hand-waving — every claim carries a file, a test,
   and a number.*
2. *Decision infrastructure de-risks teams before decisions are made; the catalog is
   the moat.*
3. *The methodology is repeatable by any engineer; honest audits make the numbers
   trustworthy.*

## Diligence result (verified against the repo, not memory)

**Claim 1 — 80% evidenced, two sentences fail:**
- All 11 transfer tests exist (`catalog/transfer-tests/*/bench.mjs` + README); all
  11 cards carry status fields; SYNTHESIS carries the numbers.
- FAILS: SYNTHESIS's own honest-limits line says three payoff claims are unproven
  (M-9 LUT-precision payoff, M-6 procedural-as-compression, M-1 extensibility
  economics). "All eleven proven" contradicts our own doc.
- FAILS: "zero hand-waving" is false while RCT2 T5A–T5D sit at class `restated`.

**Claim 2 — structure true, market claim unproven:**
- Compounding is real *internally*: the DECISION doc carries three dated `measured`
  upgrades; M-1 was strengthened three times by later targets.
- FAILS: zero external users have de-risked anything. "Moat" = 11 cards + 2 docs on
  a private repo. That is a prototype catalog, not a moat.

**Claim 3 — discipline real, scalability asserted:**
- Evidenced: probe-contract template, depth classes used under pressure, honest
  audit in `docs/LEARNINGS.md` (including self-critical verdicts).
- FAILS: no second engineer has ever run the pipeline. "Repeatable by any engineer"
  is a belief, not a datum.

## The corrected pitch (what was actually defensible at audit time)

1. Eleven mechanisms with runnable transfer tests and measured numbers — three
   payoff claims explicitly open, one target's findings honestly labeled unverified.
2. Decision-rule layer compounding *internally*; external validation is the next
   milestone, not a claim.
3. Methodology documented to template standard; proving it transfers to a second
   engineer is the open question.

## Bar-raising decision (operator, 2026-11-13)

Do not soften the pitch. Raise the artifacts. The failing points become work items:

| failing point | fix | status |
|---|---|---|
| 3 unproven payoff claims | **CLOSED 2026-11-13:** all three were already proven by their transfer benches; SYNTHESIS's honest-limits line was stale and has been corrected (M-9 11.3–11.9×, M-6 2521×/470×, M-1 20.0×/4-data-rows). All 11 benches re-run exit 0. New lesson: honesty lines are ledgers — audit them before quoting them. | closed |
| RCT2 `restated` | **BLOCKED on input:** no original `rct2.exe` exists on this machine (commercial — operator supplies). Written `targets/rct/RE-ANCHOR.md`: per-finding evidence requirements + bounded 4-step REA method + honest-regrade rule. The blocker is now a defined dependency, not an intention. | blocked → awaiting binary |
| "moat"/external validation | **DEFINED:** the milestone is one completed external card (an engineer outside the lab producing a card + bench that a reviewer cannot distinguish from in-house). Until then the pitch says "compounding demonstrated internally" verbatim. | criterion defined |
| "repeatable by any engineer" | **MADE TESTABLE, AND RUN #1 LANDED — the datum says the claim does NOT yet hold.** `docs/RUNBOOK.md` (5 gated steps, one-day budget, definition of done) · cold run #1 on `VMAP.COM` (2026-11-13, a binary referenced in zero prior repo files, DOS `.COM` format never before mined): produced a good card + a mutation-tested bench, independently verified against the original bytes. But the runbook's graduation criterion ("the reviewer cannot tell which cards were written in-house") was **not met**: the executor hit two traps the runbook did not warn about (flat-vs-segment xrefs silently empty; per-call artifact re-import making a bulk decompile a trap), and the first bench shipped toothless until explicit boundary cases were added. Datum: `docs/COLD-RUN-2026-11-13.md`; the runbook is now **v2** with all ten gaps fixed. The claim stays labeled a **belief** — now a better-informed one, with the exact conditions for run #2 to graduate it. | **run #1 done; claim NOT graduated** (protocol fixed to v2) |

Pitch rule going forward: every sentence in a pitch must trace to a repo file, and
anything not yet measured is named as such in the same breath — which is only
possible because the honest-limits lines are maintained.

## Update 2026-11-13 (external skeptical review intake)

A full external review (recorded with dispositions in
`docs/CRITICISM-LOG-2026-11-13.md`) sharpened the claims further:
- M-5's headline lag number was a run-length artifact — corrected to
  lag-growth-rate (0.996 s-lag/s naive, linear) vs horizon-invariant ~17ms;
  the property is the CONTRAST.
- M-2 timing demoted to directional; the counted metrics (allocations 247,977 → 0
  and 26,605 → 0) are the load-bearing headline.
- M-4/M-9 determinism scoped: single-host, jitter-variation evidence; the
  cross-platform matrix is untested and named as such. The x87/SSE finding is
  interpreter-vs-JIT inside one engine — a different mechanism from LLM
  batch nondeterminism; the determinism SKU is engine-controlled systems.
- M-12 upgraded: multi-seed reproducibility (3 seeds, medians reported), and the
  counterfactual capacity proof (the measurement product wedge) now prints
  required-quota/finish-time/lever trade-offs from the measured workload.
- Product steer adopted: measurement-first capacity proof for ingestion/agent
  fleets; "1998's mistakes" framing retired in favor of "the agent layer rebuilt
  known distributed-systems failures without the operational discipline — here
  is what that discipline is worth, measured."
