# The combined demo — four proven mechanisms, one run

`node demo/mini.mjs`

A headless mini bullet-hell: **4 emitter threads** (deferred-dispatch VM, M-3)
spawn ring patterns into a **2048-slot pool** (M-2, allocation-counted), bullets
move in **fixed-point under a fixed tick** (M-4), population grows past
**1200 → simSpeed 2** (M-5, TH04's control law), and the whole run is
**replayed from the same input stream with byte-identical state hashes**
(M-4 verification built in).

## Output (2026-11-12, Node 22)

```
M-2 slot pool      : post-init allocations = 0  (must be 0) — PASS
M-5 measured slow  : peak population 2048 (threshold 1200) -> slowdown engaged on 1469 frames — PASS
M-3 deferred dispt.: emitters ran via request/apply across 3000 frames (no inline mutation) — PASS (structural)
M-4 replay         : 6 state hashes, replay match = true — PASS
   run1: 700aefd9 e7ddc348 b375f65d f95dc7ec 70948814 d7a92522
   run2: 700aefd9 e7ddc348 b375f65d f95dc7ec 70948814 d7a92522
   sim ticks: run1=1532 run2=1532
ALL FOUR MECHANISMS VERIFIED IN ONE RUN
```

## What it demonstrates

The disciplines **compose**. Each transfer test proved one mechanism in
isolation; this artifact shows them co-existing without conflicts —
which is the actual claim the lab makes: these are not nostalgic tricks,
they are compatible structural disciplines for modern stacks.

Design notes:
- Pool-full spawns are *dropped* (M-2's cap = memory determinism wins over
  completeness, same as TH04's 440-cap).
- The slowdown engages on 1469 of 3000 frames — deterministic, so the
  replay includes the scheduling behavior, not just entity state.
- Emitter PC changes ("idle" → "burst" → "idle") are requests applied at the
  frame boundary; ordering across emitters cannot leak into sim state.
