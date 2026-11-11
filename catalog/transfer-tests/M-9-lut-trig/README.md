# Transfer test — M-9 LUT trig: table lookup + fixed-point vs transcendental call

**Claim tested.** Doom ships a 4096-entry Q15 sine table queried by 16-bit binary
angles (`tables.c`); Duke3D ships its tables as a data file (`tables.dat`).
Two properties transfer to modern stacks — and one is load-bearing.

## Results (Node 22, multiple runs)

| Property | Float path (`Math.sin`) | LUT Q15 path |
|---|---|---|
| Throughput (20M calls) | 30–56M calls/s | 254–547M calls/s — **8.6–9.7×** |
| Max error (4096 entries, floor-mapped) | exact | **1.45e-3 (~0.086°)** — at the quantization bound |
| Float ops per update (8.2M-update sim) | ~4 (sin, mul, add, convert) | **0** (imul/add/and/shift, all exact) |
| State under 1-ulp perturbation | **DIVERGES** (replay breaks) | perturbation class is **empty** |

## Verdict

**Proven** — with the honest decomposition:

1. **Throughput is real but secondary**: 8.6–9.7× at volume; V8's `Math.sin` is
   already fast, so the win matters at bullet/particle scale (millions of
   trig calls per frame-second), exactly TH04/Doom's regime.
2. **Determinism is load-bearing**: the float path carries ~4 float ops per
   update — each an ulp surface that can differ across engines/hardware and
   break replay (demonstrated: 1-ulp perturbation → state hashes diverge).
   The LUT+fixed-point path carries **zero float ops** — there is no
   perturbation surface to exist. This is why Doom demos replay and why
   Duke3D *ships its table as a data file* (`tables.dat`): generator behavior
   becomes irrelevant, cross-platform replay is exact by construction.
3. **Cost recorded**: 0.086° angular quantization (fine for games; the card's
   costs field). Interpolation would halve the error at throughput cost.

## Methodology note (test bugs caught en route)

Two earlier versions of the determinism check were wrong and were rewritten:
(a) injecting `d+1` into the *integer* path is a real input change, not noise
(integers have no smaller step — the state correctly changed); (b) a scaling
constant of 33/32768 made the sim accidentally insensitive to ±1 table deltas
(rounding boundaries ~never crossed). The final check perturbs the *float*
path's actual float ops and counts float ops in both paths — the property is
structural (no float ops → no ulp surface), not statistical.

Reproduce: `node bench.mjs`
