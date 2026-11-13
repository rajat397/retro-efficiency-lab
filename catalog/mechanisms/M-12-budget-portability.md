### M-12 (SEED) Budget disciplines are resource-agnostic — port by re-deriving the budget's unit (`budget-portability`)

**Mechanism.** The TH04 budget disciplines — bounded pools (M-2), per-tick work
budgets (M-11), measured slowdown (M-5) — are not CPU tricks; they are
resource-agnostic *scarcity disciplines*. Porting them to a new resource class is
not code reuse: it is re-deriving what "one frame," "one slot," and "one budget
unit" mean for the exhausted resource. (Origin: operator insight, 2026-11-13 —
"the resource being exhausted is different: TH04's pain was CPU and allocation
inside one process on a fixed frame budget; agent fleets exhaust tokens, provider
rate limits, and context size.")

**The mapping (to be validated by transfer test):**

| TH04 resource (1998) | agent-fleet resource (2026) | ported mechanism |
|---|---|---|
| frame budget 16.6 ms | per-turn token budget | M-11 work budget |
| entity slots (fixed pool) | concurrent provider-call slots | M-2 bounded pool |
| CPU saturation | provider rate limit (RPM/TPM) | M-5 stepped degradation |
| heap churn (allocs/frame) | token spend ($) per task | M-2 + budget ledger |
| memory footprint | context window | eviction = slot-reuse analog |
| missed-frame backlog (99.6 s) | unbounded queue / cost overrun | admission control: defer/reject |

**Break-points — where the analogy FAILS (the actual porting work):**
1. **Ownership.** TH04 owned its whole machine and measured a local count to
   drive the step-down. Provider quotas are shared, external, and bursty — the
   "live count" that drives M-5's one-time slowdown is remote. Budgets must be
   *leased* (client-side token buckets synced to observed 429s), not just measured.
2. **Hard time vs metered money.** A frame budget is a wall you hit. Token
   budgets are money — degradation is a *model-tier ladder* that trades quality,
   not just latency. The step-down policy needs a quality-floor contract the
   1998 version never needed.
3. **Determinism asymmetry.** TH04's sim was deterministic end-to-end; LLM calls
   are not. Determinism transfers only to the *orchestration layer* (tool order,
   budgets, retries) — which is precisely the layer worth making replayable, and
   where M-4/M-9's integer discipline still applies.
4. **Silent truncation.** The frame budget fails loudly (missed frames). The
   context window fails *silently* (dropped middle of the prompt). Needs explicit
   eviction discipline (slot-reuse analog), not just budgeting.

**Witnesses (seed side).** TH04 mechanisms: measured (M-2/M-5/M-11, transfer
tests with numbers). Agent side: **not yet measured — this is the open half.**

**Proposed transfer test (next iteration).** Agent-loop bench, naive vs budgeted
runtime, same task list, 10× overload:
- naive: unbounded tool loop, unbounded parallel calls, no budget
- budgeted: call pool (M-2), per-turn tool/token budget (M-11), tier ladder +
  concurrency step-down on 429s (M-5), admission control at queue bound
