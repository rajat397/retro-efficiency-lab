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

## MEASURED upgrade (2026-11-12): the floor of interpretation

Compiled SQLite from source with its VDBE profiler and measured per-op
hardware cycles on a 10k-row indexed workload (see
`targets/sqlite/findings-vdbe-profile.md`):

- **Dispatch floor: 45 hw cycles/op** (Noop) — roughly one branch-miss
- Most-executed op (Column, 23k execs): 68 cycles — ~1.5× the floor
- **Dominant cost of a point query: Transaction+Halt lifecycle**
  (14.6k cycles avg) — 77% of the program's cycles; interpretation ≈ 3%

So the tax in the arithmetic above is an *upper bound measured when
interpretation replaces compiled work* (V8, 10–22×); SQLite's production
interpreter shows the absolute floor is negligible next to any real work
sharing the statement. The rule stands, strengthened: the lifecycle and
I/O-adjacent compiled work dominate; interpretation of *cold control* is
effectively free.

## MEASURED upgrade (2026-11-13): the second engine — ioquake3's QVM

Built the real ioquake3 interpreter and x86 JIT from source against
toolchain-assembled q3asm programs (`targets/qvm/findings-qvm-floor.md`):

- **Dispatch floor: 7.2 cycles/instruction** (min 6.1) interpreted — ~6×
  cheaper than VDBE's 45. Same giant-switch architecture; the difference is
  that QVM's interpreter caches top-of-stack in `r0`/`r1` registers across
  ops instead of re-reading the stack from memory each dispatch.
- **Interpreter/JIT ratio on compute loops: 10.3–18.5×** — the same band the
  M-1 transfer test measured for a JS interpreter (10–22×). Two independent
  engines agree on the tax.
- **Syscall trap: ~16 cycles**, identical interpreted or JIT'd — the VM
  boundary is a C-call, not bytecode, so the JIT cannot optimize it away.

The rule gains a second leg: *dispatch register discipline* sets the floor
(QVM 7.2 vs VDBE 45 cycles/op), and hot compute code wants the JIT regardless
of how good the interpreter is, while boundary crossings cost what the C-call
costs.

## MEASURED upgrade (2026-11-13): real gamecode — OpenArena through the real engine

Loaded genuine OpenArena B52 bytecode (`cgame` 125,622 instructions) into the
unmodified interpreter and JIT (`targets/qvm/findings-openarena.md`):

- **Load cost:** JIT compile is 2.4× the interpreter's prep cost, but the
  interpreter's word-expanded image (4×codeLength = 1.5 MB) is *larger* than
  the JIT'd machine code (1.1 MB) — the fast interpreter pays in memory.
- **Same `CG_INIT`, identical 74,184 syscalls: 5.76M cycles interpreted vs
  0.56M JIT'd — 10.3×** on real game code, third engine confirming the
  10–22× interpreter-tax band.
- Real game opcode mix: 80% of dispatches are stack traffic
  (LOCAL/CONST/LOAD4/STORE4/ARG/POP ≈ 80% combined) — the QVM is a pure
  stack machine in practice.

Load-time asymmetry now measured: interpretation wins startup (2.4× cheaper
prep), JIT wins steady-state (10×) and even the memory footprint (1.1 vs
1.5 MB). "Interpret cold, compile hot" now has numbers for both sides of
the trade.

## MEASURED upgrade (2026-11-13): the boundary dilutes the ratio

A real syscall layer drove the actual OpenArena frame loop through both
engine modes (`targets/qvm/findings-openarena-frames.md`), controlled by
identical syscall counts (79,416, 0 unknown, both modes):

- **Real frame ratio ≈ 4.3×** (3.3M vs 0.6–0.9M cycles/frame) — much lower
  than the synthetic 10–19×, because a real frame makes **1,289 syscall
  traps** (≈550 HUD draw calls alone) at ~16 cycles each, mode-independent.
- Boundary-heavy workloads (games!) compress the interpreter/JIT gap;
  compute-heavy loops widen it. The decision rule now has the shape:
  *the closer the workload lives to the C boundary, the less the dispatch
  tax matters — and the fewer reasons a JIT can pay for itself.*
