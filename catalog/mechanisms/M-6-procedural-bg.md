### M-6 Procedural generation from compact seeds/state (`procedural`)

**Mechanism.** Content is not stored — it is derived each frame from tiny compact
state (seed words, bit-packed ring buffers) through deterministic transforms. Two
faces of the same discipline: a *painter* deriving visible patterns from a ring
buffer of flags, and a *generator* deriving worlds from seed words.

**Witnesses.**
1. **TH04** `MAIN.EXE` (`FUN_1aaf_0ee6` @ `0x1b9d6`); ReC98 `th04/main/circle.cpp`
   + `circles[bss].asm` — background painter over a bit-packed 400-element ring
   buffer (pattern derived from state + scroll, zero stored art).
2. **Elite** (Braben & Bell, 1984; canonical algorithm per Ian Bell's released
   sources, implementation cross-checked via `jrmhaig/elite_universe`): the galaxy
   generator — `twist(arr) = [arr[1], arr[2], arr.sum % 65536]`, a Fibonacci-style
   16-bit shift register over **three seed words (48 bits)**; 4 twists per planet
   yield name/government/economy/position/tech for **256 planets × 8 galaxies**;
   `planet.rb:33-46`.

**Evidence.**
- Decompiled `FUN_1aaf_0ee6` (ev_9a753a…): `param_1 >> 4` (8.4 subpixel), range
  checks against `0x180` (384 px playfield height), bit writes `*p = 1` into
  `DAT_3134_4700 + (i >> 3) * 0x20` with `(i & 7)` bit offset, wraparound
  `mod 400` (same constant as the bullet pool — unrelated system, caught by the
  constant-verification rule).
- Scroll base lookup: `((undefined2 *)&DAT_3134_4260)[scroll_id]` — per-scroll-phase
  offset table.
- Zero stored art for the pattern; the renderer derives shape from the bit ring.

**Generalization.** Store a generator + seeds instead of artifacts: modern
avatars from user IDs, hash-seeded test data, noise textures from seeds,
Minecraft/No Man's Sky worlds, and deterministic generated test fixtures. The
Elite twist-register is the pattern's minimum form: content-addressable-by-seed.

**Costs.** Patterns limited to what the generator expresses (no arbitrary art);
quantization artifacts (Elite's "horace" names); deterministic but sequence-
locked — regenerating item N requires items 0..N-1 (or checkpointed seeds).

**Status.** **proven** — transfer test `catalog/transfer-tests/M-6-procedural-state/`:
48 bytes of seeds vs 121 KB of content (2521× raw, 470× vs gzip), 10.9 ms
generation for 2048 planets, regen hash IDENTICAL; modern framing: 10k test
fixtures from a 4-byte seed. Costs recorded: sequence-locked regen +
expressiveness bounds.
