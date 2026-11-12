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

**Status.** `seed` — one-side-witnessed (TH04/CPU half measured; agent-fleet half
pending the transfer test above). Rung: this is the first card seeded *from*
the lab's own synthesis rather than from a binary — the loop feeding itself.
