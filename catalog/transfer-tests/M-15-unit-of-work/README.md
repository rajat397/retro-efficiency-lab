// M-15 transfer test — the unit of work (deciding experiment).
// See bench.mjs for the full model. Short form.

# M-15 transfer test: the unit of work

**The question.** A per-task budget has a unit: tokens, model calls, dollars, seconds. M-12's
most transferable lesson is that a budget's unit must be *re-derived* for the resource
class — and for agent fleets it never was. This test asks which unit lets a budget kill
runaway agents **without killing legitimate-but-expensive work**.

**Workload.** 200 tasks (120 normal, 50 legitimate-hard of which 6 are deep/huge-context,
30 runaway), 8-way concurrency, 20 % of calls on a cheap model at 1/6 price, kinds shuffled
so FIFO order is uncorrelated with kind. Runaways consume at the *same rate* as
legitimate-hard work — only their **progress** differs. One workload, pre-generated once
(common random numbers), replayed by every policy.

**Policies compared.** Per-task caps on tokens / calls / dollars / seconds; a
progress-based policy (kill after N consecutive turns with no progress); the paired policy
(progress signal + consumption backstop); an outcome-level governor ($ per completed task,
windowed, with cooldown); and the naive baseline (kills nothing, good-faith idiom).

**The result.**

| finding | verdict |
|---|---|
| H2 — no *consumption* unit separates runaway from legitimate-hard | **CONFIRMED** — at every cap, observed false kills equal the number of productive tasks costing more than the cap. A cap's false kills are *forced* by the distribution, not chosen. |
| H1 — an outcome-level budget fixes it | **REFUTED** — the governor reduces waste by *not admitting work* and leaves the forced false kills unchanged. |
| H3 — a *progress* signal dominates | **partly** — at identical completions and identical false kills (170 / 0), progress reaches that point at **$2,184.59** waste vs **$9,879.83** for the best consumption unit: **4.5× less waste**. It loses at very tight waste ceilings, because detecting a stall costs turns. |
| H4 — the *paired* primitive dominates both | **partly** — 3 of 5 matched-waste ceilings; the pair's value is bounding the damage when the signal is late or wrong. |

**The finding in one line.** The budget's unit is not a consumption quantity — it is a
**progress signal**, and the usable primitive is a **pair**: a cheap consumption ceiling that
bounds the damage immediately (whose false kills are forced) plus a progress signal that
discriminates (but costs latency to observe).

**Scope.** The progress signal is **modeled, not measured** — real fleets may not have a
clean progress/stall distinction. This is why the card's status is `single-witness`. The
result is the *shape* of the answer, not its prevalence.

**Teeth.** Four mutants of the load-bearing rules (discriminator removed · stall detector
fires every turn · progress signal inverted · stall detector never fires) each exit **1**;
the control exits 0. The bench **asserts** five mechanism-level invariants rather than
merely reporting them — a bench that reports a hypothesis is not a bench that tests it.

Run: `node bench.mjs`
