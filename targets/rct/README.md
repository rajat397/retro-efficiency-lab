# Target 5 — RollerCoaster Tycoon 2 (Chris Sawyer, 2002)

Status: **in progress** (initial findings 2026-11-12)

## Target

The peep economy: thousands of pathfinding guests with individual thoughts,
spend logic, and park-rating feedback, running at 60 fps on 2002 PCs.

## Authority note

Analysis-only: the commercial binary is not analyzed. This target uses
**OpenRCT2** (GPL reimplementation built from RE of the original — the
"informed reconstruction" authority class, same as ReC98 for Touhou), cloned
to `/mnt/data/opt/openrct2`. Where a fact matters, it is anchored to the
original save format's struct layout preserved by OpenRCT2 with original
addresses (`RCT2.h`, `RCT12.h` — original memory addresses in comments).
Binary anchoring remains future work.

## Findings so far

### 1. Third M-2 witness: one fixed entity pool for the entire game

`Entity Entities[Limits::kMaxEntitiesRCTCExtended]` (RCT2.h:848) — peeps,
staff, vehicles, litter, balloons, ducks: **everything** lives in ONE fixed
array of 10,000 slots (15,000 in Classic extended saves, RCT2/Limits.h:22-23).
Free slots form a chain; the save format (`S6`) stores the whole state as a
fixed-size struct (`TileElements[kMaxTileElements]`, `Entities[...]`) — saving
is a snapshot copy, not serialization of a graph.

### 2. NEW mechanism candidate M-10: index-linked membership lists

Each entity record carries its own list links (RCT12.h:1012-1019):
`NextInQuadrant` (0x02), `Next` (0x04), `Previous` (0x06), and
`LinkedListTypeOffset` (0x08) — a discriminator for WHICH list the record is
currently linked into. One entity can be a member of multiple lists
simultaneously (quadrant spatial hash + per-type list). Iteration walks only
the needed list, never the whole pool.

Second witness from a different engine family and decade: Duke3D/Build
(ENGINE.C:4265-4273, 1945, 4290-4320) — `headspritesect[]/nextspritesect[]/
prevspritesect[]` index-keyed link arrays; even the FREE list is an index
chain (`prevspritesect[i] = i-1; nextspritesect[i] = i+1`); an entity joins
exactly two lists at once via `insertsprite(sectnum, statnum)`.

### 3. Economy surface (to probe next)

- `GuestCountChangeModifier` + `GuestsInPark`/`GuestsHeadingForPark` (RCT2.h
  SC6[7]) — spawn-rate feedback: the peep population is a measured, modulated
  variable, not free-running.
- `RCT12PeepThought Thoughts[kMaxPeepThoughts]` (RCT2.h:653) — bounded
  thought slots per peep (the peep AI itself is a fixed-capacity buffer).
- `PeepSpawns[kMaxPeepSpawns = 256]` — spawn points are a fixed pool too.

## Probe outcomes (2026-11-12, subagent-dispatched, evidence-gated)

- `findings-T5A.md` — guest-generation law: two-timescale feedback
  (512-tick recompute), throttled draws vs soft ceiling, bounded spawn
  pools. M-5 third-witness face recorded.
- `findings-T5B.md` — pathfinding: bounded DFS (15k tiles / 200 steps /
  5-8 junction depth), inline per-peep path memory. M-10 verdict honest
  "none found"; spawned NEW card M-11 (work budgets, with Duke3D's
  clipmoveboxtracenum=3 as second witness).

### Probe outcomes, round 2 (2026-11-12, subagent-dispatched, evidence-gated)

- `findings-T5C.md` — ride value = pure function of ratings with age-decay
  table + duplicate-penalty (`RideRatings.cpp:1111-1171`); willingness-to-pay
  = price vs 2× ride value with ÷4 entry-paid adjustment and 50% good-value
  band (`Guest.cpp:2110-2148`); 10-slot customer history on a 960-tick shift
  (`Ride.cpp:826-830`). Mechanism: M-2 fixed pools strong match.
- `findings-T5D.md` — park rating = `CalculateParkRating` (`world/Park.cpp:376`,
  clamped 0-999 at :488), recomputed every 512 ticks in the SAME block as the
  guest-probability recompute (`Park.cpp:334-340`) — the loop is CLOSED on one
  two-timescale clock: guests → ride value → rating → spawn probability →
  guests. Negative leg: guests degrade tidiness/happiness. Honest note:
  vandalism is not a direct rating term in this port (award predicates only).

## Next probes

1. Guest generation law: find the spawn-rate/park-rating control loop in
   OpenRCT2 (`Park::guestGenerationProbability` region) and map it to the
   original formula (openrct2 has RE'd formulas with original constants).
2. Peep pathfinding: the original's 256x256 word pathfinding — verify the
   claimed approach (openrct2 `Peep`::`PathfindGoal`) and its cost budget.
3. Promote M-10 via transfer test (membership lists vs full-pool iteration
   under high entity counts).
