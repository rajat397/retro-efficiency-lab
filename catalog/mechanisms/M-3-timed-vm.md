### M-3 Timed bytecode VM with self-mutating dispatch (`data-as-program`)

**Mechanism.** Stage logic runs as a bytecode stream whose opcodes are *timed against
the frame counter* (`*ip == frame_low_byte` → execute), and the interpreter stores its
own dispatch as function pointers in RAM — **the bytecode rewrites those pointers as
it runs**, hot-swapping the VM into its next phase.

**Witnesses.** TH04 `MAIN.EXE` (loader + runner decompiled); TH05 uses the same
`.STD` scheme (pending diff — ReC98 documents per-game VM variants).

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

**Status.** single-witness (TH05 diff pending → `cataloged`).
