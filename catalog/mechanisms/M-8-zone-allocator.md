### M-8 Tagged zone allocator — free-by-tag pooled memory (`zero-alloc`)

**Mechanism.** All dynamic memory comes from a single preallocated zone with
**purge tags**: blocks are allocated with a lifetime class (static / level /
purgeable) and freed *by tag* in one call — whole-level teardown is
`Z_FreeTags(PU_LEVEL, PU_PURGELEVEL)`, O(free-list), no per-object bookkeeping
by callers.

**Witnesses.** Doom (official id source, `linuxdoom-1.10`): `z_zone.h` purge tags
(`PU_STATIC=1`, `PU_LEVEL=50`, `PU_PURGELEVEL=100`), `Z_Malloc(size, tag, ptr)`,
`Z_FreeTags`, `Z_ChangeTag2`; `z_zone.c` implements it as a doubly-linked block
list with per-block `tag` + `user` pointer. TH01–TH05 use master.lib's
equivalent `hmem_*` EMS/XMS pools (ReC98 cross-ref).

**Evidence.** z_zone.h:34–62 (tag defines + API); the level-exit path frees every
`PU_LEVEL` block in one sweep — the mechanism that lets Doom's footprint stay
bounded (~2 MB conventional+EMS) across infinite level loads.

**Generalization.** This is the ancestor of today's generational arenas, ECS
chunk allocators, and per-request memory pools in servers: group allocations by
lifetime class, free the class, never track individual objects. Directly
applicable to per-request/per-session server arenas and frame allocators
(e.g., "scratch: static until frame end").

**Costs.** Tag discipline is manual (a stray tag leaks or corrupts); no
per-object free patterns (fine for level-lifetime data, wrong for
long-lived-mixed workloads); fragmentation within a tag class is the
programmer's problem.

**Status.** single-witness (Doom + TH0x master.lib family noted; fresh
decompile of TH04's `hmem_*` layer would make it cataloged).
