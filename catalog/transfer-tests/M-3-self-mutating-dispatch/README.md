# Transfer test — M-3 self-mutating dispatch: deferred vs inline rebind application

**Claim tested.** The mechanism's distinctive property (found independently in
Another World 1991 and TH04 1998 — rebinds requested during a frame are applied
**between frames** via `checkThreadRequests`/`threadsData[REQUESTED_PC_OFFSET]`)
makes emergent multi-thread behavior **independent of task iteration order**.
The common modern alternative — transitions and actions applied inline at the
transition site (Doom does this for state actions, p_mobj.c:76; so do most
hand-rolled state machines) — makes cascading behavior **implementation-defined**.

**Code.** `bench.mjs`: a 64-thread chain (N = AW's `VM_NUM_THREADS`). Thread i's
fire action triggers thread i+1 by zeroing its countdown. One trigger on thread 0.
Each thread processed once per frame, in two iteration orders (forward vs
reverse — an implementation detail that should not change behavior):

- **naive**: transitions + actions execute inline during the pass.
- **deferred** (TH04/AW): transitions recorded during the pass, applied after
  it by a `checkThreadRequests` phase.

## Results (Node 22, deterministic)

| Variant | Order A (fwd) | Order B (rev) | Timelines |
|---|---|---|---|
| naive (inline) | all 64 fire in **1 frame** | all 64 fire in **64 frames** | **diverge at frame 0** |
| deferred (TH04/AW) | 64 frames | **64 frames** | **match** — order-independent |

## Verdict

**Proven.** The deferred application is not an implementation detail — it is the
load-bearing property:

1. **Order-independence**: with inline rebinds, the same trigger produces a
   1-frame cascade or a 64-frame cascade depending on how the scheduler sorts
   tasks. With deferred rebinds, both orders produce identical timelines.
   Cross-task rebinding becomes **deterministic regardless of the scheduler** —
   the property that makes the pattern portable (same script, same behavior,
   any task system).
2. **This is the modern job-graph/ECS rule.** "Structural changes deferred to
   sync points" in ECS; "commands committed between ticks" in job systems;
   "one message per actor per tick" in actor frameworks — all re-derivations
   of `checkThreadRequests`.
3. **The honest cost is latency**: the deferred cascade takes 64 frames where
   the inline best-case takes 1. TH04/AW accepted one-frame-cascade latency in
   exchange for order-independent behavior. If a design wants both, the modern
   answer is explicit dependency edges (a DAG), not immediate application.

## Invariant learned by the test itself

The chain only propagates if **every link is armed**. Our first run left the
chain threads IDLE — the trigger bounced off. In VM terms: a rebind targeting
an inactive thread is silently dropped (AW: `VM_INACTIVE_THREAD = 0xFFFF`;
TH04: `DAT_4646` swap skips inactive channels). Real AW bytecode can *arm*
threads as part of the script; the test now arms all links at setup, matching
how the games' initialization parts set up the event channels.

## Reproduce

```sh
node bench.mjs
```

## Carry to the catalog

M-3 status → **proven**. Generalization: self-mutating dispatch decomposes into
(1) dispatch-as-data (M-1 family), (2) the *deferred application discipline*
that makes data-driven rebinding order-independent — and (2) is what modern
task systems keep re-deriving.
