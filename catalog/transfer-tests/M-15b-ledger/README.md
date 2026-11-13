// M-15b transfer test — the ledger: admission-time attribution vs post-hoc reconstruction.
// See bench.mjs for the full model. Short form.

# M-15b transfer test: the ledger

**The question.** Incumbent cost tooling reconstructs attribution *after the fact* — it reads
recorded traces and infers which task each provider charge belongs to. Is that equivalent to
attributing at the moment the work is admitted?

**Workload.** 60 tasks, 422 billable units, invoice total **$215,847**. Retries (12 %),
shared units (8 %, one charge with two candidate owners and no parent hint), ambiguous units
(6 %, two concurrent tasks issuing identical work), plus victim tasks whose every charge is
ambiguous with one partner. The trace exposes **time, cost, content, parent hint** — and not
the owner.

**The result.**

| method | tasks misattributed | nothing owned | orphan charges | provably wrong charges | total error | reconciles |
|---|---|---|---|---|---|---|
| timing (incumbent idiom) | 44/60 | 0 | 0 | **94** | $105,734 | **YES** |
| parent hint | 25/60 | 0 | **36** | 0 | $18,664 | **YES** |
| content match | 55/60 | **11** | 0 | **55** | $84,610 | **YES** |
| **admission-time (reference)** | **0/60** | 0 | 0 | 0 | **$0** | YES |

**The finding.** All three post-hoc methods reconcile the invoice total **exactly** while
attributing 25–55 of 60 tasks wrongly. The invoice balances; nobody owns the cost — and that
is invisible to any check that compares the ledger's total to the bill, which is exactly the
check a finance team runs. The reason is structural, not tuning: in the shared case the
information is not in the trace at all.

**The product consequence.** The ledger must be **append-only and inside the admission path** —
every billable unit written down with its owner at the moment it is admitted. It is not a
tracing problem; a reconstruction cannot recover what was never recorded.

**Teeth.** Mutants that remove the ambiguity from the workload, expose the owner in the
trace, stop the content strategy from grouping identical work, or drop orphan charges from a
strategy's reconciliation each exit **1**; the control exits 0. Two mutants that do *not*
refute the claim (one that makes reconstruction strictly worse, one that is a behavioural
no-op) are reported as such rather than dressed up.

Run: `node bench.mjs`
