### M-5 Measured adaptive frame budget (`adaptive`)

**Mechanism.** Instead of dropping frames or stuttering under load, the engine counts
its dominant workload (live bullets) each frame and *steps the simulation rate down*
through discrete levels when a difficulty-scaled threshold is crossed — gameplay
slows, nothing is skipped, determinism is preserved.

**Witnesses.** TH04 `MAIN.EXE` (inside the bullet update loop); ReC98
`th04/main/slowdown.hpp` + `playperf.hpp` name the same system (`SLOWDOWN_BULLET_
THRESHOLD = 24`).

**Evidence.** (all in the decompiled `FUN_23a9_8e38` @ `0x2c8c8`, ev_3363f9…)
- `bullets_seen` counted during the pool walk (`local_4`).
- End-of-loop compare: `bullets_seen < DAT_3134_5395 + 0x18 + DAT_3134_4348*8`
  → `DAT_3134_5390 = 2` — the speed level, threshold scaled by difficulty
  (`DAT_4348`) and a per-scene base.
- The main loop's `DAT_3134_5390` feeds the frame pacing path
  (`DAT_3134_5390 <= DAT_3134_2ab2` accumulate in `FUN_1aaf_0098` @ `0x1ab88`).
- ReC98 cross-ref: threshold constant 24 (TH04) / 32 (TH05, unused there), decel
  base speed 4.5 px/f with 32-frame decay — the *budget* system, not just speed.

**Generalization.** Frame-rate regulators for sim-heavy web/server work: measure the
dominant queue, step discrete slowdown levels (not continuous time-stretch), scale
threshold by user-selected difficulty/load profile. Preserves tick-based replays and
netcode where dropped frames would not.

**Costs.** Deliberate slowdown reads as "lag" to players if thresholds are wrong;
discrete steps are only as smooth as their calibration; interactions with input
latency need testing; useless for workloads that can't be counted cheaply.

**Status.** **proven** — binary-anchored (TH04) + transfer-tested
(`catalog/transfer-tests/M-5-measured-slowdown/`): under sustained 1.5×/2.0×
overload, the measured rate-step bounds wall-clock lag at **8–17 ms** where the
naive full-rate loop accumulates **49.8–99.6 s** of linear backlog. Rate degrades;
entities and determinism do not. Limits: level 2 halves capacity — pair with the
M-2 pool cap (TH04's actual two-layer design) or extend the ladder (4, 8) for
deeper overload; difficulty scaling (`+diff*8`) maps to per-tier SLA classes.
