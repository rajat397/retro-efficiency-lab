### M-8 Tagged zone allocator — free-by-tag pooled memory (`zero-alloc`)

**Mechanism.** All dynamic memory comes from a single preallocated zone with
**purge tags**: blocks are allocated with a lifetime class (static / level /
purgeable) and freed *by tag* in one call — whole-level teardown is
`Z_FreeTags(PU_LEVEL, PU_PURGELEVEL)`, O(free-list), no per-object bookkeeping
by callers.

**Witnesses.**
1. **Doom** (id, 1993, official source): purge tags (`PU_STATIC/PU_LEVEL/
   PU_PURGELEVEL`), `Z_Malloc(size, tag)`, `Z_FreeTags` — free by class.
2. **Duke Nukem 3D / Build engine** (Ken Silverman, 1996, released source
   `CACHE1D.C`): one big preallocated buffer + `allocache(handle, size, lockptr)`
   with a per-allocation **lock byte**; `uninitcache(0)` evicts all *unlocked*
   items, keeping locked ones — free/evict by class, with linear-compaction
   eviction (MAXCACHEOBJECTS 9216). Also TH0x master.lib `hmem_*` EMS pools
   (ReC98 cross-ref).

**Evidence.** z_zone.h:34–62 (tag defines + API); the level-exit path frees every
`PU_LEVEL` block in one sweep — the mechanism that lets Doom's footprint stay
bounded (~2 MB conventional+EMS) across infinite level loads.

**Generalization.** Ancestor of generational arenas, ECS chunk allocators, and
per-request server pools: group allocations by lifetime class, free the class,
never track individual objects. The Doom↔Duke diff is the design space: **tags
free by class** (Doom: deterministic teardown at level exit) vs **locks evict by
class** (Duke: cache-like reuse under memory pressure — the same idea Redis/CDNs
use as pin/unpin).

**Costs.** Tag discipline is manual (a stray tag leaks or corrupts); no
per-object free patterns (fine for level-lifetime data, wrong for
long-lived-mixed workloads); fragmentation within a tag class is the
programmer's problem.

**Status.** **proven** — transfer test `catalog/transfer-tests/M-8-zone-allocator/`:
4.1× fewer GC pauses, 75% less GC time, 20% faster wall on identical
transient-object workloads. Scope honesty: structural records are the
transferable part in GC'd languages; content strings still allocate.
