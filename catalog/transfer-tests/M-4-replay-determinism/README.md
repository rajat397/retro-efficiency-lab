# Transfer test — M-4 replay determinism (fixed-tic architecture vs variable-dt)

**Claim tested.** Replay-exactness (same recorded inputs → byte-identical state)
is a property of the **architecture** — fixed-tic simulation with integer/fixed-point
state (Doom: 4 B/tic input stream, 35 Hz, `fixed_t` Q16.16; TH04: `REC<DEMO_N>`
recordings, 8-bit subpixel) — and is *destroyed* when the sim equation consumes
machine timing (dt from real frame times).

**Code.** `bench.mjs`: one input recording (wind + kill lottery per tic, seeded),
two simulation styles, each replayed twice on **different machine-load jitter
streams** (the only difference between replay #1 and #2):

- **A — fixed-tic/fixed-point** (Doom/TH04 style): integer state (`Int32Array`),
  fixed step, jitter consumed as frame time but *ignored by the state equations*.
- **B — float + variable-dt** (the common modern idiom): `Float64Array` state,
  `dt = frameMs / 16.6` from real frame timing — machine timing *is* part of the
  equations.

**Experiment.** Replay the SAME recording under two different load profiles
(jitter seeds `0xA11CE` vs `0xD1FF` → 0.6×–1.5× frame-time multiplier). Hash
(FNV-1a over full state) every 500 ticks.

## Results (Node 22, 6000 ticks, 4096 entities, 12 checkpoints)

| | Replay #1 | Replay #2 | First divergence |
|---|---|---|---|
| **A fixed-tic** | hash0 `156a3d3f`, end `05fcafa7` | **identical** | **NONE — byte-identical all 12 checkpoints** |
| **B variable-dt** | hash0 `f22426b9` | hash0 `f177c8f6` | **checkpoint 1 (~tick 1)** |

- A: replay machine #1 consumed 6320 ms of "frame time", #2 consumed 6302 ms —
  18 ms of machine-load difference, **zero state difference**.
- B: the two replays differ from the first checkpoint — machine timing leaked
  into state because `dt` became part of the equations.

## Verdict

**Proven.** Replay determinism is architectural, not accidental:

1. **The recording must be sufficient.** A demo file that stores only inputs is
   only valid if *everything else is constant* — the fixed tic rate is what
   makes "everything else" constant. Variable-dt sims cannot be replayed from
   inputs alone, ever, because the replay's frame timing differs from the
   original run's. (Storing dt too = storing the frame-time stream = the
   recording is no longer just inputs, and replay still won't match across
   builds with different float codegen.)
2. **Integer/fixed-point state makes "byte-identical" literally true** —
   `Int32Array` ops are exact 32-bit math; there is no rounding to differ.
3. The industry workaround stack (fixed tick rate + input demos + save-state
   hashes in netcode) is one mechanism, not three hacks.

## Limits

- Demonstrated same-binary determinism. Cross-build float reproducibility
  (compiler flags, FMA, libm) is the well-known additional failure mode for B —
  A is immune to it by construction (integer ops), which is the architecture's
  second payoff.
- B's divergence is *strengthened* by input-dependent wind only mildly; the
  dominant term is dt itself (state equations consume machine timing).

## Reproduce

```sh
node bench.mjs
```

## Carry to the catalog

M-4 status → **proven**. Generalization sharpened: "deterministic replay" and
"input-only recordings" are the same mechanism — both are consequences of
*taking time out of the state equations*.
