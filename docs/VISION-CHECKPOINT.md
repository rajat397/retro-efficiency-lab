# Vision checkpoint — 2026-11-12

Question: what do we have now that matches the initial vision (rediscover how old
complex software ran in tiny budgets; extract transferable techniques; apply them on
modern stacks for impact)?

## Vision → status

| Vision requirement | Status | Evidence |
|---|---|---|
| RE pipeline works on real targets | ✅ done, incl. the hard case | MarioXP (protected Clickteam CCA + PE ext modules); TH04 `MAIN.EXE` 16-bit DOS MZ decompiled in Ghidra — harder than PE, snapshot-resumable |
| Honest, evidence-backed findings | ✅ method enforced | Decisions log; MarioXP honestly downgraded to calibration; constant-hit verification rule added after false positive |
| Quantified small-budget claims | 🟡 started | TH04 engine working set ≈ **190 KB** (154 KB image + 34.6 KB BSS) for a full bullet-hell game; bullet pool = 11.4 KB of it |
| Mechanism cards in a catalog | 🟡 6 candidates, 0 written as formal cards | M-2 pool, M-3 timed VM w/ self-mutating dispatch, M-4 replay determinism, M-5 measured slowdown, M-6 procedural bg, + function-pointer composition engine — all single-witness, anchored to binary addresses |
| ≥2 witnesses per mechanism | ❌ not yet | TH05 (same engine family) is the fastest second witness |
| Transfer tests with numbers on modern stacks | ❌ not started | This is the vision's payoff — not begun |

## What the TH04 work specifically proved (single-witness, binary-anchored)

1. **M-2** — fixed-slot pool: 440 bullets × 26 B iterated backward, F_FREE/ALIVE/
   REMOVE machine, decay state machine, sim/render split. Zero allocation per frame.
2. **M-3** — stage VM: timed bytecode (`*std_ip == frame_byte`), 4-byte spawn records,
   and the interpreter **rewrites its own dispatch pointers** on script end.
3. **M-5** — measured slowdown: bullets_seen vs difficulty-scaled threshold → sim
   speed step, inside the update loop.
4. **Engine shape** — the whole frame pipeline is function-pointer slots (player move,
   stage VM, phase handlers), hot-swapped at runtime by game events.

## Next steps (priority order)

1. **Write the cards** (M-2…M-6 + engine-composition) into `catalog/mechanisms/` —
   status `single-witness`. Cheap, locks in evidence before context fades.
2. **TH05 as second witness** — same engine family, decompile its `bullets_update` +
   VM runner; diff the two games' choices (pool split 240/200 vs 180/220, extra
   BSM_EXACT_LINEAR motion, origin+distance fields). Cheapest path to `cataloged`.
3. **First transfer test** — pick M-2 (slot pool) or M-5 (measured slowdown);
   ~200-line modern sketch (Rust or TS/WASM) + benchmark vs naive allocation.
   This validates the *whole thesis* before scaling to more targets.
4. Then breadth: Doom (determinism/resource system as second witness for M-4),
   RCT (peep pool), per the slate.

Deliberately deferred (TH04 leftovers, diminishing returns): exact field-map diff for
bullet offsets 0x12/0x13, second VM runner 0x11c0, demo replay decompile.

## Risks to the vision

- **Anchor-perfectionism**: full RE of everything delays the payoff; breadth-first
  cards + one transfer test beats exhaustive anchoring.
- **Single-engine bias**: TH04/TH05 are one engine; witnesses must span engine
  families (Touhou + id + Sawyer) before "general" claims.
- **Sketch quality**: transfer tests must compare against a *fair* naive baseline,
  not a strawman.
