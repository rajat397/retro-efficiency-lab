### M-11 Hard per-operation work budgets (`spatial`/`sched`)

**Mechanism.** A search, scan, or collision resolution does a *bounded*
amount of work and then stops — returning partial results, because the next
operation retries (per-frame convergence) or the bound is far above
perceptual need. The budget is a tuned constant, not an emergent property.

**Witnesses.**
1. **RCT2** (2002): pathfinding is a bounded depth-first search —
   15,000 tiles per whole search for guests (50,000 staff), 200 steps per
   search path, 5–8 thin-junction depth by role (`GuestPathfinding.cpp:658`
   documenting original `rct2: 0x0069A997`, `:1239`, `:1015`, `:35-45`).
   Per-peep inline `pathfindGoal` + 4-entry `pathfindHistory`
   (`entity/Peep.h:413-414`) give greedy retry without global search.
2. **Duke3D/Build** (1996): `clipmoveboxtracenum = 3`
   (`ENGINE.C:5029`) — a moving object's collision resolution tracks at
   most 3 clipped candidates per move (`cnt = clipmoveboxtracenum`,
   `ENGINE.C:5262`; the loop truncates at the budget and
   `retval = clipobjectval[hitwall]` takes the last fit).

**Generalization.** Any per-request work that must not blow up under load:
rate-limited crawls, iterative-deepening agent loops, render-culling
budgets, LSP index batch sizes, per-tick physics CCD caps. Modern framing:
"budget" is the parameter modern systems re-derive; the 90s insight is
that the budget lives at the *operation* level and partial results are
consumed, not errors.

**Costs.** Budgets are magic numbers tuned to their hardware (RCT2's
15,000 tiles assumed a 33MHz 486); partial results must be acceptable —
RCT2 re-runs pathfinding per peep per tick so a failed search self-heals
next frame; a single-shot consumer would need a different story.

**Status.** **cataloged** — two engine-family witnesses (Build 1996, RCT2
2002). Transfer test candidate: unbounded vs budgeted search under
wall-clock pressure — the quality/time Pareto curve is the proof target.
