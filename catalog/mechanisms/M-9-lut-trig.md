### M-9 Precision-by-LUT: integer trig + slope tables (`lut`)

**Mechanism.** All transcendental math is replaced by fixed-size integer lookup
tables at load/compile time — trig (finetangent[4096], finesine[10240] — coarser
than 1° resolution), slope ranges, and angle→sprite-index quantization (256
directions) — so the sim uses only adds/compares, is bit-exact deterministic, and
never touches FPU (1993: no FPU guaranteed; 2026: no fp-nondeterminism).

**Witnesses.**
1. **Doom** (id, 1993, official source): `tables.c` — `finetangent[4096]`,
   `finesine[10240]` (finecosine via aliasing), `SLOPERANGE` clamps;
   `m_fixed.c` Q16.16.
2. **Duke Nukem 3D / Build** (Silverman, 1996, released source): `sintable[2048]`,
   `radarang[640]`, `reciptable[2048]` — and the twist: the LUTs **ship as data**
   (`kopen4load("tables.dat")` + `kread`, ENGINE.C:2013), not compiled in —
   tables are patchable assets.
3. TH04 (ReC98): 256-direction sprite quantization, 8-bit subpixel speeds —
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

**Status.** **proven** — transfer test `catalog/transfer-tests/M-9-lut-trig/`:
8.6–11.9× throughput at volume (11.3–11.9× on the 2026-11-13 host); the load-bearing property is structural
determinism (zero float ops in the fixed-point path → no ulp surface →
cross-platform replay exact, the `tables.dat` discipline). Cost recorded:
0.086° quantization.
