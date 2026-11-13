### M-15b A ledger that reconstructs spend is not a ledger that owns it — the owner must be captured at admission (`ledger`)

**Mechanism.** Incumbent cost tooling reconstructs attribution **after the fact**: it reads
recorded traces and infers which task each provider charge belongs to. Admission-time
attribution instead *knows* the owner, because the owner is known at the moment the work is
admitted. These are not equivalent, and the gap is not a tuning problem — it is a property of
what a trace contains. Three situations make the owner **underdetermined** by the trace:

| situation | what the invoice has | what the trace can show | why the owner is unrecoverable |
|---|---|---|---|
| **retry** | two charges for one logical unit | two charges, same content | which task owns the *second* charge is known only to the scheduler |
| **shared** | one charge | one charge, **no parent hint** (the sub-agent had two parents) | two candidate owners, neither preferred by the trace |
| **ambiguous** | two charges | two charges, identical content, concurrent | no ordering evidence exists |

Reconstruction must **guess** in all three. Admission-time attribution does not guess at all.

**Witnesses.** One — the transfer test below
(`catalog/transfer-tests/M-15b-ledger/`): 60 tasks, 422 billable units, invoice total
**$215,847**, with retries (12 %), shared units (8 %) and ambiguous units (6 %) injected at
measured rates, plus a set of *victim* tasks whose every charge is ambiguous with a single
partner. The trace exposes **time, cost, content, parent hint** — and not the owner, which
is the whole point. Status is **`single-witness`** (the sibling card M-15 is the same).

**Evidence** *(all `measured`; deterministic counters, seeded PRNG, virtual clock, no network,
no LLM calls; the baseline is the incumbent idiom done properly, not a strawman)*

| method | tasks misattributed | tasks with nothing owned | orphan charges | **provably wrong charges** | total error | reconciles with invoice |
|---|---|---|---|---|---|---|
| timing (incumbent idiom) | **44 / 60** | 0 | 0 | **94** | $105,734 | **YES** |
| parent hint | 25 / 60 | 0 | **36** | 0 | $18,664 | **YES** |
| content match | 55 / 60 | **11** | 0 | **55** | $84,610 | **YES** |
| **admission-time (reference)** | **0 / 60** | 0 | 0 | 0 | **$0** | YES |

**The dangerous shape, measured: all three methods reconcile the invoice total *exactly*
($215,847) while attributing 25–55 of 60 tasks wrongly.** The invoice balances; nobody owns
the cost. That is the incident shape — and note it is *invisible* to any check that compares
the ledger's total to the bill, which is precisely the check a finance team runs.

Three separate metrics, three different failure shapes, and they matter differently:

- **misattributed tasks** — the team's per-task numbers are wrong (44/60 under the incumbent
  timing heuristic).
- **orphan charges** (36 under the parent-hint strategy) — money that belongs to somebody and
  is attributed to **nobody**. The parent pointer is the strongest signal a trace carries, and
  it still leaves 36 charges unowned.
- **provably wrong charges** (94 under timing, 55 under content) — a charge given to a task
  that was **not even a candidate** for making it. Not a guess gone wrong; an
  impossibility, produced by a heuristic that had no way to know.
- **tasks with nothing owned** (11 under content match) — a task charged for work, with $0
  attributed to it. The victim construction guarantees this shape exists.

**Generalization.** The product's L1 primitive is therefore **not** a cost dashboard and **not**
a tracing layer: it is an **append-only admission-time ledger** — every billable unit is
written down *with its owner* at the moment it is admitted. Two consequences that change the
build:

1. **The owner must be chosen at admission.** That is a decision the scheduler already makes
   (it knows which task it is working on). It must simply be *written down* at that moment,
   which is nearly free — and impossible to recover later.
2. **This is not a tracing problem.** A tracer reconstructs from the outside; the ledger
   must be *inside* the admission path. Building it after the fact, however good the
   reconstruction, reproduces the incident it was meant to prevent. The T8 finding (OpenCode:
   no token ledger, spend visible only as a provider-limit error) is consistent with this:
   the ledger was never *in* the path.

**Costs / honest limits.**

1. **One synthetic workload.** The misattribution counts depend on the injected ambiguity
   rates (12/8/6 %); the *shape* of the result is robust, the numbers are not universal.
2. **The trace is a model of a trace.** Real traces expose more (request ids, session
   headers, tool-call trees) and less (provider-side retries may not appear at all). A richer
   trace shrinks the gap; it cannot close it, because in the shared case the information
   simply is not there.
3. **The reconstruction strategies are good-faith idioms, not strawmen** — they are what
   tracing and cost tooling actually do — but they are not exhaustive. A stronger
   reconstruction would score better than 25/60 wrong.
4. **Attribution is not the same as accountability.** The ledger says who was charged; it
   does not say who should have been. A policy layer still has to decide the split for
   shared work.
5. **Nothing here was measured against a real invoice.** The dollars are modeled.

**Status.** `single-witness` — one witness (this bench). It does not graduate to `proven`
without a second witness or a real-fleet trace.

**Repro.** `cd catalog/transfer-tests/M-15b-ledger && node bench.mjs` — exit 0, prints
`VERDICT:` counters and seven `CHECK` lines. The bench has teeth: mutants that remove the
ambiguity from the workload, expose the owner in the trace, stop the content strategy from
grouping identical work, or drop orphan charges from a strategy's reconciliation each exit
**1**; the control exits 0.
