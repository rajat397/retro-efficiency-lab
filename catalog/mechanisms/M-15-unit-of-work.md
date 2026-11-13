### M-15 The budget's unit is not a consumption quantity — it is a progress signal, and the primitive is a pair (`unit-of-work`)

**Mechanism.** A per-task budget has a *unit*: tokens, model calls, dollars, seconds. The
lab's most transferable lesson (M-12) is that a budget's unit must be **re-derived** for the
resource class — and for agent fleets it had never been derived. This card settles it, and
the answer is not what the framing expects:

> **No consumption quantity separates a runaway agent from a legitimate-but-expensive one.**
> A cap's false kills are *forced* by the cost distribution, not chosen. The only signal that
> separates the two kinds is **progress** — whether the task is still advancing — and that is
> not a quantity of consumption at all. The usable primitive is therefore a **pair**: a cheap
> consumption *ceiling* that bounds the damage immediately, plus a *progress signal* that
> decides whether to kill. The consumption cap is the blunt instrument; the progress signal is
> the precise one; each covers the other's weakness.

**Witnesses.** One — the transfer test below (`catalog/transfer-tests/M-15-unit-of-work/`),
a deterministic discrete-event fleet of 200 tasks (120 normal, 50 legitimate-hard of which 6
are deep/huge-context, 30 runaway) under 8-way concurrency, with 20 % of calls on a cheap
model at 1/6 price. Status is **`single-witness`** and the reason is load-bearing, not
thrift: *the premise this card tests — that real agent tasks exhibit a progress/stall
distinction — is assumed by the workload model, not measured from a real fleet.* Measuring
it is the next experiment, not a footnote.

**Evidence** *(all `measured`; deterministic counters, seeded PRNG, virtual clock, no network,
no LLM calls; naive baseline is good-faith idiom — it kills nothing and retries nothing)*

* **H2 — CONFIRMED: a consumption cap carries no information beyond its own threshold.**
  Runaways are unbounded, so any cap kills all 30 of them; the observed false kills equal,
  at *every* cap tested, the number of productive tasks whose natural cost exceeds that cap:

  | cap $ | productive tasks above the cap | observed false kills | runaways killed |
  |---|---|---|---|
  | 5 | 169 | 169 | 30 |
  | 20 | 85 | 85 | 30 |
  | 40 | 50 | 50 | 30 |
  | 160 | 35 | 35 | 30 |
  | 320 | 10 | 10 | 30 |

  The identity is exact at all seven caps. **A cap's false kills are a property of the cost
  distribution, not of the tuning.** Lowering the cap buys waste reduction with legitimate
  work, one task at a time, and no amount of tuning changes that.

* **H1 — REFUTED: an outcome-level budget does not fix it.** The outcome governor
  ($ per completed task, sliding window, with a cooldown) reduces waste by **not admitting
  work**, and leaves the forced false kills unchanged. It defers; it does not discriminate.

* **H3 — the progress signal dominates where it can act.** Best progress policy (kill after
  8 consecutive turns with no progress): **0 false kills / 170 completions / $2,184.59
  waste.** Best consumption unit (calls @ 50): **0 false kills / 170 completions / $9,879.83
  waste.** *Identical completions, identical false kills, **4.5× less waste*.** The progress
  policy wins on 3 of 6 matched-waste ceilings on both axes at once; it loses at the very
  tight ceilings, because detecting a stall costs turns — you must burn some work before you
  can tell. That asymmetry is the reason the primitive is a **pair**, not a single rule.

* **The naive baseline.** 170 completions, 0 false kills, **$79,051.50 waste — 66 % of spend**
  burnt on tasks that produced nothing.

**Generalization.** This changes the product's L1 primitive. It is *not* "the right unit of
work" — it is **a cheap ceiling plus a progress signal**, and the ceiling's unit is almost
irrelevant (tokens, calls, dollars, and seconds all behave the same way, because none of them
carries the discriminating information). The progress signal is the lab's existing primitive
wearing a new hat: **M-5's measured slowdown** (measure the *rate of progress*, not the
cost) and **M-11's budget** (a hard stop once the budget's unit is re-derived as *stall*).
The product implication: a fleet governor needs a way to ask *"is this task still advancing?"*
— which is an **observability** requirement, not a metering one. That is a different, and
much harder, thing to build than a token counter.

**Costs / honest limits.**

1. **The progress signal is modeled, not measured.** Real agents may not have a clean
   progress/stall distinction; the workload's progress probabilities are chosen. This card
   proves the *shape* of the answer, not its prevalence.
2. **Cost-only workloads have no progress signal.** A batch job that must produce a large
   artifact may legitimately spend a long time without "progressing" in any observable way —
   the signal has to be chosen per workload, and choosing it badly false-kills.
3. **Detecting a stall costs work.** The tight-ceiling regime is better served by the blunt
   ceiling; the two are complements, not a replacement.
4. **The outcome governor is not useless** — it is a *scheduling* tool (defer work while
   wasting), and it is on a different axis from discrimination. It is not the answer to
   false kills.
5. **One synthetic workload, one machine, one operator.** The distribution of legitimate work
   is the input that determines the forced false-kill count, and that distribution is not
   universal (cf. T9: even the *arrival shape* varies by workload).
6. **No real money was spent** in this measurement — the dollars are modeled at $1/M-token
   and $1/6/M-token, and the *ratio* is the result, not the absolute.

**Status.** `single-witness` — one witness (this bench), and its premise is unmeasured. It
does **not** graduate to `proven` until the progress signal is observed in a real fleet.

**Repro.** `cd catalog/transfer-tests/M-15-unit-of-work && node bench.mjs` — exit 0, prints
`VERDICT:` counters and five `CHECK` lines. The bench has teeth: four mutants of the
load-bearing rules (discriminator removed, stall detector firing on every turn, progress
signal inverted, stall detector never firing) each exit **1**; the control exits 0.
