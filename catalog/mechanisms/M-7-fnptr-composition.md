### M-7 Frame pipeline composed from hot-swapped function-pointer slots (`data-as-program`)

**Mechanism.** The main loop is a *skeleton of function-pointer slots* — player move,
stage VM, phase handlers, render stages — called through RAM pointers that game
events (timers, script terminators, phase changes) rebind at runtime. The engine is a
fixed pipeline whose behavior is whoever currently occupies each slot.

**Witnesses.** TH04 `MAIN.EXE` (main loop decompiled); MarioXP's event VM is the
same idea at a coarser grain (calibration-level witness).

**Evidence.** (TH04, main game loop `FUN_1aaf_0098` @ `0x1ab88`, ev_65b626…)
- Loop body calls, in order: input poll, `entry()`, `(*DAT_3134_428a)()` (player
  move), `FUN_23a9_6454()` (phase check), `(*DAT_3134_4646)(0x23a9)` (**stage VM**,
  M-3), four more updaters, then `(*DAT_3134_46b6)()`, `(*DAT_3134_bcd0)()`,
  `(*DAT_3134_432c)()`, `(*DAT_3134_46ba)()`, … — a dozen slots per frame.
- Rebinding sites: `FUN_23a9_6454` @ `0x29ee4` (frame-== trigger swaps **three
  pointers at once**: `46b4/46ba/46b6`), and `std_run` rewriting `4646/4648`
  (M-3's self-mutating dispatch).
- Per-frame derived state next to the slots: `frame & 1/2/4/8/16` stored to
  dedicated globals (`DAT_538c..538f`) — the slot consumers read precomputed mods.
- PC-98 GDC page flip in the same loop (`out 0xa4/0xa6`) — pacing co-located with
  dispatch.

**Generalization.** Plugin hosts, middleware pipelines, game framework stage
systems: define N slots, make rebinding a first-class runtime operation driven by
game events, and precompute per-frame derived values once. On modern stacks this is
"dependency injection as an event-driven runtime" — swap handlers per scene/phase
without recompiling the loop.

**Costs.** Control flow becomes invisible statically (each slot has ≥2 writers we
found only via xrefs); slot write ordering bugs produce one-frame glitches;
indirect calls defeat inlining (irrelevant at 190 KB budgets, real at modern scale).

**Status.** single-witness (MarioXP calibration witness exists at coarse grain;
TH05 diff pending → `cataloged`).
