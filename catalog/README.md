# Mechanisms catalog

Evidence cards per `docs/methodology.md`. Status ladder: `single-witness` →
`cataloged` (≥2 witnesses) → `proven` (transfer test with numbers).

Families: `determinism` · `zero-alloc` · `data-as-program` · `procedural` ·
`streaming` · `format` · `lut` · `adaptive`

First `cataloged` mechanism: **M-3** (TH04 + TH05 binary witnesses, incl. the
near-ptr→far-ptr dispatch evolution).

| ID | Mechanism | Family | Status | Witnesses |
|---|---|---|---|---|
| [M-1](M-1-event-vm.md) | Event-program-as-VM (behavior as data payload) | data-as-program | calibration | MarioXP |
| [M-2](M-2-slot-pool.md) | Fixed-slot pool with in-record state machine | zero-alloc | **proven** | TH04 + transfer test |
| [M-3](M-3-timed-vm.md) | Timed bytecode VM with self-mutating dispatch | data-as-program | **cataloged** | TH04 + TH05 |
| [M-4](M-4-replay-determinism.md) | Replay determinism via fixed-size input recordings | determinism | single-witness | TH04 |
| [M-5](M-5-measured-slowdown.md) | Measured adaptive frame budget (slow sim, never drop) | adaptive | single-witness | TH04 |
| [M-6](M-6-procedural-bg.md) | Procedural background painter over bit-packed ring buffer | procedural | single-witness | TH04 |
| [M-7](M-7-fnptr-composition.md) | Frame pipeline composed from hot-swapped function-pointer slots | data-as-program | single-witness | TH04 |

Working set anchor (TH04 `MAIN.EXE`): ≈ **190 KB** total (154 KB image + 34.6 KB BSS)
for the full gameplay engine; bullet pool = 440 × 26 B = 11.4 KB of that.
