### M-2 Fixed-slot pool with in-record state machine (`zero-alloc`)

**Mechanism.** All volatile entities live in one fixed-size array allocated once at
load; slots are recycled through a state machine *stored inside each record*
(FREE/ALIVE/REMOVE + per-state timers), so a frame touches memory linearly and
allocates nothing — ever.

**Witnesses.** TH04 `MAIN.EXE` (`FUN_23a9_8e38` @ `0x2c8c8`); same family expected in
TH05 (pending) and strongly suspected in RCT peep arrays (queued).

**Evidence.** (all TH04, REA session snapshot 17 records)
- Pool base `DAT_3134_86b8` (linear `0x399F8`), **440 slots × 26 B** (240 pellets +
  200 16×16 bullets), iterated **backward** (`pbVar8 += -0x1a` per slot).
- Flag machine verbatim in the decompile: `flag==2 (F_REMOVE) → 0 (F_FREE)`;
  `flag==0 → skip`. Matches ReC98 `F_FREE=0/F_ALIVE=1/F_REMOVE=2` exactly.
- Decay state machine in the same bytes: `move_flag < 4 (BMF_DECAY) → = 4`, decay
  sprite patnums `0x70`/`0x6c`, timer counts up → destroy at `> 0x13`.
- Kill scoring +10/+100 by sprite class; graze counter capped at 999
  (`DAT_3134_bcbc`); hitbox test → player-death flag `DAT_3134_4669`.
- Sim/render split: render pass writes `(x >> 4) + 0x1c` + mod-400 slot indices
  (helpers `FUN_23a9_0258` @ `0x23ce8`, `FUN_23a9_0280` @ `0x23d10`) into a separate
  render array — the hot loop never touches VRAM.
- Pool ≈ 11.4 KB < 6% of the ~190 KB engine working set.
- ReC98 cross-ref: `bullet_t` (18 fields, byte-aligned BC++), `bullet_special_motion_t`
  enum (bounce/gravity/decelerate-then-turn…), spawn-flag bitfields incl. 16 inline
  "cloud trail" bits.

**Generalization.** ECS archetype chunks, object pools in game/netcode servers, arena
allocators, WebGPU buffer reuse. The in-record state machine (state + timer in the
same struct, advanced in one linear pass) removes the separate scheduler/allocation
layer entirely; index handles (mod-N helpers) make records addressable without
pointers.

**Costs.** Fixed capacity = hard ceiling (cap is a design decision: 440 bullets IS
the difficulty envelope); records waste bytes when empty (26 B × 440 always resident);
no per-entity polymorphism — behaviors must fit the enum/flag budget; index-based
referencing breaks if slots are compacted.

**Status.** single-witness.
