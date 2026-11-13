# Product thesis — from catalog to product (2026-11-13)

**Status:** proposal. Supersedes the 2026-11-12 charter's "the lab's unit of output is the
evidence-backed mechanism card, not a decompilation and not a product" — the card was the
right *first* deliverable; it is now the *foundation*, and the product is what the
foundation makes possible.

**Method (operator, 2026-11-13):** pick a big existing problem → break it down by first
principles to its root causes → build the solution ground up from strong fundamentals,
**ignoring what current solutions build** → wrap the fundamentals in improvement layers and
harnesses. The catalog is not the product; it is the load-bearing floor under it.

---

## 1. The problem: agent fleets spend money nobody owns, and fall over

**Why this problem and not another.** Three reasons, in order of weight: (1) the operator
has steered to it twice (`STEER.md`, `docs/PITCH-STRESS-TEST.md`: *"measurement-first
capacity proof for ingestion/agent fleets"*); (2) the lab already holds **measured**
evidence on five of its root causes (M-12, M-13, T8, T9), so the first-principles
decomposition below is anchored in numbers rather than in argument; (3) the pain is
large, current, and paid for in real money — the T8 finding quotes real incidents of
tens of thousands of dollars, unattributed.

**The pain, stated plainly:** teams run agent fleets against metered providers, and they
cannot answer *"what did this cost, why, and what should we do when the provider starts
rate-limiting us?"* They find out on the invoice, or when everything falls over at once.

**What the incumbents build** (and therefore what this must NOT be):

| incumbent class | what it is | why it is not the answer |
|---|---|---|
| Observability / tracing (LangSmith, Langfuse, Braintrust, Phoenix, OTel GenAI) | dashboards over recorded traces | **observes after the fact**; cannot prevent the bad outcome |
| Gateways / proxies (LiteLLM, Portkey, Envoy AI GW, Cloudflare AI GW) | routing, retries, caching | retries *harder*; treats rate limits as errors to hide, not signals to respect |
| Rate-limit clients (SDK retries, vendor tiers) | fixed concurrency, exponential backoff | no cross-session state; each process believes it is alone |
| FinOps dashboards (CCusage, billing exports) | cost reports | reporting is not control |

**None of them** define a unit of work · own the admission decision · own a ledger that
cannot be reconstructed after the fact · answer the capacity question · or offer a
*measured* degradation ladder. Every one of those is a gap the fundamentals already fill
or point at.

> **Boundary, stated honestly.** "Ignore what current solutions build" means ignore their
> *architecture*, not their *requirements*. Streaming, auth, multi-provider routing, and
> audit are requirements, not architecture, and they survive.

---

## 2. First-principles breakdown: physical constraints → root causes

Strip the domain to what is actually true, then ask where current implementations violate
it. These constraints are properties of the world, not of any vendor.

| # | constraint (physics) | root cause (the observable pain) | violated by |
|---|---|---|---|
| P1 | Provider capacity is finite, bursty, and **only the provider knows it** | "it was fine, then everything fell over" | no admission control; no shared state |
| P2 | Under a shared signal, actions become **correlated** | retry storm / thundering herd (measured: **192** synchronized retries vs **1**) | no jitter, no concurrency discipline |
| P3 | An LLM loop has **no natural termination** — it ends when the model stops or something stops it | "one agent ate the budget overnight" | no per-task unit of work, no hard kill |
| P4 | If no unit of work exists at admission, **attribution is impossible later** | "we didn't know what it cost until the invoice" | spend recorded at the provider, not at the task |
| P5 | The context window is a hard wall that **fails silently** | "the agent forgot the beginning" | truncation, not eviction |
| P6 | Near saturation, latency is dominated by **queueing**, not service time | "we bought more quota and it didn't help" | rate and concurrency conflated; linear estimates |
| P7 | Quality is **not free** — degradation trades it away | "when it's slow we cut quality at random" | unmeasured degradation |

---

## 3. Which fundamentals load-bear, and where the holes are

The point of this table is to find out where **new work** is needed, rather than assuming
the catalog is finished.

| root cause | load-bearing fundamental | state | **the hole** |
|---|---|---|---|
| RC-herd (P1,P2) | M-2 bounded pool · leased token bucket · AIMD · jitter | **proven with numbers** (M-12: 961,375 → 0 rejections; 192 → 1) | needs a real provider-cooperation surface (`retry-after`) and cross-session shared state |
| RC-runaway (P3) | M-11 hard per-operation work budget | **proven** (M-12: 563,356 → 0 tok past budget) | **the unit is un-derived.** M-11's unit was "operations"; for agents it must be re-derived (M-12's own lesson). Is it tokens? turns? dollars? *per what?* |
| RC-attribution (P4) | M-14 derive ownership from a table you already hold (no registry) + append-only ledger | mechanism proven; **ledger primitive missing** | who owns the unit? a task, a team, a customer? and the ledger must be unforgeable *after the fact* |
| RC-capacity (P6) | M-13 Erlang closed form + measured burst correction | **proven with numbers** (5.1% validation; up to 2 circuits short) | needs the ingress side: the fleet's *real* arrival shape at scale (T9 is one machine) |
| RC-silent-truncation (P5) | M-5 measured degradation, never drop | proven for frames | for agents "degrade" is a **quality ladder whose order is unmeasured** (M-12 break-point 2) |
| RC-random-quality-cuts (P7) | M-5 + M-13 | partial | same ladder; plus a **quality floor contract** |

