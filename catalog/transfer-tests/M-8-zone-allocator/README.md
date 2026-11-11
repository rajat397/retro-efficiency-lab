# Transfer test — M-8 zone allocator: purge-tag pool vs per-object allocation

**Claim tested.** Doom's `z_zone` allocates transient per-tic objects from one
zone with purge tags — reclamation is a tag sweep, not per-object free — and
Duke3D's `CACHE1D.C` does the same for cached assets. Modern transfer: a
reusable record pool with per-cycle purge for per-frame/per-request transient
objects vs fresh object literals (the contemporary default).

## Results (Node 22, PerformanceObserver GC accounting, 60 cycles × 1200 docs × 400 tokens)

| | naive (literals) | zone (pool + purge) |
|---|---|---|
| Wall time | 1610 ms | **1290 ms** (−20%) |
| GC pauses | 189 | **46** (**4.1× fewer**) |
| GC total time | 87.4 ms | **22.1 ms** (−75%) |

## Verdict

**Proven.** The pool+purge discipline eliminates the majority of reclamation
churn for transient record-shaped objects: 4.1× fewer GC pauses and 75% less
GC time on an identical workload — plus 20% wall time.

**Scope honesty (recorded):** the remaining 46 GC pauses in the zone phase come
from *content* allocation — the token strings themselves (`slice()`), which JS
requires. The mechanism pools the **structural state** (records, indices,
flags); content strings remain per-op. This is the same honest boundary the
M-2 test documented: in GC'd languages, the transferable part of the zone
allocator is the record lifecycle, not the bytes.

## Carry to the catalog

M-8 status → **proven**. Generalization: any per-frame/per-request burst of
short-lived records — parsers, per-tick aggregates, render lists — belongs in
a preallocated pool with a bulk purge at the cycle boundary, exactly Doom's
purge-tag sweep.

Reproduce: `node bench.mjs`
