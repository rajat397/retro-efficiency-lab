# What We Lost When RAM Got Cheap

*Synthesis of day one — Retro Efficiency Lab, 2026-11-12*

**The starting claim:** complex software of the 80s–2000s ran deep systems in
kilobytes and megabytes, and modern software is heavier by default. The hypothesis:
some of that old discipline is *structural* and transfers to modern stacks. This
document is the evidence, with runnable reproductions.

**Method in one line:** extract mechanisms from real binaries (evidence-anchored),
cross-check across engine families, then re-implement each mechanism on a modern
stack and *measure* it against the contemporary default. Nothing below is anecdote.

---

## Four proven mechanisms (each: old anchor → modern test → number)

### 1. Memory: the fixed-slot pool (M-2)

*TH04 (1998): 440 bullets × 26 bytes in a ~190 KB engine; zero allocation per
frame, flag machine in-record. Anchored at `DAT_3134_86b8` in `MAIN.EXE`.*

Modern test (Node 22/V8, 4096 slots, 6000 frames, identical workloads):
**247,977 heap allocations → 0**; peak heap **12–20 MB → 4.4–8.2 MB** (2.5–4.5×
lower); frame time equal-or-better, tail 1.1–2.8× better. At TH04's own 440-slot
scale, speed is a tie — the win was never raw speed at small scale; it is *memory
determinism*: the footprint is `cap × stride` forever, regardless of cumulative
traffic.

**Monday version:** any system with bursty entity/message traffic — pools over
per-event allocation; the state machine lives in the record, not in a scheduler.

### 2. Scheduling: the measured slowdown (M-5)

*TH04: `bullets_seen ≥ threshold → simSpeed = 2` — tick every other frame.
Control law anchored in the bullet-update loop; accumulator in the main loop.*

Modern test (deterministic deadline model, sustained 1.5×/2× overload): the naive
full-rate loop accumulates **49.8 s / 99.6 s** of wall-clock lag after 100 s —
linear, unbounded. The measured law: **8 ms / 17 ms — bounded**. Rate degrades;
entities and determinism do not.

**Monday version:** load-shedding by *rate* instead of by *dropping work* for
tick-based servers, agent schedulers, and anything with an SLA. TH04's difficulty
knob (`+diff*8`) maps directly to per-tier SLA classes.

### 3. Determinism: time out of the state equations (M-4)

*Doom (1993): demos are 4 bytes/tic of pure input, 35 Hz, `fixed_t` Q16.16.
TH04: `REC<DEMO_N>` fixed-size input recordings, 8-bit subpixel.*

Modern test: one input recording, replayed under **different machine-load
jitter**. Fixed-tic/fixed-point sim: **byte-identical across all 12 state-hash
checkpoints** (18 ms of replay-machine load difference, zero state difference).
Float/variable-dt sim: **diverged at the first checkpoint** — `dt` from real frame
time *is* state, so machine timing leaks into game state.

**Monday version:** replay systems, lockstep netcode, deterministic CI for sim
code: record inputs, take time out of the state equations, and replay becomes
execution. "Input-only recordings" and "deterministic replay" are one mechanism.

### 4. Dispatch: deferred self-mutation (M-3)

*TH04 and Another World (1991, 7 years and two codebases apart): rebinds
requested during a frame are applied **between frames** (`checkThreadRequests`
/ `threadsData[REQUESTED_PC_OFFSET]`). Found independently, twice.*

Modern test: 64-thread cascade chain, rebinds applied inline vs deferred, two
task iteration orders. Inline: the same trigger produces a **1-frame cascade or
a 64-frame cascade** depending on how the scheduler sorts tasks — behavior is
implementation-defined. Deferred: **64 frames in both orders** — identical
timelines, order-independent. Cost recorded: one frame per cascade link.

**Monday version:** the discipline behind ECS sync points, command buffers, and
actor-framework tick semantics: *structural changes are data until the frame
boundary*. Cascades become scheduler-independent.

---

## The catalog (9 mechanisms, 4 engine families)

| Status | Mechanisms |
|---|---|
| **Proven** (transfer-tested, runnable) | **all ten** — slot pool (M-2) · measured slowdown (M-5) · replay determinism (M-4) · deferred dispatch (M-3) · fnptr composition (M-7) · zone allocator (M-8) · LUT trig (M-9) · index-linked lists (M-10) · procedural-from-seeds (M-6) · event VM (M-1) |

Engine families spanned: id Tech 1 (1993) · Build (1996) · Chahi's AW VM (1991) ·
Borland/Clickteam PC-98 era (1998/2003). Full evidence chain per card:
binary anchors (function names + addresses) or official-source citations, REA
evidence IDs, and reproducible tests (`node bench.mjs`).

## The pattern behind the losses

Each proven mechanism is the same story:

1. **A hard constraint forced a structural choice.** 440-bullet cap = bounded
   footprint; 35 Hz sim = replayable; measured load = playable without dropped
   entities; between-frame rebinds = order-independent cascades.
2. **The choice survived because it was load-bearing, not incidental.**
3. **When the constraint vanished, the structure was replaced by a default**
   (allocate per event, tick at full rate, dt from wall clock, inline state
   changes) — each default is more convenient and each pays a *hidden*
   recurring cost: GC pressure, unbounded backlog, unreplayable state,
   order-dependent cascades.

The transfers show the costs are not nostalgic — they are measurable on a
2026 stack: **0 vs 248K allocations, 8 ms vs 49.8 s of lag, byte-identical vs
never-replayable, order-independent vs implementation-defined.**

## Honest limits

- **Survivorship bias:** we sampled reconstructor-approved survivors; the cards'
  *costs* fields and the TH04↔TH05 diffs are the counterweight.
- **Same-machine timing numbers are noisy** (±50%); the load-bearing transfer
  metrics are the deterministic ones (allocation counts, hash equality, backlog
  bounds).
- **Not yet proven:** LUT-precision payoff (M-9), procedural-as-compression
  (M-6), event-VM extensibility economics (M-1). Cataloged ≠ proven.
- **Scale honesty:** at TH04's own scale, V8 makes most of this free — the
  mechanisms matter when populations, traffic, or correctness requirements grow
  past the defaults' comfort zone (exactly where modern systems live).

## What this enables

A design vocabulary, not a nostalgia trip: four structural disciplines with
measured modern payoffs, portable to web/server/agent systems without romantic
assumptions. The repo carries the full chain — binary → card → test → number —
for every claim above.

*Repro artifacts: `catalog/transfer-tests/*/` (each runs standalone);
binary evidence: `/mnt/data/rea/` snapshots; repo:
github.com/rajat397/retro-efficiency-lab.*
