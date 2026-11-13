# Analogy map — old systems → agent-era pains, with break points

Source: operator/analyst discussion, 2026-11-13 (recorded verbatim-in-substance
per house rules). Eight candidate transfers from constraint-era systems to
agent fleets, each with the analogy's break point. Plus the three checks that
separate structural transfers from vocabulary transfers, and what the lab
did about the two strongest candidates.

## Standing checks (apply before any analogy enters a pitch)

1. **Is the resource scarce in the same way?** Tokens and provider rate limits
   are; frame time is; *allocation churn may not be for agents*.
2. **Is the feedback signal fast enough?** TCP gets loss within an RTT. 429s and
   long LLM calls arrive late and noisy.
3. **Is the workload stationary?** Erlang and AIMD assume mostly steady traffic;
   agent traffic is heavy-tailed and bursty (one user action → fan-out).

Transfer rule: the strongest transfers share **a scarce resource + a feedback
signal + an admission/degradation policy**. Vocabulary-only analogies are
banned from pitches.

## The eight analogies

| # | system (era) | constraint-era discipline | agent-era analogue | break point | lab tie-in | status |
|---|---|---|---|---|---|---|
| 1 | id games (1990s) | fixed frame budget; predefined degradation steps | per-session token/wall-clock budget + degradation ladder (cheaper model → fewer sub-agents → shorter context → hard stop); "frame budget" maps to "SLO budget per request" | frames are uniform; agent work is heavy-tailed → fixed per-tick budgets can starve rare long tasks; budgets must adapt to the tail | M-11 + M-5 (same primitive, documented lineage) | v1 vocabulary + mechanism |
| 2 | Unix pipes / 16-bit bounded buffers | backpressure by construction: producers block, never queue unboundedly | agents enqueue MORE during a rate-limit stall, then fire everything at once; fix = bounded queues + producer-side admission control | pipes assume one machine; multi-provider needs token-bucket admission from several limits | M-12 admission control (measured: naive's un-jittered retries synchronize — 192 in one instant vs 1–2) | v1 mechanism |
| 3 | TCP congestion control (Jacobson 1988) | AIMD: additive increase on success, multiplicative decrease on loss; no global knowledge needed | adaptive per-provider concurrency: track own in-flight limit, shrink on 429s | 429 signals are late/noisy vs TCP loss; LLM durations ≫ packet RTT variance | **implemented as the `aimd` runtime in the M-12 bench (see §Results)** | v1 mechanism, measured |
| 4 | Lotus 1-2-3 (1983) | dependency-tracked incremental recomputation | re-run only reasoning steps downstream of a changed tool result; whole-conversation replay is why cost grows ~quadratically | LLM steps aren't pure functions (batch nondeterminism) — only pays if cached outputs are reusable | adjacent to M-4/M-9 determinism; depends on cacheability | research direction |
| 5 | Netcode rollback/lockstep (GGPO) | speculate forward; roll back + replay on real input | speculative tool-call execution, discard/replay on divergence | rollback needs deterministic recompute — model calls aren't, unless batching is controlled; would have to replay recorded outputs | connects to the determinism track (M-4/M-9; scoped to engine-controlled systems) | research direction |
| 6 | Erlang queueing (1909→) | closed-form capacity: circuits needed for target blocking probability at given load | the capacity-proof product: workers needed for a target wait at provider limits — the buyer's procurement question, answered as a number | Erlang assumes Poisson arrivals + independent calls; agent traffic is bursty/correlated fan-out → heavy-tailed models are a real research gap | M-12 capacity-proof output (linear estimate) → **M-13** Erlang capacity planning (the math upgrade, measured) | v1 product, math upgrade **done** |
| 7 | Smalltalk/PARC image persistence | full-state snapshot, resume rather than restart | resume-from-checkpoint for agent runs (Anthropic built one; Temporal does event-history) | snapshots are large; agent state includes the whole context window — checkpoint size is itself a cost | orthogonal to the lab's current SKU | research direction |
| 8 | Mainframe JCL / batch scheduling | job budgets + chargeback: declared budget, spend attributed to owner | per-agent/per-team spend attribution with hard limits (the $47K incidents were unattributed) | buyer is finance/platform, not engineering — the interface is chargeback, not code | complements M-12's $ ledger | v1 feature candidate |

## Where analogies fail — the honest line

Transfer-by-metaphor is the failure mode. The 1998 line is retired (retry storms
are established distributed-systems failures); the sellable form: *the agent
layer rebuilt known failures without the operational discipline — the lab
measures what that discipline is worth.*

## Results: AIMD vs quota-blind vs quota-aware (measured, M-12 bench)

Four runtimes, same tasks, same provider (8 conc / 15k→7.5k TPM, external
halving), same **network pathology tape** (jitter 0–60 ms · slow tail 2% ·
client timeout 2,000 ms with tokens still billed · 5xx 1%; draw *N* is a pure
function of (seed, *N*), so every runtime meets the same pathology and the
comparison isolates discipline, not luck):

- **naive** — no concurrency discipline, no per-task budget, exponential
  backoff with **no jitter**.
- **budgeted** — oracle leases: knows the quota (M-2 pool, M-11 budget, leased
  bucket, M-5 step-down, FIFO).
- **aimd** — discipline WITHOUT provider cooperation: a **learned** window
  (in-flight + token) instead of a lease, plus the M-11 budget.
- **aimd_noBudget** — AIMD alone; the control that isolates what AIMD
  contributes versus what the budget contributes.

| metric | naive | budgeted | aimd | aimd_noBudget |
|---|---|---|---|---|
| real tasks completed | 151/180 | **180/180** | **180/180** | 177/180 |
| tokens burned past budget | 563,356 | **0** | **0** | 82,771 |
| 429 rate-limit rejections | 961,375 | **0** | 600 | 612 |
| peak synchronized retries | **192** | 1 | 2 | 2 |
| $ spent | $6.63 | $5.99 | $5.97 | $6.09 |

**The question AIMD answers: how much of the budgeted runtime's win survives
without provider cooperation?** Answer: *all of it, at a small, bounded price.*
AIMD reaches 180/180 and zero runaway waste at $5.97 vs the lease's $5.99 — the
difference is 600 discovery rejections. So the lease's advantage is not
throughput or cost; it is that it does not have to *find out* (0 rejections vs
600). AIMD is the fallback for a quota you cannot observe or lease (a provider
that gives you no headers and no cooperation).

**Three corrections the measurement forced** (each was a wrong model that the
bench caught, not a guess):

1. **AIMD needs a token window, not just a concurrency window.** TCP's
   congestion window is a *byte* window; a concurrency-only AIMD thrashes
   against a token-rate limit — measured 735,649 rejections and 115/180
   completed. The faithful port carries both windows.
2. **The window must not shrink below one segment (MSS floor).** Otherwise a
   single oversized call at the head of the queue deadlocks admission
   permanently — measured 0/180 completed.
3. **Additive increase must be ACK-clocked** (one segment per ACK), not a small
   fixed constant. A fixed constant was ~40× too slow to converge inside the
   horizon — measured 73/180 completed.

**And one honesty correction to the lab's own earlier claim:** the previous
revision of this bench reported "waste 0 (M-11 budget shared)" for an AIMD
runtime that had **no M-11 budget** — `runawayWaste` was only accumulated for
the naive runtime, so the number was an accounting artifact rather than a
measurement. Waste is now counted for every runtime, which is what exposed the
real decomposition: **the per-task budget stops runaway spend; AIMD alone does
not** (aimd_noBudget still burns 82,771 tok past budget). AIMD bounds
concurrency, not spend — the two disciplines are not substitutes.

**Analogy #2 (bounded buffers / backpressure) is now measured too:** without
jitter, naive retries **synchronize** — 192 retries in a single virtual
instant, versus 1–2 for the disciplined runtimes. That is the thundering herd,
counted rather than asserted.

## Results: Erlang-style capacity planning (measured, M-13)

The other strong candidate (analogy #6). The break point was stated up
front — *Erlang assumes Poisson arrivals and independent calls; agent traffic
is bursty and correlated, because one user action can spawn a fan-out* — so
the first job was to measure the premise rather than argue it.

**The premise, measured (T9).** Real agent traffic on this machine: 38,513
tool calls, 29,852 bursts, **E[X] = 1.2901, E[X²] = 2.4472, κ = E[X²]/E[X]² =
1.4703** — **47 % more count-variance than Poisson**, stable across a 40×
range of burst-grouping windows (E[X] 1.235→1.303, κ 1.397→1.485).

**The cost of the assumption, measured (M-13).** Erlang's closed form agrees
with a simulation for M/M/c (max |rel.err| **5.1 %** mean wait, **3.7 %**
P(wait), material cells). Switched to the measured fan-out shape at the same
offered load and circuits:

| A | circuits | Erlang C | fan-out (simulated) | closed form understates |
|---|---|---|---|---|
| 5 | 10 | 0.0289 | 0.1476 | +411 % |
| 8 | 13 | 0.0608 | 0.1903 | +213 % |
| 12 | 17 | 0.1013 | 0.2611 | +158 % |

Mean **3.9× the Poisson answer** (the closed form answers 3.6× too low), and in capacity-plan terms the closed form
buys **up to 2 circuits too few** — largest where the SLO is tightest (0.05–0.25 s),
zero at loose SLOs (2 s), which is exactly how a single loose SLO hides the
problem. The classical compound-Poisson batch correction does **not** transfer
(it over-corrects ~6.3× — it is calibrated for single-server M^X/G/1), so the
correction the product ships is the **measured** burst factor (3.6×), not a formula.

**The honest product shape:** the capacity answer is **two numbers** — circuits
(slots) *and* token quota. M-12's linear estimate prices only the quota.
