### M-10 Fixed-pool entities with index-linked membership lists (`spatial`)

**Mechanism.** All entities live in one fixed array (slot id = array index).
Membership lists are chains of *slot indices* — either stored in-record
(next/prev fields + a discriminator saying which list the record is in:
RCT2) or in side arrays keyed by slot index (Build). An entity can be a
member of multiple lists simultaneously (a spatial list + a type list), so
iteration costs the size of the needed subset, never the whole pool — and
the free list is just another list.

**Witnesses.**
1. **RCT2** (2002): the whole game in `Entity Entities[10000]` (RCT2.h:848);
   in-record links `NextInQuadrant`/`Next`/`Previous` + `LinkedListTypeOffset`
   discriminator (RCT12.h:1012-1019); quadrant lists = spatial hash.
2. **Duke3D/Build** (1996): `headspritesect[]/nextspritesect[]/prevspritesect[]`
   index arrays (ENGINE.C:4265-4273); dual membership `insertsprite(sectnum,
   statnum)` (ENGINE.C:4290-4293); per-status lists iterated as the primary
   update order (ENGINE.C:1978-1993); free list as an index chain.

**Generalization.** ECS archetype queries, spatial hashes, render lists,
and collision layers over one preallocated entity pool: membership IS the
state (no separate alive flag needed — list membership or the free list
implies it); lists compose instead of multi-index structures; removal is
O(list) unlink.

**Costs.** Manual unlink discipline (forget to unlink = corruption — RCT2's
historical save-corruption bugs live here); index instability on swap-free
slots; in-record variant costs per-record bytes for the discriminator.

**Status.** **cataloged** — two engine-family witnesses (Build 1996, RCT2
2002). Natural transfer test: full-pool scan vs list-walk iteration at
modern scale (candidate for the next bench).