- metrics (metered, so deterministic even though LLMs aren't): tokens/task,
  $ overrun at cap, queue lag p50/p99, task completion rate, tool-call count
- oracle: hash the *orchestration trace* (call sequence + budget decisions) —
  replayable even when completions aren't.

**Costs (of the discipline, ported).** A quality floor must be chosen up front;
leased quotas add sync complexity; admission control rejects work a naive system
would (eventually) complete; budget tuning is a new constant set that can be
wrong (the TH04 constants were tuned over years).

**Status.** **proven (at the orchestration-model level)** — transfer test
`catalog/transfer-tests/M-12-budget-portability/bench.mjs` (deterministic
discrete-event sim: 200 tasks, 20 runaway, provider 8-conc / 15,000→7,500 TPM
halving at minute 1, virtual-clock, no LLM calls). Extended 2026-11-13 with a
**network pathology layer** (jitter, slow tail, client-side timeout with
tokens still billed, 5xx partial failures — a deterministic tape shared by
every runtime) and a **fourth runtime** (`aimd`, Jacobson AIMD with a learned
window instead of a lease) plus its control (`aimd_noBudget`). Measured:

Four runtimes over the same task list, provider, and **network pathology
tape** (jitter 0–60 ms · slow tail 2% · client timeout 2,000 ms with tokens
still billed · 5xx 1%; draw *N* is a pure function of (seed, *N*), so every
runtime meets the same pathology and the comparison isolates discipline):

| metric | naive | budgeted | aimd | aimd_noBudget |
|---|---|---|---|---|
| real tasks completed | 151/180 | **180/180** | **180/180** | 177/180 |
| runaway agents | never stop | 20/20 budget-killed at turn 12 | 20/20 | never stop |
| tokens burned past budget | 563,356 | **0** | **0** | 82,771 |
| 429 rate-limit rejections | 961,375 | **0** (leased bucket) | 600 (discovery) | 612 |
| client timeouts | 37 | 33 | 33 | 34 |
| peak synchronized retries | **192** | 1 | 2 | 2 |
| $ spent | $6.63 | $5.99 | $5.97 | $6.09 |

Oracle: the orchestration trace (per runtime) hashes identical across repeated
runs — the budget/scheduling layer is replayable, for all four runtimes.

**Three findings the network-pathology layer produced (each measured as a
failure before it was fixed):**

1. **The per-task budget stops spend; AIMD does not.** `aimd_noBudget` still
   burns 82,771 tok past budget while `aimd` (AIMD **plus** the M-11 budget)
   burns 0. AIMD bounds *concurrency*, not per-task spend. An earlier revision
   of this bench reported "waste 0" for a runtime that had no budget at all —
   an accounting artifact presented as a measurement; waste is now counted for
   every runtime.
2. **A lease avoids discovery; AIMD must pay for it.** The leased bucket takes
   0 rejections because the provider cooperates; AIMD takes ~600 probes to
   learn the same quota and still reaches 180/180 at the same cost.
3. **Without jitter, retries synchronize** — `naive` peaked at 192 retries in
   one virtual instant; the disciplined runtimes peaked at 1–2.

**AIMD porting notes (Jacobson 1988 → agent fleet).** An AIMD with only a
concurrency window thrashes against a *token-rate* limit (measured 735,649
rejections, 115/180 completed): TCP's congestion window is a **byte** window,
so the faithful port carries a token window as well. Two rules had to be
honored, each measured as a failure first: the window must not shrink below
one segment (MSS floor) or a single oversized call at the head of the queue
deadlocks admission (0/180); and additive increase must be ACK-clocked (one
segment per ACK) rather than a small fixed constant, which was ~40× too slow
to converge inside the horizon (73/180).

**Capacity proof: rate-only, by construction.** The counterfactual capacity
output in this card is a **linear rate estimate** (tokens ÷ target time). It
prices token *quota*, not concurrent *slots*, and it ignores queueing. The
capacity question that needs slots — "how many concurrent calls do we need so
the wait stays inside SLO?" — is answered separately in **M-13**, where the
Erlang closed form is validated against a simulation (≈5 %) and then shown to
understate the circuits by up to 2 on measured agent traffic.

**Scope honesty.** Proven: the *port* — pool, per-task budget, leased quota, and
the one-time step-down on an externally-halved quota (break-point 1) all work
against token/rate-limit resources with metered, deterministic metrics; and
AIMD reaches the same completion and cost as the lease without provider
cooperation, paying ~600 discovery rejections for it. Not yet exercised:
break-points 2–4 (model-tier quality ladders, determinism against real LLM
output, context-window eviction) — the sim's "completions" are a cost/latency
model, so only the orchestration layer's claims are measured. The pathology
layer is a *model* of the network, not the network: its rates are chosen, not
observed. `mock-provider.mjs` (in the transfer-test dir) exists to check the
bench's predicted rejection counts against a live client. First card seeded
*from* the lab's own synthesis rather than from a binary — the loop feeding
itself.
