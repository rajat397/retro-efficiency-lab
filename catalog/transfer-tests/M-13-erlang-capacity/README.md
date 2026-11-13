// M-13 transfer test — Erlang-style capacity planning for bursty agent traffic.
// See bench.mjs for the full model and erlang.mjs for the math. Short form.

# M-13 transfer test: capacity planning under fan-out arrivals

The M-12 capacity proof is a **linear rate calculation** (tokens ÷ target
time). It prices tokens; it does not price *slots*, and it ignores queueing.
The buyer's question is the other one: **how many concurrent provider calls do
I need so the wait stays inside SLO?** That answer depends on the *shape* of
the arrival process, not just its mean — and agent traffic is not Poisson.

The classical answer is Erlang's (1909/1929), and it is a closed form:

- **Erlang B** — loss system: P(block) for *n* circuits at offered traffic *A*.
- **Erlang C** — delay system: P(wait), and mean queueing delay
  `W_q = C(n,A) / (nμ − λ)`.

with *A* = λ/μ in Erlangs; here a **circuit = one concurrent provider-call
slot**, μ = 1/mean call service time, λ = call arrival rate.

## The arrival shape is MEASURED, not assumed

`targets/opencode/data/fanout-bursts.json` — extracted by
`scripts/extract-fanout.mjs` from this machine's own opencode session store:
**38,513 real tool calls**, **29,852 bursts**.

| | value |
|---|---|
| E[X] (burst size) | 1.2901 |
| E[X²] | 2.4472 |
| **κ = E[X²]/E[X]²** (count-variance inflation vs Poisson) | **1.4703** |
| P(X > 1) | 14.4 % |
| E[X given X>1] | 3.01 |
| peak concurrent in-flight | 25 |

The burst-grouping window is a *method* choice, so the extraction records the
sensitivity: across windows from 50 ms to 2000 ms (a 40× range) E[X] moves
1.235 → 1.303 and κ moves 1.397 → 1.485. The shape is not an artifact of the
window. **Real agent traffic carries ~47 % more count-variance than Poisson** —
that is the premise of the whole gap, and it is now measured.

## Part 1 — validation (does the math agree with a simulator?)

A simulation can be self-consistent and still wrong. M/M/c simulation vs the
closed-form Erlang C:

| A | circuits | measured mean wait | Erlang C | rel.err | measured P(wait) | Erlang C | rel.err |
|---|---|---|---|---|---|---|---|
| 2 | 4 | 0.3380 | 0.3478 | −2.8 % | 0.1734 | 0.1739 | −0.3 % |
| 5 | 7 | 0.6419 | 0.6483 | −1.0 % | 0.3230 | 0.3241 | −0.4 % |
| 8 | 10 | 0.7770 | 0.8184 | −5.1 % | 0.3942 | 0.4092 | −3.7 % |

Max |rel.err| on **material** cells (predicted wait ≥ 50 ms or P(wait) ≥ 0.01):
**5.1 % (mean wait), 3.7 % (P(wait)) — agrees within sampling noise.** The
other 6 cells are degenerate (both sides ~0; a relative error there is noise,
so they are excluded and counted, not hidden).

## Part 2 — the Erlang gap

Same offered load, same circuits; arrivals switched from Poisson to the
measured fan-out shape:

| A | circuits | Poisson (sim) | Erlang C (closed form) | fan-out (sim) | burst effect (vs Poisson) | closed form understates |
|---|---|---|---|---|---|---|
| 5 | 10 | 0.0263 | 0.0289 | 0.1476 | +460 % | +411 % |
| 8 | 13 | 0.0570 | 0.0608 | 0.1903 | +234 % | +213 % |
| 12 | 17 | 0.0999 | 0.1013 | 0.2611 | +161 % | +158 % |

**Mean: fan-out arrivals make the wait 3.9× the simulated-Poisson wait, and
the closed form answers 3.6× too low** (the two differ because the closed form
and the Poisson simulation differ by a few percent themselves — Part 1).

### The buyer answer, by SLO

