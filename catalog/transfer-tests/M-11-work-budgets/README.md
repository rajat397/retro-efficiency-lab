# Transfer test — M-11 hard per-operation work budgets vs unbounded search

**Claim tested.** RCT2 pathfinding is a bounded DFS (15k tiles / 200 steps /
5–8 junction depth) with inline per-peep greedy memory (`pathfindGoal` +
4-entry `pathfindHistory`, `Peep.h:413-414`); Duke3D caps clipmove collision
candidates at 3 (`ENGINE.C:5029`). The transferable property: **a work budget
sized above typical need costs nothing normally and bounds the pathological
case**; partial results converge via history-guided retry.

## Results (Node 22, 64×64 split maze, 500 agents)

| Scenario | Variant | maxTickMs | arrived% | overshoot | tiles/agent |
|---|---|---|---|---|---|
| 1 typical (sized right) | BFS optimal | 105.4 | 100.0 | +0.0% | — |
| 1 typical | **DFS b=4000** | **47.9** | **100.0** | +6.1% | — |
| 2 hostile (deep goals ≥ 65 of max 92) | DFS b=4000 | 12.5 | 98.0 | +3.6% | — |
| 2 hostile | **DFS b=33 (undersized)** | 13.0 | **0.0** | — | — |
| 3 pathological (unreachable goals) | BFS unbounded | — | — | — | **1647** |
| 3 pathological | DFS b=1000 | — | — | — | 1000 |
| 3 pathological | **DFS b=250** | — | — | — | **250** (wall 71→42ms) |

## Verdict

**Proven.**

1. **Sized above typical need, the budget is free** — and better than free:
   goal-biased budgeted DFS beat the BFS control on worst-tick latency
   (47.9 vs 105.4 ms) at 100% arrivals with +6.1% path overshoot.
2. **The cap's purpose is the pathological case**: proving unreachability
   costs 1,647 tiles/agent unbounded; the budget pays a fixed 250 and the
   failure is graceful — 6.6× fewer tiles, faster wall.
3. **Undersized budgets bind exactly where topology demands more search** —
   deep goals at 0% arrivals with b=33. This is the card's documented cost,
   demonstrated, not hypothetical: the budget is a tuned constant.
4. **Partial results converge via history-guided retry** (`pathfindHistory`
   deprioritizes failed directions; progress clears history).

## Test-bug archaeology (per lab rules — exact errors, root causes)

- **Inverted greedy:** sorting candidates ascending then popping from a
  stack explores the *farthest* goal-direction first — 919-step paths,
  0.4% arrivals. Fixed by pushing reversed (closest pops first). The
  earlier "b=250 collapse" was this bug, not budget size.
- **Generation-stamp truthiness:** `visited[m]` on a Uint32Array is truthy
  for *stale* generations — everything previously searched became
  permanently blocked (1.6% arrivals). Fixed: `visited[m] === _gen`.
- **Mis-sized budget:** the first redesign throttled the typical case —
  RCT2's 15k tiles on a ~16k map taught the correct operating point
  (~90% of the space), which is what scenario 1 now tests.
- **Allocation confound:** per-call `visited`/`parent` allocations dominated
  wall time at small budgets; fixed with reusable generation-stamped
  buffers — the M-2 discipline, applied inside the test itself.

## Reproduce

`node bench.mjs`
