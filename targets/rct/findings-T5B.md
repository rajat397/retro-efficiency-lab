> **Depth class**: restated + informed-reconstruction (regraded 2026-11-12 per methodology depth bar — upgrade path in file)

# T5B Findings: RCT2 Peep Pathfinding in OpenRCT2

Target: OpenRCT2 (GPL reimplementation of RollerCoaster Tycoon 2), source tree
`/mnt/data/opt/openrct2` (read-only). Authority class: informed reconstruction —
OpenRCT2 annotates nearly every pathfinding function with its original RCT2
address (`rct2: 0x...`) and preserves original formulas/constants.

## 1. The Algorithm

OpenRCT2 implements RCT2's original **single-peep, bounded depth-first search**
over the path graph — explicitly *not* A*. The header comment at
`src/openrct2/peep/GuestPathfinding.cpp:658` states:

> "The implementation is a depth first search of the path layout in xyz
> according to the search limits. Unlike an A* search, which tracks for each
> tile a heuristic score ... a single best result "so far" (best heuristic
> score with least cost) is tracked via the score parameter. With this
> approach, explicit loop detection is necessary to limit the search space."

### Call chain (per peep, per decision tick)

1. `Peep::Update()` — when the peep reaches its current destination and needs a
   new tile, the walking state calls the dispatcher
   `src/openrct2/entity/Peep.cpp:2273`:
   `result = PathFinding::CalculateNextDestination(*guest);`
   (staff instead call `staff->doPathFinding()`, which calls
   `PathFinding::ChooseDirection` at `src/openrct2/entity/Staff.cpp:731`).
2. `PathFinding::CalculateNextDestination(Guest&)`
   (`src/openrct2/peep/GuestPathfinding.cpp:1875`, `rct2: 0x00694C35`) — cheap
   local edge triage *before* any search:
   - dead end → check lost/cant-find-ride (`GuestPathfinding.cpp:1924-1929`);
   - single remaining edge → just move, no search (`GuestPathfinding.cpp:1938-1944`);
   - food/non-aimless heuristics cull "useless" directions
     (`GuestPathfinding.cpp:1972-1996`);
   - aimless guests take random edges via `GuestPathfindAimless`
     (`GuestPathfinding.cpp:531`).
   Only when several viable edges remain does it call the goal search.
3. `PathFinding::ChooseDirection(loc, goal, peep, ...)`
   (`src/openrct2/peep/GuestPathfinding.cpp:1224`, `rct2: 0x0069A5F0`) — the
   selector: it checks/restores the per-peep pathfind history
   (`GuestPathfinding.cpp:1296-1348`), stores a new goal and clears history on
   goal change (`GuestPathfinding.cpp:1353-1364`), then runs the DFS per edge
   and picks the lowest-scoring edge
   (`GuestPathfinding.cpp:1455-1492`).
4. `PeepPathfindHeuristicSearch(...)`
   (`src/openrct2/peep/GuestPathfinding.cpp:714`, `rct2: 0x0069A997`) — the
   bounded recursive DFS itself. Goal check is a Manhattan-style distance score
   of zero, not an equality test on the tile:
   ```cpp
   uint16_t newScore = CalculateHeuristicPathingScore(loc, goal);   // :906
   if (newScore == 0) { ...update best result...; continue; }        // :909
   ```
   Score formula (`GuestPathfinding.cpp:624-635`), preserved from RCT2:
   ```cpp
   auto xDelta = abs(loc1.x - loc2.x) * 32;
   auto yDelta = abs(loc1.y - loc2.y) * 32;
   auto zDelta = abs(loc1.z - loc2.z) * 2;
   if (xDelta < yDelta) xDelta >>= 4; else yDelta >>= 4;
   return xDelta + yDelta + zDelta;
   ```
5. Best result is only updated at **ends of search paths** (goal, dead end,
   wide-path boundary, limit hit, loop) — `GuestPathfinding.cpp:651-656` — so
   "no-through" thin dead ends are never credited no matter how close they get.

## 2. Data Structures

### Per-peep state (the interesting part)

Embedded directly in the peep struct, not in a side table
(`src/openrct2/entity/Peep.h:412-414`):

```cpp
uint8_t pathCheckOptimisation; // see peep.checkForPath
TileCoordsXYZD pathfindGoal;
std::array<TileCoordsXYZD, 4> pathfindHistory;
```

