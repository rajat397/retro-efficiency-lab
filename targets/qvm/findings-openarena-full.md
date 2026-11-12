# Finding: full trap layer — real entities, real renderer front-end (measured)

**Depth class:** `measured` — extends `findings-openarena-frames.md` with a
loaded scene: a real snapshot stream (16 entities/snapshot consumed by
`CG_ProcessSnapshots`) and a renderer front-end state machine
(`AddRefEntity` copies entities into the scene list; `RenderScene` culls and
depth-sorts, engine-style). ~28 refEntities reach the scene per frame.

**Frame workload (60 `CG_DRAW_ACTIVE_FRAME(client 0, 16 ms)` after `CG_INIT`):**

| | interpreter | JIT (vm_x86) | ratio |
|---|---|---|---|
| per frame (5 runs each) | 1.65–2.44M avg (median 1.67M) | 0.59–0.87M avg (median 0.82M) | **≈2.0–2.7×** |
| per frame mins | 1.32–1.72M | 0.487–0.542M | ~2.7× |
| CG_INIT (once) | 391.6M | 85.3M | **4.6×** |

## F1. The boundary compresses the ratio further (4.3× → ~2×)

The empty-HUD layer measured 4.3×; the full layer measures **≈2.0–2.7×**.
Two causes, both measured:

1. **The empty layer's frames were inflated**: with `GetSnapshot` returning
   qfalse, `CG_ProcessSnapshots` re-attempted missing snapshots every frame
   (628 → 1,289 syscalls/frame). The full layer's per-frame syscall count
   (628) is the honest one.
2. **Native work grows, VM work shrinks**: each frame now pays 28
   entity copies + a 28-element depth sort + culling in the (mode-independent)
   syscall layer, while the VM-side per-frame dispatch mix is smaller than
   the retry-inflated empty frames. As native boundary work approaches the
   VM work, the interpreter/JIT ratio approaches 1.

Generalization for the DECISION doc: the interpreter/JIT ratio of a real
frame is bounded by the *native:dispatch work ratio* of the workload.
Games sit closer to the boundary than pure compute, so id Tech 3's JIT pays
~2× per frame, not 10×.

## F2. The interpreter and the JIT are NOT bit-equivalent — FP divergence measured

Syscall totals differ between modes: **37,650 (interp) vs 37,762 (JIT)**,
Δ112, entirely **trap 104 (`sin`)** — the game makes 112 extra sin calls on
the JIT. The syscall layer is deterministic (identical counts across
repeated runs of the same mode), so the divergence is in the *game's float
math*:

- The interpreter executes float ops as C floats (x86-64 → **SSE**, 32-bit
  rounding at every op).
- `vm_x86.c` emits **x87** code for `OP_ADDF`/`OP_MULF`/`OP_CVFI`
  (`fld`/`fadd`/`fmul`/`fistp` at vm_x86.c:1561–1597) — 80-bit intermediates.

Different rounding → a different branch outcome somewhere in the frame path
→ 112 extra sin iterations on the JIT side (0.3% syscall drift, 0
unknown traps). id Tech 3 ships both modes for the same game — the engine is
rounding-tolerant by construction, but *deterministic lockstep replay
against the JIT is unsound at FP granularity*. For the lab: the syscall A/B
control holds per-mode, and the ratio is unaffected by a 0.3% drift.

## F3. What a frame is now

Per frame (measured): 628 syscalls; 16 `entityState_t` processed from the
snapshot; 28 `refEntity_t` copied into the scene; 28 entities culled +
depth-sorted in `RenderScene`; ~550 `R_DRAWSTRETCHPIC` HUD quads; ~80
`CVAR_UPDATE`; scene totals over 60 frames: 1,680 entities, 1,680 draws,
0 lights, 0 polys (no beams/effects in this scene).

## F4. Honest scope

- The renderer front-end is emulated in the stub (copy + cull + sort +
  checksum work), not the real GL back-end; GPU cost is out of scope by
  design — the A/B measures the VM, whose work is complete.
- 16-entity skirmish scene; a 64-player scene would scale the entity-list
  work (mode-independent) and dilute the ratio further.
- Only cgame; qagame/ui remain out (entity/gameplay traps).

## Repro

```sh
sh targets/qvm/build.sh
cd targets/qvm
./oa-bench-interp   oa-cgame 60 oa   # interpreter: median 1.67M cycles/frame
./oa-bench-compiled oa-cgame 60 oa   # JIT: median 0.82M cycles/frame
# stderr: oa-syscalls: total=… sceneEnts=1680 draws=1680 work=0.2
```
