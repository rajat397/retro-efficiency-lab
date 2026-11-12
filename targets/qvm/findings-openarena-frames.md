# Finding: real OpenArena frame loop through a stub engine (measured)

**Depth class:** `measured` — the real OpenArena Experience B52 cgame module
(`oa-cgame.qvm`, 125,622 instructions) driven by the unmodified ioquake3
interpreter and JIT through a purpose-built syscall layer
(`targets/qvm/oa-syscalls.c`), running `CG_INIT` once and
`CG_DRAW_ACTIVE_FRAME` repeatedly.

**Continues `findings-openarena.md`** (static decode + INIT cost). This file
adds the piece the earlier run marked unknown: a working syscall layer, so
the actual frame loop executes.

## F1. What it took to run real gamecode

The syscall layer implements the traps cgame INIT + frames actually call
(positive enum ids; the VM's `OP_CALL` trap writes `parms[0] = -1 - r0` where
the game pushes `r0 = -(id+1)`). Brought up by iterating: run → observe the
exact failure (trap_Error message, SIGSEGV under gdb) → implement that trap
properly. Failures fixed en route, each a real ABI fact:

1. **Ids are positive enum values** (`CG_MEMSET = 100`), not the negative
   `.asm`-style ids — the raw game-side push is `-(id+1)` and the VM adds 1.
2. `args[k] = (int)parms[k]` — parms are 8-byte; an int-pointer alias
   (`const int *a = (int *)&parms[1]`) gives `a[k] ≠ args[k]` and turned
   `FS_READ` sizes into pointer values (crash).
3. **VM addresses wrap past `dataMask`** — a stack string buffer sat 211
   bytes before the image end; big writes via raw host pointers overran.
   All large writes/`MEMSET`/`MEMCPY` now go through per-byte masked
   ("wrapping") copies.
4. `Q_strncpyz(dst, src, 0)` becomes `strncpy(dst, src, SIZE_MAX)` — a game
   cvar registered with a NULL vmCvar pointer crashes a naive stub.
5. `CG_FileExists` is implemented via `FS_FOPENFILE` returning a length —
   the stub must answer "file exists" (len 1) for model/skin paths or the
   default model chain fails.
6. cgame INIT requires a real `gameState`: configstrings
   `CS_GAME_VERSION` (=20, value "baseoa-1"), `CS_SERVERINFO` info-string
   (`\mapname\…\g_gametype\…`), `CS_LEVEL_START_TIME`; plus a canned
   `animation.cfg` (47 × `0 1 0 10`) so `CG_ParseAnimationFile` succeeds.

## F2. Real frame loop, controlled A/B

60 `CG_DRAW_ACTIVE_FRAME(client 0, 16 ms)` calls after one `CG_INIT`:

| | interpreter | JIT (vm_x86) | ratio |
|---|---|---|---|
| CG_INIT (once) | 284.9M cycles | 61.1M cycles | 4.7× |
| **per frame** | **3.30–3.35M avg** | **0.59–0.86M avg** | **≈4.3×** |
| syscalls | **79,416 total, 0 unknown** | **79,416 total, 0 unknown** | identical |

- The syscall counts are byte-identical across runs and across engine modes
  (verified on repeated runs, both modes) — the stub layer is deterministic,
  so this is a true controlled comparison.
- The real-frame ratio **≈4.3× is much lower than the synthetic 10–19×** —
  each frame makes **1,289 syscall traps** (measured: 1 frame = 3,365
  syscalls total after INIT's 2,076), and trap cost is mode-independent
  (~16 cycles, measured earlier). Trap overhead dilutes the interpretation
  ratio on real workloads that live at the C boundary.
- Per-frame syscall mix (dominant): `R_DRAWSTRETCHPIC` ≈550/frame (HUD),
  `CVAR_UPDATE` ≈80/frame, `STRNCPY`/`MEMCPY` string traffic, ~10
  `R_RENDERSCENE`, `UPDATESCREEN` 1/frame.

## F3. Load costs on real gamecode (updated)

| module | PrepareInterpreter | VM_Compile (JIT) | JIT'd size |
|---|---|---|---|
| cgame | 34.4M cycles | 81.3M cycles | 1,096,536 B |

Unchanged from `findings-openarena.md`; the working syscall layer does not
change load costs.

## F4. Honest scope

- The stub engine answers 79,416 traps with plausible-but-fake values
  (no real renderer/sound); game logic runs but sees an empty world
  (snapshot count 0). Frame cost therefore measures **game-logic dispatch +
  HUD render dispatch**, not a full visual frame.
- Frame workloads accumulate game state across frames (timers, HUD
  animation); 60-frame runs stay in a stable regime (avg/min/max stable
  across repeated runs).
- Only cgame was driven end-to-end; qagame/ui still die under the stubs
  (qagame needs real entity/shared-trap behavior).
- Absolute cycles are host-specific; ratios and the identical-syscall-count
  control are the transferable artifacts.

## Repro

```sh
sh targets/qvm/build.sh
cd targets/qvm
./oa-bench-interp   oa-cgame 60 oa   # INIT + 60 frames, interpreter
./oa-bench-compiled oa-cgame 60 oa   # same workload on the JIT
# stderr prints the full trap histogram (oa-syscalls: total=79416 unknown=0)
```

Source of the gamecode: `findings-openarena.md` (oaxB52 release zip,
GPL, copies at `targets/qvm/vm/oa-*.qvm`). Trap semantics verified against
the engine reference (`/mnt/data/opt/ioq3/code/client/cl_cgame.c`).
