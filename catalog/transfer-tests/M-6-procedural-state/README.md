# Transfer test — M-6 procedural generation from compact seeds/state

**Claim tested.** Content is not stored — it is derived each time from tiny
compact state through deterministic transforms (Elite's twist register: 256
planets × 8 galaxies from 3×16-bit seed words; TH04's ring-buffer background
painter). Transfer properties: payload size, generation cost, determinism.

## Results (Node 22)

| Property | Stored content | From seeds |
|---|---|---|
| Payload (2048 Elite planets) | 121,000 bytes raw / 22,536 gzipped | **48 bytes** of seeds — **2521× raw, 470× vs gzip** |
| Generation cost | load | **10.9 ms** for all 2048 planets |
| Determinism (regen) | — | hash **IDENTICAL** (integer twist register — no float surface, cf. M-9) |
| Modern framing: 10k test fixtures | 813 KB checked in / 125 KB gz | **4-byte seed**, regen 19 ms, identical |

## Verdict

**Proven.** Content-from-compact-state ships three orders of magnitude smaller
than stored content (and ~470× smaller than gzip'd content) at negligible
generation cost, and is replay-deterministic because the generator is integer
math. The modern payoff is immediate: seeded test fixtures, avatars, and
worlds replace fixture-file bloat with a one-line generator.

**Costs recorded:** regeneration is sequence-locked (item N requires 0..N-1 or
checkpointed seeds — Elite's `next` chain), and the generator's expressiveness
bounds the content (the M-6 card's costs field).

Reproduce: `node bench.mjs`