Circuits needed for a target **mean wait** — closed form (what a plan would
buy) vs simulated fan-out (what is actually needed):

| A | SLO | closed form (Poisson) | simulated (fan-out) | understated by |
|---|---|---|---|---|
| 8 | 0.05 s | 14 | 16 | **2** |
| 8 | 0.1 s | 13 | 15 | **2** |
| 8 | 0.25 s | 12 | 13 | 1 |
| 8 | 0.5 s | 11 | 12 | 1 |
| 8 | 1 s | 10 | 11 | 1 |
| 8 | 2 s | 10 | 10 | 0 |
| 12 | 0.05 s | 19 | 21 | **2** |
| 12 | 0.1 s | 18 | 20 | **2** |
| 12 | 0.25 s | 16 | 18 | **2** |
| 12 | 0.5 s | 15 | 16 | 1 |
| 12 | 1 s | 14 | 15 | 1 |
| 12 | 2 s | 14 | 14 | 0 |

**A plan built on the closed form alone buys up to 2 circuits too few**, and
the error is largest where the SLO is tightest — exactly where a capacity
commitment is made. The divergence closes at loose SLOs (2 s): both shapes
meet them with the same circuits, which is why a single loose SLO hides the
problem entirely.

## Part 3 — can a formula close the gap, or must it be measured?

The classical compound-Poisson (M^X/G/1) Pollaczek-Khinchine batch term,
`(E[X²]−E[X]) / (2 E[X] (1−ρ))`, was tested against the simulation:

| A | circuits | measured fan-out wait | Erlang C only | + batch term | over/under | burst factor vs closed form |
|---|---|---|---|---|---|---|
| 5 | 10 | 0.1476 | 0.0289 | 0.9258 | 6.3× | 5.11× |
| 8 | 13 | 0.1903 | 0.0608 | 1.2268 | 6.4× | 3.13× |
| 12 | 17 | 0.2611 | 0.1013 | 1.6260 | 6.2× | 2.58× |

**The classical term over-corrects by ~6.3×.** It is calibrated for a
*single-server* M^X/G/1 queue where ρ→1, and does not transfer to M^X/M/c with
c ≫ A. The usable correction is **empirical**: on the measured traffic shape
the delay is **3.6× the closed-form answer** (5.11× at A=5 → 2.58× at A=12 —
more circuits absorb the bursts). So the product ships the *measured factor*,
and says that the classical formula does not transfer here.

## Scope honesty

- The closed form is proven only for M/M/c (Poisson, exponential). The bench
  shows it agreeing to ~5 % there, and shows it **understating** real traffic.
- The burst factor (3.6×) is measured at *these* operating points on *this*
  traffic shape. It is not a universal constant: it falls from 5.11× at A=5
  to 2.58× at A=12 (more circuits absorb the bursts), and it is a property of
  the arrival distribution, not of Erlang.
- The M^X/M/c **exact** solution is not used. The simulation is the ground
  truth for the fan-out case; the closed form is the benchmark it is measured
  against.
- The service time here is **exponential** (the M/M/c assumption). Real
  provider calls are heavy-tailed; that is a second, unmeasured source of
  optimism in the closed form — flagged, not claimed.

## The product output

The capacity plan for an agent fleet is **two numbers, not one**:

1. **Circuits (concurrent slots)** — from the queueing answer, with the
   measured burst correction. This is what M-12's linear estimate never priced.
2. **Token quota (TPM)** — the rate limit, which is a *different* constraint.

At A = 12 Erlangs (3 calls/s of 4 s each): the closed form says 14 circuits
for a 2 s mean-wait SLO and 20 for ≤1 % blocking; the measured fan-out
correction says buy 16. Sixteen slots at μ = 0.25 and 1,800 tok/call imply
**432,000 TPM** — against M-12's observed provider quota of 7,500 TPM, which
says the fleet at that ceiling is **quota-bound, not concurrency-bound**. The
linear estimate for the same workload (240,000 TPM) prices only the quota and
never mentions slots.

Run: `node bench.mjs` (deterministic, seeded, no LLM calls, no network).
