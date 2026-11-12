### M-1 Event-program-as-VM: behavior as a data payload (`data-as-program`)

**Mechanism.** The entire application (all frames, levels, and logic) is a bytecode
event program stored in a data file, interpreted by a small fixed runtime — game-
specific code is ~zero; behavior ships as payload.

**Witnesses.**
- **SQLite** (2000–, official source; **measured**): VDBE dispatch floor
  **45 hw cycles/op**, Column at 68 — interpretation ≈ 3% of a point
  query's cycles; Transaction lifecycle dominates (77%). Built with
  `-DVDBE_PROFILE`; upstream amalgamation bug patched en route
  (`targets/sqlite/findings-vdbe-profile.md`). WAL-vs-DELETE measured at
  opcode granularity: `Transaction` 16,231 → 5,562 cycles avg (−66%,
  identical 800-exec sets) is the journaling delta; work opcodes and the
  45-cycle interpretation floor are unchanged — lifecycle cost only
  (`targets/sqlite/findings-vdbe-lifecycle.md`, parser TDD-tested).
- **ioquake3 QVM** (2020s, GPL source; **measured**): the real interpreter
  from source against toolchain-assembled `.qvm` programs — dispatch floor
  **7.2 cycles/instr** (min 6.1), ~6× cheaper than VDBE per dispatch (top-of-
  stack cached in registers across ops); interpreter/JIT ratio **10.3–18.5×**
  on compute loops, matching the transfer test's 10–22× band; syscall trap
  ~16 cycles, identical interpreted or JIT'd
  (`targets/qvm/findings-qvm-floor.md`).
- **SQLite** (2000–, official source, traced): the VDBE — `sqlite3VdbeExec`
  (`src/vdbe.c:903`, ~200 opcode arms) interprets compiled query programs;
  real EXPLAIN dumps show 15–49-op programs with Gosub/Return subroutines
  and Rewind/Next loops (`targets/sqlite/findings-VDBE.md`). The hybrid
  the decision doc prescribes, at planetary scale: queries are data,
  hot loops are compiled C.

1. MarioXP (Click & Create 1.x, 2003): 72 frames / 13,450 events / zero leftover
   bytes in `MarioXP_0121.cca`; runtime shell 448 KB + `CNCS32.DLL` (168 KB).
2. **Another World** (Eric Chahi, 1991; official 15th-anniversary VM source,
   `fabiensanglard/Another-World-Bytecode-Interpreter` 919⭐, cross-checked against
   `cyxx/rawgl` 209⭐): the *entire game* is bytecode — `VirtualMachine::hostFrame()`
   runs up to **64 threads** per frame, each with its own PC into the loaded
   `segBytecode` resource segment (vm.cpp:~430–465). `executeThread()` dispatches
   opcodes whose bytes double as packed draw parameters (`0x80`-bit = draw polygon
   from the cinematic database; `0x40`+bits = fill polygon with coordinates encoded
   in opcode bits — vm.cpp:~480–575). Control flow: `op_jmp`, `op_jnz` (decrement a
   VM variable per frame = timer), `op_condJmp`. Threads rebinding each other:
   `op_setSetVect` stores a new PC into another thread's slot via
   `threadsData[REQUESTED_PC_OFFSET]`, applied by `checkThreadRequests()` between
   frames — the same self-mutating dispatch M-3 found in TH04.
3. TH04 `.STD` bytecode (see M-3) is the same mechanism specialized to timed
   stage-event scripts — M-1 is the family's generic form, M-3 its timed form.

**Evidence.** CCA `PAME` header; event decoder parsed 13,450 records with 0 leftovers
(`/mnt/data/rea/MarioXP/tools/cnc_events.py`); runtime imports `CNCS32.dll` and reads
the `.cca`. TH04 side: `0.STD` string @ `0x31c61`, loader `FUN_1aaf_0be1` @ `0x1b6d1`.

**Generalization.** Server-driven UI / rules-as-data / plugin systems: ship a fixed
interpreter, put behavior in payload. Plugins and patches become data, not code.

**Costs.** Data-driven logic is opaque to static analysis (the MarioXP hidden-mode
hunt required writing a full event-format decoder); debugging without the original
editor is painful; the VM becomes the performance ceiling.

**Status.** **proven** — transfer test `catalog/transfer-tests/M-1-event-vm/`:
new behaviors = data rows with 0 interpreter changes; the interpreter tax
measured honestly at ~10–22× per op (the card's costs field, quantified);
replay determinism IDENTICAL. Bench bugs caught and fixed per lab rules:
unbounded entity growth (→ bounded pool, TH04 law) and missing per-frame
instruction budgets (→ TH04/AW's execution discipline).
