### M-16 The arrival shape is a property of the work, not of the fleet (`arrival-shape`)

**Mechanism.** A fleet's call-arrival process is characterised by its **burst factor**
κ = E[X²]/E[X]² — how much more count-variance it carries than Poisson (κ = 1). T9 measured
κ ≈ 1.47 for agent traffic and presented it as *the* shape. This card shows that κ is
**not a fleet constant**: it varies by more than half across segments of real traffic, and the
fleet-wide average lies outside the confidence interval of **every segment it averages over**.
Sizing one workload with another workload's κ is wrong by up to the measured spread.

**Witnesses.** One — the transfer test below (`catalog/transfer-tests/M-16-arrival-shape/`)
over real agent traffic from this machine's opencode session store (30,096 bursts, 1 s
grouping window), segmented by **agent type** and **project directory** — both proxies for
the kind of work. Per-segment κ carries a seeded bootstrap 95 % CI (2000 resamples) computed
at extraction time; the histogram is stored too, so the bench recomputes the moments itself.
Status is **`single-witness`**.

**Evidence** *(all `measured`; deterministic, reads a committed data file — no database, no
network, no wall-clock)*

| segment | bursts | E[X] | E[X²] | κ | 95 % CI | %multi |
|---|---|---|---|---|---|---|
| agent `rea` | 1,506 | 1.056 | 1.206 | **1.0818** | [1.0516, 1.1133] | 4.3 % |
| agent `orchestrator` | 12,898 | 1.084 | 1.327 | 1.1293 | [1.1148, 1.1444] | 5.8 % |
| agent `intent-driven` | 899 | 1.212 | 1.858 | 1.2636 | [1.2052, 1.3227] | 13.4 % |
| agent `build` | 2,393 | 1.181 | 1.811 | 1.2993 | [1.2240, 1.3911] | 11.1 % |
| agent `general` | 12,102 | 1.531 | 3.755 | **1.6016** | [1.5666, 1.6430] | 24.5 % |
| project `~/Downloads` | 1,716 | 1.079 | 1.270 | 1.0913 | [1.0671, 1.1188] | 6.7 % |
| project `~` | 16,345 | 1.119 | 1.480 | 1.1812 | [1.1658, 1.1962] | 7.7 % |
| project `~/Documents/Default Project` | 9,954 | 1.620 | 4.349 | **1.6569** | [1.6170, 1.6984] | 26.7 % |
| **fleet-wide** | 30,096 | 1.288 | 2.437 | 1.4684 | — | — |

- **Relative spread: 53 %** (1.0818 → 1.6569).
- **24 of 28 segment pairs have non-overlapping 95 % CIs** — the variation is not sampling
  noise.
- **The fleet-wide κ lies outside the CI of 8/8 segments.** The average is not a
  conservative estimate of any segment; it is a blend that describes none of them.

The mechanism is legible in the ordering: sequential tool calls (`rea`, κ 1.08) produce
almost no bursts; parallel tool calls and sub-agent fan-out (`general`, κ 1.60) produce many.
The burst factor tracks **how much work is launched at once**, which is a property of the
workflow, not of the machine.

**Generalization.** M-13's capacity answer takes the arrival shape as an *input* — its burst
correction (3.6× on measured traffic) is applied to a fleet's Erlang answer. This card says
that input **must be measured per workload**. Two consequences:

1. A capacity plan computed with a borrowed κ is wrong by up to ~50 % on the delay, which is
   the difference between a plan that meets its SLO and one that does not.
2. The measurement itself is cheap (mine the fleet's own traces; the extraction is one pass)
   and it is **per-workload**, so a fleet doing two kinds of work needs two shapes, not one.

**Costs / honest limits.**

1. **One machine, one operator.** The segments are *work types*, not independent fleets. The
   claim supported here is "κ is a property of the work"; whether it transfers between
   *fleets* remains open.
2. **The corpus contains this experiment's own traffic.** The `general` segment (κ 1.60)
   includes the cold-run sub-agent's parallel tool calls, and `~/Documents/Default Project`
   (κ 1.66) is where this work happened. So the burstiest segments are partly an artifact of
   this session — though the artifact cuts *both* ways: the `rea` segment (this session's
   own agent, sequential calls) is the *least* bursty at κ 1.08.
3. **The segmentation is a proxy.** Agent type and directory are proxies for "kind of work";
   the true segmentation is unknown and probably continuous.
4. **Burst grouping is a method choice.** T9's window-sensitivity table (50 ms → 2000 ms)
   shows κ is stable to ~7 % over a 40× window range, so the 53 % spread is not a window
   artifact — but the absolute numbers move with the window.
5. **The corpus moves.** The extraction timestamp is recorded; re-running it on a later day
   gives different counts (this session's own traffic is being recorded as it happens).

**Status.** `single-witness` — one witness (this bench over one machine's traffic).

**Repro.** `cd catalog/transfer-tests/M-16-arrival-shape && node bench.mjs` — exit 0, prints
`VERDICT:` counters and seven `CHECK` lines. The bench has teeth: mutants that compute κ as
E[X]², make the CI-overlap helper always report disjoint, average the fleet κ over segments
instead of pooling them, or disable the "average misleads" check each exit **1**; the
control exits 0. One mutant (inverting the misleads criterion) does not fail — the fleet κ
happens to lie outside *every* segment CI, so the inverted test yields the same set — and is
reported as such rather than dressed up.
