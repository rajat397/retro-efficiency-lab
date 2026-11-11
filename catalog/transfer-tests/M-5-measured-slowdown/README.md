# Transfer test — M-5 measured slowdown as a modern load-shedding primitive

**Claim tested.** TH04's control law (binary-anchored: `FUN_23a9_8e38` @ `0x2c8c8`
counts `bullets_seen` each pass; `≥ base+0x18+diff*8 → simSpeed = 2`; main loop
accumulator `simClock += (simSpeed <= phase)` = tick every other frame) transfers
to modern tick-based systems as **rate-shedding under measured load**: degrade the
simulation *rate*, never the entity set, never determinism.

**Code.** `bench.mjs` — deterministic work-unit model (1 unit = one entity's tick;
budget B = 2048 units = 16.6ms). Sustained overload at 1.5× and 2.0× budget
(population capped by the M-2 slot pool at 4096). Two variants:
- **naive**: attempts the full 60 ticks/s regardless of capacity.
- **th04-law**: measures the live count every frame, steps level 1→2 per the
  decompiled threshold law, ticks via the accumulator.

## Results (Node 22, deterministic model)

| Scenario | Variant | Achieved sim/s | Wall lag after 100s | Max lag |
|---|---|---|---|---|
| 1.5× overload (pop 3072) | naive | 60 (attempted) | **49,800 ms** — linear, unbounded | 49.8 s |
| 1.5× overload | th04-law | 30 | **8 ms** — bounded | 8 ms |
| 2.0× overload (pop 4096) | naive | 60 (attempted) | **99,600 ms** — linear, unbounded | 99.6 s |
| 2.0× overload | th04-law | 30 | **17 ms** — bounded | 17 ms |

## Verdict

**The mechanism transfers, and the framing sharpens.** What TH04's slowdown *is*:
a measured rate controller — under load, the sim advances every other frame, so
achieved rate matches capacity. What it buys:

1. **Bounded latency vs unbounded.** The naive full-rate loop under sustained
   overload accumulates lag linearly forever (49.8 s after 100 s at 1.5×). The
   measured law keeps it at milliseconds. Same entities, same tick function,
   same determinism — only the rate degrades.
2. **Zero entity shedding.** Modern load-shedding usually means dropping work
   (entities, messages, requests). TH04 sheds *time*, not state.
3. **The control law is one comparison.** `count >= threshold ? 2 : 1` plus a
   phase accumulator — deployable in any tick loop in ~5 lines.

## Honest limits (and what TH04 pairs it with)

- Level 2 halves capacity; at >2× budget sustained, level 2 alone can't bound the
  backlog. TH04's answer is **two layers**: the slot pool's CAP (440 = the hard
  population bound, M-2) plus the rate step for transient peaks. A modern port
  should extend the ladder (levels 4, 8 → log₂ steps) for deeper overload.
- On tick frames the work still exceeds the frame budget (tick overrun 100% at
  overload) — the sim *step* is stretched in wall time; that's the intended
  "slower game" tradeoff, not a scheduler bug.
- TH04's difficulty scaling (`+ diff*8`) sets the threshold per option level —
  higher difficulty tolerates denser scenes before slowing. The same knob maps
  directly to per-tenant/per-tier SLA classes.

## Reproduce

```sh
node bench.mjs
```

## Carry to the catalog

M-5 status → **proven**. Family note: `adaptive` — measured degradation policy,
the third family member with a modern-proof (M-2 zero-alloc, M-5 rate control).
