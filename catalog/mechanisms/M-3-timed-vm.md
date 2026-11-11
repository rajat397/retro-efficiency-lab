### M-3 Timed bytecode VM with self-mutating dispatch (`data-as-program`)

**Mechanism.** Stage logic runs as a bytecode stream whose opcodes are *timed against
the frame counter* (`*ip == frame_low_byte` → execute), and the interpreter stores its
own dispatch as function pointers in RAM — **the bytecode rewrites those pointers as
it runs**, hot-swapping the VM into its next phase.

**Witnesses.**
1. TH04 `MAIN.EXE` (1998): loader `FUN_1aaf_0be1` @ `0x1b6d1`, runner `FUN_23a9_4341`
   @ `0x27dd1`, dispatch = **near pointer** (`DAT_3134_4646`) + data segment passed as
   call argument.
2. TH05 `MAIN.EXE` (1998): loader `FUN_1ae1_0fdc` @ `0x1bdec`, runner
   `FUN_2528_0d8c` @ `0x2600C`, dispatch = **far pointer pair** (`0xbf46 = 0x1242`,
   `0xbf48 = 0x1ae1`) — same team, same year, evolved implementation.

**Evidence.**
- Loader `std_load` = `FUN_1aaf_0be1` @ `0x1b6d1`: reads `N.STD`, walks
  length-prefixed records, builds a per-script pointer table at `DAT_3134_3d7a`
  (linear `0x350BA`) + bytecode stream pointer `std_ip` (`DAT_3134_3dba`).
- `std_run` = `FUN_23a9_4341` @ `0x27dd1` (found via `stage_vm` pointer xref chain:
  loader writes offset `0x4341` into `DAT_3134_4646` @ linear `0x35986`; xrefs: main
  loop call site, loader, the VM itself).
- Decompiled runner: `if (*std_ip == DAT_3134_538a)` (frame counter) → consume count →
  iterate 4-byte spawn records → enemy-spawn handler `FUN_23a9_4263`; on `0`
  terminator: `DAT_4646 = 0x11c0; DAT_4648 = 0x1aaf` — **dispatch rewritten by the
  bytecode it just executed**.
- Called from the main loop as `(*DAT_3134_4646)(0x23a9)` — the data segment is an
  argument (near code / far data split).
- TH05 runner (ev_3b001f…): adds a per-call preamble (`FUN_2528_20a2`, map-tile
  scroll), spawns via `FUN_2528_0c90` gated on a flag, and hot-swaps to the next
  runner as a **far pair** (`0x1ae1:0x1242`). Script pointer table lives in the
  EMS-allocated `std_seg`, referenced far (`0x352a`/`0x356a` pairs).
- ReC98 cross-ref: `formats/std.hpp` (`STD_ENEMY_SCRIPT_COUNT = 32`, `std_ip`,
  `stage_vm = std_run`); `std.cpp` loader matches the decompiled record walk.

**Generalization.** Cutscene/dialog/event systems, server-side entity scripts,
firmware task schedulers: give each script a *frame-time* opcode so the VM needs no
priority scheduler, and let script terminators rebind the interpreter (phase machine)
instead of a hardcoded state machine.

**Costs.** Timing against a shared frame counter makes scripts order-sensitive and
replay-hostile to frame-rate changes; self-mutating dispatch is invisible in static
analysis (we found the second runner only through the pointer's xrefs); a bad
terminator strands the pointer.

**Status.** **cataloged** — two full binary witnesses (TH04 near-ptr dispatch, TH05
far-ptr dispatch, both decompiled end-to-end: loader → timed runner → self-rebind).
The TH04↔TH05 diff (near+arg vs far pair; spawn-flag gating added) is itself the
generalization: the dispatch convention is a per-binary choice, the *mechanism* is
stable.
