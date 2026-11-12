# Finding: QVM dispatch floor, JIT ratio, and syscall trap cost (measured)

**Depth class:** `measured` — every number below was produced by running the real
ioquake3 interpreter/JIT against toolchain-assembled `.qvm` programs on this machine.
Nothing is restated from docs.

**Date:** 2026-11-13 · **ioq3 HEAD:** `52088b9eae247d8e321c8dc1fb49a879652854f9`
(`/mnt/data/opt/ioq3`, shallow clone) · **lab HEAD at measurement:** `5495248` + uncommitted work

## Method

1. **Real engine, not a rewrite:** `qcommon/vm.c`, `vm_interpreted.c`, `vm_x86.c` compiled
   unmodified into a standalone harness (`qvm-bench.c` + `bench-glue.c` stubs for
   `FS_*`/`Com_*`/`Cvar_*`/`Hunk_*`). The interpreter and JIT are byte-identical to
   upstream; only the environment is stubbed.
2. **Toolchain-produced bytecode:** programs written in q3asm assembly, assembled with
   ioquake3's own `q3asm` (`code/tools/asm/q3asm.c`) — not hand-rolled bytes.
3. **Programs** (100k inner-loop iterations per `VM_Call`, 100 warmup + 200 timed calls,
   rdtsc around each call):
   - `loop.qvm` — counter loop, **10 QVM instructions/iteration**
   - `mul.qvm` — control + 6-instruction `MULI4` body = **16 instr/iter**
   - `syscall.qvm` — control + 3-instruction syscall arm (`CONST -1; CALL; POP`) = **13 instr/iter**
4. Two harness builds: interpreter (`VMI_BYTECODE`) and JIT (`VMI_COMPILED` → `vm_x86.c`).

## Findings

### F1. QVM interpreted dispatch floor ≈ 7.2 cycles/instruction (min 6.1)

| program | interpreter avg | interpreter min | JIT avg | JIT min | speedup avg/min |
|---|---|---|---|---|---|
| loop (1.0M instr/call) | 7,234,524 | 6,084,468 | 703,207 | 520,104 | **10.3× / 11.7×** |
| mul (1.6M instr/call) | 19,418,538 | 16,341,468 | 1,047,525 | 842,088 | **18.5× / 19.4×** |
| syscall (1.3M instr/call) | 12,834,315 | 10,527,166 | 5,505,771 | 3,935,360 | **2.3× / 2.7×** |

(cycles per VM_Call; 100k inner iterations)

Per-instruction: interpreter loop = **7.23 avg / 6.08 min cycles**; JIT loop =
**0.70 avg / 0.52 min** — the JIT emits ~real machine-code quality (sub-cycle-per-op
is amortized dispatch).

### F2. Cross-engine: QVM interpreter is ~6× cheaper per dispatch than SQLite VDBE

Same machine, same methodology as the VDBE measurement (`5495248`):
- SQLite VDBE `Noop` floor ≈ **45 cycles/op**
- ioquake3 QVM interpreted loop ≈ **7.2 cycles/instruction**

The QVM interpreter caches the top-of-stack in `r0`/`r1` registers across ops
(`vm_interpreted.c` dispatch head) instead of re-reading the stack from memory each
op like VDBE. Same "giant switch on bytecode" architecture, 6× different floor —
the dispatch register discipline is the difference, not the language or the switch.

### F3. Interpreter tax on compute code: 10–19× — matching M-1's transfer test

M-1's transfer test measured a JS interpreter tax of ~10–22× per op.
ioquake3's own interpreter/JIT ratio measured here: **10.3× (loop) to 18.5× (mul)**.
Two independent engines, same ratio band. The interpret-vs-compile decision's
default (compile hot loops) is now corroborated by the exact engine family that
shipped interpreted bytecode at scale.

### F4. Syscall trap overhead ≈ 15–19 cycles — negligible, and JIT-proof

Marginal cost of the 3-instruction syscall arm vs the control loop:
- interpreter: (12.83M − 7.23M)/100k/3 = **18.7 cycles** per arm (min-based 14.8)
- JIT: (5.51M − 0.70M)/100k/3 = **16.0 cycles** per arm

The trap (`OP_CALL` with negative PC → `vm->systemCall` C callback → PC restore)
costs about the same interpreted or JIT'd — it is a C-call boundary, not bytecode.
The JIT cannot optimize it away; Q3's VM boundary design (all engine access via
syscall trap) costs ~16 cycles per boundary crossing on 2026 hardware.

### F5. qasm store discipline (proved by a real bug en route)

`OP_STORE4` semantics: `*(stack[top-1]) = stack[top]` — the **address must be
pushed before the value**. The first program version pushed the address after the
computed value (`SUBI4` result at top-1, address at top): the store wrote the
address into `image[value&mask]` and the loop counter never changed (verified with
an instrumented interpreter copy: `NE r1=3 r0=0` forever). Correct lcc-style
discipline: `ADDRL <n>; <value computation>; ASGNI4`, with a fresh `ADDRL; INDIRI4`
pair for the loop test. Also: q3asm reserves 64K of bss for the program stack
(`_stackStart`/`_stackEnd`, q3asm.c:1473), the loader rounds dataLength up to a
power of 2 (vm.c:445–450), and `ADDRL v` = `8 + currentArgs + v` — local N at
local-offset N*4, never past the `ENTER` frame.

## Repro

```sh
sh targets/qvm/build.sh
cd targets/qvm
./qvm-bench-interp  loop    200 1000000   # interpreter floor
./qvm-bench-compiled loop    200 1000000   # JIT comparison
./qvm-bench-interp  mul     200 1600000
./qvm-bench-interp  syscall 200 1300000   # prints syscalls=30000000 as a sanity check
```

## Unknowns / caveats

- **Timing variance is large** (max up to 5× min — frequency scaling/turbo). Load-bearing
  numbers are the mins and the ratios; absolute cycle counts are host-specific.
- The syscall stub is trivial (counter + `return 42`); the measured ~16 cycles is the
  trap overhead only, not any real syscall body.
- Only integer/branch/loop code measured; float and `BLOCK_COPY` paths unmeasured.
- The `.qvm` files carry `VM_MAGIC_VER2` (ioquake3 extension); original Q3 1.32b would
  need `-vq3`.
