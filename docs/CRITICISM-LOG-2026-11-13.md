# Criticism intake log — 2026-11-13 (skeptical-investor review)

An external review challenged the lab. Per house rules: pull the exact points,
verify each against the repo, fix what code can fix, record what remains open.
Verdict per point below. Nothing was argued away.

## Points and dispositions

### 1. "Baseline fairness — naive baselines inflate results"
**Verified against code.** M-2's naive side is documented in the bench header and
README as the standard modern idiom (object literals pushed to a plain array,
swept in place — the `.filter` variant), written with the same tooling, and
explicitly labeled good-faith (`catalog/transfer-tests/M-2-slot-pool/README.md`).
**Upgrade shipped:** diligence notes added to the README; the load-bearing metric
restated as the *counted* one (allocations: 247,977 → 0 and 26,605 → 0, exactly
reproducible), with wall-clock speedup demoted to directional (observed 0.85×–2.62×
across runs — now recorded instead of hidden).
**Residual:** every future bench must state its baseline's competence in the header
(rule added to LEARNINGS §1).

### 2. "17ms vs 99.6s — run-length artifact?"
**The critic is right, and the fix made the finding sharper.** Measured (M-5 bench
now prints a horizon-invariance table): naive lag grows **linearly at 0.996
s-lag per 1s of run** (49.8s@50s, 99.6s@100s, 199.2s@200s) — it IS a run-length
artifact. The TH04 law's lag is **horizon-invariant (~17ms at any run length)**.
The honest unit is **lag-growth rate vs bounded steady state**, not a lag number.
Load profile now printed: sustained 2.2× overload, arrival 60 steps/s attempted,
capacity = budget B per 16.6ms frame.

### 3. "Reproducibility — one run or repeated?"
**Partially covered before; now strengthened.** Deterministic metrics
(allocations, hashes, backlog bounds) are exact across runs. Wall-clock numbers
were labeled noisy but not shown. **Shipped:** M-2 README now carries the
observed timing spread (3+ runs). **M-12 now runs 3 seeds**: naive 144/152/144
done, waste share 19–21%, budgeted 180/180 on every seed; trace-hash stability
holds per seed. Residual: single-host only — cross-host runs are the next
reproducibility step (requires a second machine).

### 4. "Cross-platform byte-identical needs a test matrix"
**Scope corrected.** What M-4 measured: byte-identical replay of ONE recording on
the SAME host under *different machine-load jitter* (two jitter streams), plus
the FP-mechanism contrast (float-dt sim diverges; fixed-tic doesn't). What was
NEVER claimed or tested: different OS/CPU/compiler. The M-4 card's language is
being tightened: "byte-identical under machine-load variation (single host);
cross-platform matrix untested." The x87-vs-SSE finding (Target 7) is the
concrete cross-mode risk we measured *within* one host.
**Residual:** cross-platform matrix needs a CI matrix (deferred; single-host
env available now).

### 5. "Do the mechanisms apply to network/API-bound systems?"
**That is exactly what M-12 measures** — the transfer was run, not asserted:
tokens/rate-limits/quota (network-bound resources) with 100% completion vs 34–36
starved, 19–21% runaway waste share → 0, ~900k 429 backoffs → 0, quota-bound p99
lag in both modes (the honest part: lag does not improve; completion and waste do).
**Open per the critic's sharper question:** our sim has latency but not network
pathology (jitter distributions, timeouts, partial failures, proxy chains). The
ingestion-fleet harness (below) is where that lands.

### 6. "Determinism competition: batch-invariant kernels (Thinking Machines)"
**Accepted — scope correction, not refutation.** Their result: LLM nondeterminism
from batch-dependent kernels, fixed by batch-invariant kernels, open-source. Our
FP finding is a *different mechanism*: interpreter-vs-JIT arithmetic
non-equivalence inside one engine, measured by syscall drift. Consequences,
recorded: (a) the determinism SKU narrows to **engines you control** (games,
backtesting, sims) — do not pitch it against LLM batch nondeterminism; (b) for
LLM traces, the lab's oracle is the **orchestration trace** (budget/scheduling
decisions — replayable even when completions aren't), which complements rather
than competes with batch-invariant kernels; (c) DECISION doc language updated.

### 7. "Budgets must be denominated in tokens and dollars"
**Already true in M-12** (leased token bucket, $ columns in the output) — the
critic's demand is met by the artifact, and the capacity-proof output now states
recommendations in tokens/min, parallel tenants, and % shed.

### 8. "Bounded runtime is crowded (Temporal et al.) — differentiate via counterfactual capacity proof"
**Accepted as the wedge.** Shipped the first version in the M-12 bench: given the
observed workload (2,904,464 tokens / 200 tasks) and a target (≤60 min), it
computes required sustained quota (48,408 TPM), projected finish at current
quota (387 min), and the three trade-off levers (raise quota / 7× parallel
tenants / shed 20% via budgets). This is the measurement product's core output,
demonstrated — the productization question stays open.

### 9. "'1998's mistakes' is a sales line"
**Accepted.** Retry storms/thundering herds are established distributed-systems
failures. The honest framing: *the agent layer rebuilt these failures without the
operational discipline distributed systems already adopted — and the lab measures
what that discipline is worth.* Language corrected in this log and to be used in
any pitch.

### 10. "MAST study: most failures are reasoning/coordination, not loop discipline"
**Accepted as market sizing.** The addressable slice is termination/budget-class
failures (FM-1.5 ≈ 12.4% in their data) plus the systems subset. A loop-discipline
runtime is a slice product, not the whole market — recorded for the pitch.

### 11. "Steer: ingestion/scraping fleets; measurement tool first; the deciding experiment"
**Adopted as the next work item.** The M-12 bench already satisfies part of the
deciding experiment (rate-limited mock provider, fixed budget, two retry
policies, multi-seed, lag/completion/tokens). Remaining to call it done: network
pathology in the provider model (jitter, timeouts, partial failures), and real
traffic traces if a partner supplies them. Product framing recorded:
**measurement-first (capacity proof against customer traces), runtime later.**

## Standing rules added

- Every bench header states its baseline's competence and the metric's semantics
  (growth-rate vs steady-state; counted vs timed).
- Determinism claims name their matrix explicitly ("single host, jitter
  variation" today; cross-platform only when a CI matrix exists).
- The determinism pitch is split: engine-controlled determinism (SKU) vs LLM
  batch nondeterminism (not our fight).
- "1998" language is banned from product framing; mechanisms are dated by
  witness, sold by measurement.
