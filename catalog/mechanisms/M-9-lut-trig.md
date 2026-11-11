### M-9 Precision-by-LUT: integer trig + slope tables (`lut`)

**Mechanism.** All transcendental math is replaced by fixed-size integer lookup
tables at load/compile time — trig (finetangent[4096], finesine[10240] — coarser
than 1° resolution), slope ranges, and angle→sprite-index quantization (256
directions) — so the sim uses only adds/compares, is bit-exact deterministic, and
never touches FPU (1993: no FPU guaranteed; 2026: no fp-nondeterminism).

**Witnesses.** Doom (official id source, `linuxdoom-1.10`): `tables.c` —
`finetangent[4096]` (line 67), `finesine[10240]` (line 584) covering both
`finecosine` via aliasing, `SLOPERANGE` clamping (lines 57–61); `m_fixed.c`
Q16.16 (`FRACBITS=16`) multiply/shift. TH04 (ReC98): 256-direction sprite
quantization (`ANGLE_PER_SPRITE = 0x80 / BULLET_D_CELS`), 8-bit subpixel speeds —
the same discipline at 4-bit precision.

**Evidence.** tables.c sizes and clamps (grep-verified); m_fixed.c FixedMul/
FixedDiv implementations; TH04 pool records carry `angle` as one byte and
`speed` as one byte (M-2's `bullet_t`) — all motion is table+integer.

**Generalization.** Modern: shader-friendly fixed-point, deterministic
cross-platform sims (lockstep netcode), embedded/DSP paths without FPU,
GPU-bound games offloading trig, and replay systems that must not drift.
Also the ancestor of quantized-precision ML inference.

**Costs.** Resolution is fixed at build time (angle quantization artifacts are a
real Doom visual trait); tables must be regenerated if ranges change; bit-exact
determinism pins the implementation against casual refactoring.

**Status.** single-witness (Doom deep, TH04 same-family note; a third
non-shared-engine witness would make it cataloged).
