# Finding: OpenArena real gamecode through the real engine (measured)

**Depth class:** `measured` — real OpenArena Experience B52 bytecode
(`vm/cgame.qvm`, `vm/qagame.qvm`, `vm/ui.qvm`, VER1 format, built 2016-08-15
by the official q3asm toolchain) loaded and executed by the unmodified
ioquake3 interpreter and JIT.

**Source:** `https://github.com/OpenArena/gamecode/releases/download/oaxB52/oaxB52.zip`
(481,804 B, extracted from `oax.pk3`) → copies at `targets/qvm/vm/oa-*.qvm`.

## F1. Static decode: real game bytecode structure

`decode-qvm.mjs` walks the code segment with the engine's own instruction-size
table and reconciles against the header:

| module | file | instructions | code seg | data+lit+bss (loader rounds) | distinct ops |
|---|---|---|---|---|---|
| cgame | 421,392 B | 125,622 | 374,420 B | 4,025,992 → 4 MiB | 56/61 |
| qagame | 770,844 B | 231,054 | 694,216 B | 1,624,388 → 2 MiB | 56/61 |
| ui | 365,304 B | 101,138 | 311,300 B | 641,300 → 1 MiB | 57/61 |

All three walks reconcile **exactly** with `instructionCount` after trimming
the trailing 4-byte alignment pad q3asm appends (0/1/3 bytes).

**Opcode mix is stack-machine-shaped and remarkably stable across modules**
(cgame/qagame): `LOCAL` ~21%, `CONST` ~21%, `LOAD4` ~19%, `STORE4` ~8%,
`ARG` ~6-7%, `ADD` ~6%, `CALL` ~3%, `POP` ~2%, `JUMP` ~2%. 80% of a real
game VM's dispatches are stack traffic (LOCAL/CONST/LOAD/STORE/ARG/POP).

**Format facts pinned by real files (VER1):**
- Header is 9 ints; this build used `VM_MAGIC` (VER1), not VER2.
- `JUMP` has NO operand (target from the stack); `ARG` has a 1-byte operand;
  21 ops carry 4-byte operands — exactly the `VM_PrepareInterpreter` switch.
- Code segment ends with `PUSH; LEAVE <frame>` and is padded to a 4-byte
  boundary with 0x00 (up to 3 bytes); `LEAVE 0` (`04 00 00 00 00`) is a real
  instruction, distinguishable from pad because a real instruction is never
  all-zero.
- Initial opcode walk (hardcoded from memory) mis-numbered the enum past 37
  (`BLOCK_COPY` is 34, not 40; 40 is `DIVI`) — caught by count mismatches,
  fixed against `vm_local.h`. cgame matched exactly on the first corrected run.

## F2. Loading real gamecode: interpreter prep vs JIT compile

| module | VM_PrepareInterpreter | VM_Compile (JIT) | JIT'd code size |
|---|---|---|---|
| cgame | 34.4M cycles | 81.3M cycles | 1,096,536 B |
| qagame | 17.0M cycles | (n/a — INIT errored, see F4) | — |
| ui | (not run) | 45.8M cycles | 800,541 B |

- JIT compilation costs **2.4× more** than interpreter preparation, but it is a
  one-time load cost.
- Memory twist: the interpreter's word-expanded `codeBase` is
  `4 × codeLength` = **1,497,680 B** for cgame — *larger* than the JIT'd
  machine code (1,096,536 B). The QVM interpreter buys its dispatch speed with
  a 4×-expanded instruction image; the JIT emits tighter code than the
  interpreter's "prepared" form.

## F3. Real workload A/B: CG_INIT interpreted vs JIT'd — 10.3×

Same binary (`oa-cgame.qvm`), same call (`vmMain(0)`), same stub syscall
environment, **identical syscall count (74,184) on both sides**:

| | interpreter | JIT | speedup |
|---|---|---|---|
| CG_INIT | 5,761,210 cycles | 560,534 cycles | **10.3×** |

74,184 syscall traps in one init call — the Q3 syscall-boundary design means
real gamecode crosses the C boundary constantly; at ~16 cycles per trap
(measured on the synthetic loop) that is ~1.2M cycles of pure trap overhead,
~21% of the interpreted init and ~... (trap share is mode-independent).

The 10.3× real-code ratio lands inside the synthetic band (10.3–18.5×) and
the M-1 transfer-test band (10–22×): **three independent measurements, same
story.**

## F4. Honest failures

- `oa-qagame` INIT died under the stub engine: `VM program counter out of
  range in OP_JUMP` — a syscall stub returning 42 for pointer-returning traps
  (e.g. `trap_Cvar_*`) breaks qagame's init path. cgame and ui tolerated the
  stubs. Fixing this means implementing real engine syscall bodies — out of
  scope for the floor measurement.
- `oa-ui` `vmMain(0)` returned in 260 cycles with 0 syscalls — OAX's ui entry
  short-circuits under the stub environment; not a floor measurement.
- The interpreter/JIT numbers for real code are ONE call each (INIT is
  stateful); the load-cost table and the 10.3× INIT comparison are the
  load-bearing numbers, the repeated-call noise band does not apply.

## Repro

```sh
# fetch (481 KB): curl -L -o oaxB52.zip \
#   https://github.com/OpenArena/gamecode/releases/download/oaxB52/oaxB52.zip
# unzip → oaxB52/oax.pk3 → vm/{cgame,qagame,ui}.qvm → cp into targets/qvm/vm/ as oa-*.qvm
sh targets/qvm/build.sh
cd targets/qvm
node decode-qvm.mjs vm/oa-cgame.qvm vm/oa-qagame.qvm vm/oa-ui.qvm
./qvm-bench-interp  oa-cgame 1   # prep cost + interpreted CG_INIT (74,184 syscalls)
./qvm-bench-compiled oa-cgame 1  # JIT compile cost + JIT'd CG_INIT (74,184 syscalls)
```

## Unknowns

- No real syscall bodies → per-frame game loop cost (vmMain frames 2+)
  unmeasured; would need a partial engine syscall layer.
- Absolute cycles are host-specific; ratios and the syscall-count equality
  are the transferable artifacts.
