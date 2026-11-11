### M-6 Procedural background painter over a bit-packed ring buffer (`procedural`)

**Mechanism.** Scrolling backgrounds are not stored — a painter walks a fixed
400-element ring buffer of bit flags (`& 7`, `>> 3`, stride `0x20`), conditionally
writing bits with wraparound and a scroll-offset base, deriving the visible pattern
each frame from state + position.

**Witnesses.** TH04 `MAIN.EXE` (`FUN_1aaf_0ee6` @ `0x1b9d6`); ReC98
`th04/main/circle.cpp` + `circles[bss].asm` (the TH04 spinning-rings backgrounds).

**Evidence.**
- Decompiled `FUN_1aaf_0ee6` (ev_9a753a…): `param_1 >> 4` (8.4 subpixel), range
  checks against `0x180` (384 px playfield height), bit writes `*p = 1` into
  `DAT_3134_4700 + (i >> 3) * 0x20` with `(i & 7)` bit offset, wraparound
  `mod 400` (same constant as the bullet pool — unrelated system, caught by the
  constant-verification rule).
- Scroll base lookup: `((undefined2 *)&DAT_3134_4260)[scroll_id]` — per-scroll-phase
  offset table.
- Zero stored art for the pattern; the renderer derives shape from the bit ring.

**Generalization.** Web/app backgrounds, shader-free decorative layers, embedded
UIs: store a generator + small ring of state instead of frames of art; bit-packed
occupancy rings generalize to any grid-marking problem (chat badges, cache slots,
spatial hashes).

**Costs.** Patterns are limited to what the painter can express (no arbitrary art);
bit-twiddling costs code size and debugging clarity; ring wraparound artifacts
must be deliberately hidden.

**Status.** single-witness.
