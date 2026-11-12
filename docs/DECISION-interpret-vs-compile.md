# Decision: when to interpret behaviors as data vs compile them

*Lab decision doc — grounded in transfer-test measurements, not taste.
Companion to catalog M-1 (event-program-as-VM) and M-7 (fnptr composition).*

## The measured facts

| Fact | Source | Number |
|---|---|---|
| Interpreter tax in V8 | M-1 transfer test | **~10–22× per op** (103.8 ns/op VM vs 5.1 ns/op inlined) |
| Fnptr table vs fair switch | M-7 transfer test | table is **faster** on V8 (38.6 vs 60.1 ns/transition) — dispatch cost is NOT the tax; the per-op interpretation loop is |
| Data-attach extensibility | M-1 transfer test | new behavior = **0 interpreter lines** (data rows) vs ~6+ lines + dispatch arm |
| Replay determinism of data programs | M-1 transfer test | hash-identical across runs |
| Order-independent self-mutation | M-3 transfer test | deferred rebinds = scheduler-independent cascades |

The tax decomposes cleanly: **dispatch** (choosing the behavior — free or
cheap in JIT languages) vs **interpretation** (executing a program *as
data* — the 10–22×). Conflating them is the common design error.

## The decision rule

**Interpret (behaviors as data) when:**

1. Behaviors are authored or modified *after compilation* — by tools, mods,
   designers, or the shipped binary itself (MarioXP shipped its event
   *editor*; TH04 ships event chunks; Another World's bytecode IS the game).
2. The behavior set changes faster than the release cycle.
3. Non-programmers must author (the data format is the UI).
4. Replay/audit of *behavior composition* is required (data programs replay
   deterministically and their edits are diffs, not recompiles).

**Compile (behaviors as code) when:**

1. The op-count in hot loops is large: at 10–22× per op, an interpreted
   inner loop pays the tax millions of times per frame-second. Rule of
   thumb from the measurement: if a behavior runs > ~1M ops/sec sustained,
   interpretation needs its own budget analysis (M-11).
2. The behavior set is static across releases.
3. The author audience is programmers anyway.

**The hybrid that wins in practice — and the evidence that it's old:**

- Hot path compiled, cold control in data. This is not a modern invention:
  - **SQLite's VDBE** — the most-deployed DB on earth ships queries as
    *bytecode* (the VDBE program is data; the engine interprets it). The
    hot inner loops (B-tree ops, page cache) are compiled C. Query plans
    are data-driven decisions made per query (see Target 6).
  - **Quake III's QVM** (1999): game logic shipped as interpreted bytecode
    with an optional machine-code path — interpret vs compile *as a
    runtime choice inside one binary* (Target 7 will anchor this).
- Budget the interpreter like any other operation (M-11): per-frame
  instruction caps (TH04/AW discipline) — measured in the M-1 test's
  per-frame budget fix.

## The break-even arithmetic (from the M-1 numbers)

Let T = interpreter tax multiplier (~10–22 on V8, ~3–10 on JVM/.NET JITs),
f = frequency of behavior change, C = cost of a recompile-and-redeploy
cycle (build+test+ship). Interpreting pays when:

    f × C  >  (T − 1) × ops_per_second × time_share_of_the_behavior

For a behavior that runs 100k ops/sec (~1% of a core), T=15: the tax costs
~1.4% of a core. Any deployment pipeline slower than a day makes data-driven
behavior cheaper. For a 10M ops/sec inner loop, the tax costs a full core —
no pipeline is worth that; compile it.

## Recorded for the catalog

This decision is *derived from the lab's own measurements* — the honest
scope: numbers are V8-specific for the tax; SQLite/Q3 anchors below are
being added as Target 6/7 evidence lands.