**Four of six root causes already have a proven fundamental with numbers. The two holes are
precisely the two that make the difference between a demo and a product**: the *unit of
work* and the *measured degradation ladder*. Everything else is engineering.

---

## 4. The layered build

Fundamentals are the floor, not the product. Each layer is built on the one below it, and
no layer is a dashboard.

```
L4  PRODUCT        capacity plan (circuits + quota) before you buy · live governor ·
                   per-task/team attribution · budget-burn attribution report
L3  HARNESS        pathology rig: mock provider with injected 429/5xx/timeout/jitter/TPM
                   ceiling (built: catalog/transfer-tests/M-12-*/mock-provider.mjs) ·
                   does the governor actually beat naive, measured
L2  GOVERNOR       admission control: leases concurrency + rate · AIMD when the quota
                   can't be leased · jittered retries · hard task-budget kill ·
                   measured degradation instead of dropping
L1  UNIT+LEDGER    the one primitive everything needs: a task-scoped budget whose unit is
                   re-derived for the resource class · an append-only ledger that
                   attributes every unit at admission time (M-14's lesson: ownership
                   derived where the data already exists)
L0  FUNDAMENTALS   the catalog: M-2 pool · M-5 measured degradation · M-11 hard budget ·
                   M-12 portability · M-13 capacity · M-14 attribution
```

**The wedge** — the buyer-facing question only this stack can answer: *"given my fleet's
real arrival shape and my SLA, how many concurrent calls and how much quota do I need,
and what happens to my bill when the provider starts rate-limiting me?"* That is one
number today (M-13) and a control loop tomorrow (L2). It is not a dashboard, and the
incumbents do not answer it.

---

## 5. Falsifiable claims, and what would kill each

| claim | how it fails | status |
|---|---|---|
| A governor beats naive on the same workload | naive beats it on any axis | **measured** (M-12, 3 seeds, trace-hash oracle) |
| The closed form answers the capacity question | Erlang diverges >10% from a live client | **measured** (M-13: 5.1%; and it is *wrong* for real traffic by 3.6× — the correction is measured, not assumed) |
| A per-task budget kills runaways without killing good work | the unit cannot distinguish runaway from hard-but-legitimate work | **REFUTED (M-15, 2026-11-13).** Measured: at every cap, the observed false kills equal the number of productive tasks costing more than the cap — a consumption unit's false kills are *forced* by the cost distribution. The discriminating signal is **progress**, and the primitive is a *pair* (cheap ceiling + progress signal), not a unit. Open: whether real fleets exhibit the progress/stall distinction at all (the workload's progress model is assumed, not measured). |
| The degradation ladder's order is measurable | ordering cannot be established without a quality metric | **OPEN** (E5, not run) — note M-15's consequence: the first rung may not be a *model* choice at all, since a progress signal must exist before any ladder rung can be evaluated |
| The arrival shape generalizes | κ differs materially across fleets | **OPEN** (T9: one machine, one operator) |
| A governor reduces real spend | production fleets show no reduction | untested — needs a live fleet |

---

## 6. The next experiment (the deciding one)

**Derive and measure the unit of work.**

Everything downstream depends on it — the budget (RC-runaway), the ledger
(RC-attribution), the ladder (RC-degradation). M-12's single most transferable lesson is
that **the port's real work is re-deriving the unit**, and for agents it has *not* been
derived. Candidates to test, against each other:

- tokens per task · model calls per task · **dollars per task** · wall-clock per task ·
  cost per *completed outcome* (which may exceed cost per task when retries happen)

The test: take a fleet workload with both legitimate-hard work and runaways, impose each
candidate unit as a budget, and measure which one **kills the runaway without killing the
legitimate work**. That is a transfer test in the lab's own format (deterministic
counters, naive baseline documented as good-faith, trace-hash oracle) and it produces the
L1 primitive.

**This was the M-15 candidate** — and it was run on 2026-11-13. **Result: the hypothesis as
framed was refuted and the better answer found.** No consumption unit separates the two
kinds; the discriminator is a *progress signal*; and the product's L1 primitive is a **pair**
(consumption ceiling + progress signal), which turns the L1 requirement into an
**observability** requirement ("is this task still advancing?") rather than a metering one.
That is a harder thing to build, and it is now the sprint's next target rather than a
footnote.

---

## 7. What this thesis explicitly does not claim

- Not that the catalog is complete — 9 of 14 mechanisms are `proven`; the rest are
  `cataloged` or `single-witness`.
- Not that the governor has been shown to save money — it has been shown to beat a naive
  client on a simulated provider, with a live peer, and nothing beyond that.
- Not that the arrival shape generalizes — T9 is one machine.
- Not that this is the only big problem the fundamentals fit. **If another problem fits
  better, this thesis is wrong and should be replaced, not defended.** The test is
  whether a problem's root causes map onto the fundamentals *structurally* — as they do
  above — rather than whether the catalog happens to mention it.
