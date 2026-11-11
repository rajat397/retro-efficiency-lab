# Target 4 — Another World (Eric Chahi, 1991)

Status: **witnessed** (2026-11-12)

## Witness authority

Official 15th-anniversary bytecode interpreter source
(`fabiensanglard/Another-World-Bytecode-Interpreter`, 919⭐, cloned to
`/mnt/data/opt/awvm`), cross-checked against `cyxx/rawgl` (209⭐) — the author-
collaborated release of the shipped VM.

## Findings (M-1 witness)

- `VirtualMachine::hostFrame()` (src/vm.cpp): every frame iterates up to **64
  threads**, each an independent bytecode PC into `res->segBytecode` — the game
  data segment loaded from disk.
- `executeThread()` dispatch: opcode bytes are *behavior and arguments at once* —
  `opcode & 0x80` selects polygon draws from the cinematic database (offset packed
  in the opcode byte!), `opcode & 0x40` fills polygons with x/y coordinates
  bit-packed into the opcode. Extreme data economy: 640 KB-era budgets.
- Control opcodes: `op_jmp`, `op_jnz` (decrement-and-jump = bytecode timers),
  `op_condJmp` (condition bits packed in the opcode).
- `op_setSetVect`: one thread rebinding another's PC through
  `threadsData[REQUESTED_PC_OFFSET]`, applied between frames by
  `checkThreadRequests()` — cross-thread self-mutating dispatch (M-3's mechanism,
  present here in 1991).
- The interpreter is ~700 lines of C++ (vm.cpp 718 lines); every cutscene,
  animation, and gameplay event ships as data.

## Cards fed

- M-1 event-program-as-VM → **cataloged**
- Bridge to M-3 (timed VM): AW's `op_jnz` counters are timers; TH04's version
  compares `*std_ip` to the frame counter directly.
