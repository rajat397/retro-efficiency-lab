### M-7 Frame pipeline composed from hot-swapped function-pointer slots (`data-as-program`)

**Mechanism.** The main loop is a *skeleton of function-pointer slots* — player move,
stage VM, phase handlers, render stages — called through RAM pointers that game
events (timers, script terminators, phase changes) rebind at runtime. The engine is a
fixed pipeline whose behavior is whoever currently occupies each slot.

**Witnesses.**
1. TH04 `MAIN.EXE` (main loop decompiled): a dozen function-pointer slots per
   frame, rebound at runtime by game events.
2. **Doom** (official id source, `linuxdoom-1.10`): the entire sim is
   function-pointer composition — `P_RunThinkers` (p_tick.c:101–121) walks the
   thinker list dispatching `currentthinker->function.acp1(currentthinker)`,
   removal via a `-1` sentinel; per-object behavior is rebound by state changes:
   `if (st->action.acp1) st->action.acp1(mobj)` (p_mobj.c:76–78) — monster/weapon
   behavior lives in `mobjinfo_t.states[].action` DATA tables (info.h:1153),
   swapped by `P_SetMobjState` at runtime.

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

**Status.** **proven** — transfer test `catalog/transfer-tests/M-7-fnptr-composition/`:
fnptr table dispatch **faster** than a fair 100-case switch control on V8
(38.6 vs 60.1 ns/transition, identical arithmetic), new behaviors attach as
data with the dispatcher untouched, composed-machine replay IDENTICAL.
Costs: polymorphic call site (JIT-dependent), no-jit engines may invert.
