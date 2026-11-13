# Mechanisms catalog

Evidence cards per `docs/methodology.md`. Status ladder: `single-witness` →
`cataloged` (≥2 witnesses) → `proven` (transfer test with numbers).

Families: `determinism` · `zero-alloc` · `data-as-program` · `procedural` ·
`streaming` · `format` · `lut` · `adaptive` · `spatial` · `sched` ·
`budget-portability` · `erlang-capacity` · `attribution`

Cataloged: **M-1, M-3, M-4, M-6, M-7, M-8, M-9, M-10** — M-4 and M-7 gained their second witnesses from
Target 2 (Doom, official id source release), making the first cross-engine-family
proofs.

| ID | Mechanism | Family | Status | Witnesses |
|---|---|---|---|---|
| [M-1](M-1-event-vm.md) | Event-program-as-VM (behavior as data payload) | data-as-program | **cataloged** | MarioXP + Another World |
| [M-2](M-2-slot-pool.md) | Fixed-slot pool with in-record state machine | zero-alloc | **proven** | TH04 + transfer test |
| [M-3](M-3-timed-vm.md) | Timed bytecode VM with self-mutating dispatch | data-as-program | **proven** | TH04 + TH05 + transfer test |
| [M-4](M-4-replay-determinism.md) | Replay determinism via fixed-size input recordings | determinism | **proven** | TH04 + Doom + transfer test |
| [M-5](M-5-measured-slowdown.md) | Measured adaptive frame budget (slow sim, never drop) | adaptive | **proven** | TH04 + transfer test |
| [M-6](M-6-procedural-bg.md) | Procedural generation from compact seeds/state | procedural | **proven** | TH04 + Elite + transfer test |
| [M-7](M-7-fnptr-composition.md) | Frame pipeline composed from hot-swapped function-pointer slots | data-as-program | **cataloged** | TH04 + Doom |

| [M-8](M-8-zone-allocator.md) | Tagged zone allocator — free-by-tag pooled memory | zero-alloc | **cataloged** | Doom + Duke3D |
| [M-9](M-9-lut-trig.md) | Precision-by-LUT: integer trig + slope tables | lut | **cataloged** | Doom + Duke3D |
| [M-10](M-10-index-linked-lists.md) | Fixed-pool entities with index-linked membership lists | spatial | **proven** | TH04 + transfer test |
| [M-11](M-11-work-budgets.md) | Hard per-operation work budgets | sched | **proven** | TH04 + transfer test |
| [M-12](M-12-budget-portability.md) | Budget disciplines are resource-agnostic (port to token/rate-limit resources) | budget-portability | **proven** | TH04 + transfer test |
| [M-13](M-13-erlang-capacity.md) | Queueing math gives a closed-form capacity answer — but only for Poisson arrivals | erlang-capacity | **proven** | Erlang (1909/1929) + transfer test + measured traffic |
| [M-14](M-14-range-intersection-attribution.md) | Range-intersection attribution: derive ownership by intersecting a global handler table with the ranges you already enumerated (no registry) | attribution | single-witness | VMAP.COM (1991 DOS utility, original binary) |

Working set anchor (TH04 `MAIN.EXE`): ≈ **190 KB** total (154 KB image + 34.6 KB BSS)
for the full gameplay engine; bullet pool = 440 × 26 B = 11.4 KB of that.