- `pathfindGoal` — the tile+edge the peep is currently navigating to. Reset via
  `Peep::resetPathfindGoal()` (`src/openrct2/entity/Peep.cpp:2655-2658`), which
  also invalidates history on next call. When the DFS fails for all edges, the
  caller resets the goal so the search can "try again" (e.g.
  `src/openrct2/entity/Staff.cpp:733-741`).
- `pathfindHistory[4]` — persistent *greedy memory*: the last four thin
  junctions the peep passed through toward the current goal, with the edges it
  has not yet tried. `ChooseDirection` explains the design
  (`GuestPathfinding.cpp:1298-1308`): "the peep remembers those edges it has not
  yet taken... This forces the peep pathfinding to try the 'next best'
  direction after trying the 'best' direction(s) and finding that the goal
  could not be reached." When all edges are exhausted, history is reset to
  untried so the peep can recover after path edits (`GuestPathfinding.cpp:1331-1345`).
  History is matched by exact location (`GuestPathfinding.cpp:1313-1315`) and
  also used to detect walks-in-circles loops during search
  (`GuestPathfinding.cpp:1068-1087`).
- `pathCheckOptimisation` (a cached "am I really on a path" check) —
  `src/openrct2/entity/Peep.h:412`.
- The serialiser confirms this is the full pathfinding payload
  (`src/openrct2/entity/Peep.cpp:2645-2646`:
  `stream << pathfindGoal; stream << pathfindHistory;`).

### Search-scoped state (per call, stack-local)

`PathFindingState` (`src/openrct2/peep/GuestPathfinding.cpp:47-61`): junction
counters, tile budget, and a 9-entry per-search junction history
(`history[kMaxJunctions + 1]` with location + direction). This is distinct from
the persistent `peep.pathfindHistory` and is re-initialised per edge
(`GuestPathfinding.cpp:1407-1419`).

### Per-tile / map state

- The world is a tile-element grid (RCT2's original 256×256-tile map; OpenRCT2
  keeps the same tile-coordinate model — the bounds guard in
  `PeepMoveOneTile` checks `kMaximumMapSizeBig`, defined from
  `kMaximumMapSizeTechnical` in `src/openrct2/world/MapLimits.h:23`).
- The DFS walks `TileElement` stacks per tile via `MapGetFirstElementAt`
  (`GuestPathfinding.cpp:762`) and classifies them into a
  `PathSearchResult` enum (deadEnd, wide, thin, junction, rideQueue,
  rideEntrance, rideExit, parkExit, shopEntrance, other, loop, limitReached,
  failed) — `GuestPathfinding.cpp:65-80`.
- Path topology lives on each `PathElement`: edge bits, slope, wide flag,
  queue flag (`src/openrct2/world/tile_element/PathElement.h:55-126`).
  Permitted edges are masked by banner clearance: `PathGetPermittedEdges`
  (`GuestPathfinding.cpp:189-192`).

## 3. Cost Bounds (the key question: yes, triple-bounded)

RCT2 bounds pathfinding work hard, per peep per decision. OpenRCT2 preserves
all three original bounds:

1. **Whole-search tile budget** — set in `ChooseDirection`
   (`src/openrct2/peep/GuestPathfinding.cpp:1237-1239`):
   ```cpp
   /* The max number of tiles to check - a whole-search limit.
    * Mainly to limit the performance impact of the path finding. */
   int32_t maxTilesChecked = (peep.is<Staff>()) ? 50000 : 15000;
   ```
   It is divided among the candidate edges so each edge gets a fair share
   (`GuestPathfinding.cpp:1401-1404`:
   `state.countTilesChecked = maxTilesChecked / numEdges;`) and decremented
   per DFS step (`GuestPathfinding.cpp:733`).
2. **Per-path step limit** — the DFS aborts a search path at 200 steps or when
   the tile budget is exhausted (`GuestPathfinding.cpp:1015`):
   ```cpp
   if (numSteps >= 200 || state.countTilesChecked <= 0)
   ```
   With the comment "If the search result is better than the best so far...
   update the parameters" — i.e. even cut-off searches still yield the best
   partial estimate toward the goal.
