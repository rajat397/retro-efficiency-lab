### M-13 (PROVEN) Queueing math gives a closed-form capacity answer — but only for Poisson arrivals, and real agent traffic is not Poisson (`erlang-capacity`)

**Mechanism.** Erlang's loss/delay systems (1909/1929) turn a capacity
question into arithmetic: given an arrival rate, a service time, and a target,
how many circuits do you need? The agent-era version of the same question is
the buyer's: *how many concurrent provider calls do we need so the queueing
wait stays inside SLO, and what token quota does that imply?* M-12's capacity
proof answered only the second (a linear tokens ÷ time estimate).

**The mapping (validated by transfer test):**

| Erlang (1909) | agent fleet (2026) |
|---|---|
| circuit | one concurrent provider-call slot |
| μ (service rate per circuit) | 1 / mean provider-call service time |
| λ (arrival rate) | provider-call arrival rate |
| A = λ/μ (Erlangs) | offered load |
| n (circuits) | the provider's concurrency ceiling / the fleet's own |
| P(block), P(wait), W_q | slot rejection, slot wait, SLO compliance |

**Status.** **proven** — transfer test
`catalog/transfer-tests/M-13-erlang-capacity/` (`bench.mjs` + `erlang.mjs`:
deterministic M/M/c and M^X/M/c simulation, seeded PRNG, no LLM calls, no
network). Measured:

| finding | number |
|---|---|
| closed form vs simulation, material cells | max \|rel.err\| **5.1 %** (mean wait), **3.7 %** (P(wait)) — agrees |
| real arrival shape (measured, 38,513 tool calls, 29,852 bursts) | E[X] 1.2901, E[X²] 2.4472, **κ = E[X²]/E[X]² = 1.4703** |
| burst effect on the wait | **3.4× the Poisson answer** (mean, material cells; 4.66× at A=5 → 2.37× at A=12) |
| circuits the closed form understates | **up to 2** (largest where the SLO is tightest; 0 at loose SLOs) |
| classical M^X/G/1 batch term | **over-corrects ~6.8×** — does not transfer to M^X/M/c with c ≫ A |

**Why this is a finding and not a formula.** The closed form is *validated*
(≈5 %) for M/M/c and *falsified* for the traffic it is meant to price: the
Poisson assumption is worth 3.4× on the delay and up to 2 circuits on the
plan. The premise of the gap is itself measured — real agent traffic carries
**47 % more count-variance than Poisson** (κ = 1.47), stable across a 40×
range of burst-grouping windows.

**What did NOT transfer.** The classical compound-Poisson batch correction
`(E[X²]−E[X]) / (2E[X](1−ρ))` is calibrated for a single-server M^X/G/1 queue
where ρ→1; applied to M^X/M/c it over-corrects by ~6.8×. The usable
correction is the **measured** burst factor, and the simulation remains the
ground truth for a capacity commitment.

**Scope honesty.** Proven: the closed form and the simulator agree for M/M/c;
the Poisson assumption understates measured agent traffic by the amounts
above; the capacity plan needs circuits *and* quota. Not proven: the exact
M^X/M/c solution (simulation stands in); the burst factor's stability across
other fleets (it is a property of the arrival distribution, not of Erlang); the
service-time assumption (exponential here — real provider calls are
heavy-tailed, a second unmeasured source of optimism in the closed form);
and the M-13 numbers say nothing about *quality* under load, only about wait.

**Origin.** Operator steer 2026-11-13 (the eight-analogy debrief, STEER.md):
Erlang-style capacity planning named as one of the two strongest candidates,
with the break point stated up front — "Erlang assumes Poisson arrivals and
independent calls; agent traffic is bursty and correlated because one user
action can spawn a fan-out." This card measures that break point.