3. **Junction depth limit** — thin junctions remembered along a search path are
   capped at 8 (`kMaxJunctions`, `GuestPathfinding.cpp:35-45`), with
   per-role variants: staff 8, guest 5, guest-with-map 7, guest-leaving-park 7
   (lost: 8). `PeepPathfindGetMaxNumberJunctions` selects per peep
   (`GuestPathfinding.cpp:557-579`). When the junction budget hits zero the
   search path ends and the best-so-far is updated
   (`GuestPathfinding.cpp:1117-1139`).

Supporting early exits: single-edge/dead-end triage before searching
(`GuestPathfinding.cpp:1938-1944`), loop detection via both the persistent and
per-search junction histories (`GuestPathfinding.cpp:1089-1110`), and "goal
reached" continuation pruning (`GuestPathfinding.cpp:909-934`). So the worst
case is `O(budget)` tiles ≈ 15k guest / 50k staff across the *whole* DFS for
that peep's decision, divided across edges — not a full-map scan.

Also worth noting: the search runs once per destination-reached event, not
every tick, and OpenRCT2 wraps it in `PROFILED_FUNCTION()`
(`GuestPathfinding.cpp:1227`), confirming this is a recognised perf hotspot.

## 4. Mechanism Assessment

Lab mechanism families to check: M-10 (index-linked membership lists over fixed
pools), M-2 (fixed pools), or none found.

**Verdict: none found — with one adjacent mechanism worth recording.**

- M-10: Not used by pathfinding. There is no index-linked membership list, no
  per-tile "peeps here" list consulted by the search. The DFS consults raw tile
  element stacks and per-peep history. (`UNANCHORED-adjacent claim: absent in
  the searched files; see §5.)
- M-2: The **entity layer** RCT2 famously uses fixed pools exists
  (`src/openrct2/entity/EntityRegistry.h:25`:
  `constexpr uint16_t kMaxEntities = 65535;` and `EntityRegistry.h:59`:
  `Entity_t entities[kMaxEntities]{};`), and the peep's pathfinding state is
  embedded inline in those pool objects (Peep.h:412-414) — struct layout
  preserved as per-peep fields, no dynamic allocation, small bounded sizes
  (4-entry history). But this pool is an entity-system mechanism, not a
  pathfinding mechanism per se; the pathfinding algorithm itself adds no
  pool-like structure. Honest characterisation: pathfinding rides on M-2's
  per-object state embedding, but the *bounding* mechanism is the search-limit
  trio in §3, which is neither M-2 nor M-10.
- The signature RCT2 trick here is actually the **per-peep bounded memory**
  (`pathfindGoal` + 4-entry `pathfindHistory`) that turns an unbounded graph
  search into a bounded one with a hill-climb-out-of-local-minimum repair loop.

## 5. Honesty / Coverage

Everything above is anchored to exact `file:line` in the current tree except:

- UNANCHORED: The claim that M-10 is *absent* (not just unobserved) — absence
  in the grep results for `pathfind|Pathfind|FindPath` across
  `src/openrct2/entity/` and the reviewed `GuestPathfinding.cpp` is negative
  evidence only over searched files, not proof of absence codebase-wide.
- UNANCHORED: Original RCT2 runtime behavior (actual per-frame cost in the
  2002 binary) — OpenRCT2's `rct2: 0x...` annotations identify provenance but
  this session did not run the original binary; statements about RCT2's
  runtime are inferred from the reconstruction's comments and constants.
- UNANCHORED: The ride-maze pathfinding inside rides
  (`Guest.cpp:4863` `Guest::updateRideMazePathfinding()`, dispatched at
  `Guest.cpp:5363-5364`) is a separate per-ride algorithm; I read its
  entry/dispatch only and did not analyze it — outside T5B's park-pathfinding
  scope.

Searched (all negative or covered): grep `pathfind|Pathfind|FindPath` in
`src/openrct2/entity/` (results folded into §1-2), full read of
`src/openrct2/peep/GuestPathfinding.h` (36 lines, namespace-only), targeted
reads of `GuestPathfinding.cpp` lines 33-92, 189-215, 502-620, 624-769,
895-1215, 1224-1503, 1873-2075, `Peep.h` 400-460, `Peep.cpp` 2255-2295 and
2645-2662, `Staff.cpp` 727-746, `EntityRegistry.h` header constants.
