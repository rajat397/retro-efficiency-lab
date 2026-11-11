# Targets

Selection principle: hard budget + public reconstruction + REA-fit + modern analogue.

| # | Target | Year/Platform | Budget | Mechanisms expected | Status |
|---|---|---|---|---|---|
| 0 | [MarioXP](marioxp/) | 2003 / Win32 | 12.6MB app file | Clickteam VM, save encoding, hidden-mode machinery | ✅ worked example |
| 1 | [Touhou TH04/TH05](touhou-th04-th05/) | 1998 / PC-98 | 640KB conv + ext | bullet pool, fixed-slot entities, pattern-as-data | 🔄 in progress |
| 2 | [Doom](doom/) | 1993 / DOS | 4MB RAM, 12MB disk | determinism, WAD resource system, LUTs | ✅ witnessed (M-4 also proven) |
| 3 | RollerCoaster Tycoon | 1999 / Win32 | hand-written x86 asm | peep AI, no-alloc economy, sprite caching | ⏳ queued |
| 4 | Another World | 1991 / Amiga→DOS | ~600KB whole game | bytecode VM, procedural animation | ⏳ queued |
| 5 | SCUMM (Monkey Island) | 1990-92 / DOS | resource-cached | resource system, LRU-as-memory-manager | ⏳ queued |
| 6 | X-COM: UFO Defense | 1994 / DOS | 4MB RAM | snapshot architecture, tactical AI tables | ⏳ queued |
| 7 | KKrieger / 64K intros | 2004 / Win32 | 96KB whole game | procedural-as-compression, soft-synth | ⏳ queued |
| 8 | Genesis/NES ROM | 80s-90s / console | 64KB-1MB | memory maps, physics-on-a-budget | ⏳ queued |

## Mechanism families

`determinism` · `zero-alloc` · `data-as-program` · `procedural` · `streaming` ·
`format` · `lut`

## Progress dashboard

- Cards written: **9** — see `catalog/`
- Cataloged (≥2 witnesses): **3** — M-3, M-4, M-7 (M-4/M-7 second witness = Doom)
- Proven (transfer-tested): **3** — M-2 + M-5 + M-4 (Node/V8, `catalog/transfer-tests/`)

## Lab scoreboard (2026-11-12, end of day)

| Status | Count | Cards |
|---|---|---|
| proven (transfer-tested with numbers) | **2** | M-2 (zero-alloc pool), M-5 (measured slowdown) |
| cataloged (≥2 binary witnesses) | **1** | M-3 (timed VM, TH04+TH05) |
| single-witness | 4 | M-4, M-6, M-7 (+ M-1 calibration) |

Transfer tests: `catalog/transfer-tests/` — M-2 (Node/V8), M-5 (deterministic model).
Both proved the mechanism transfers; both sharpened the claims (M-2: the win is
memory determinism, not speed at small scale; M-5: the win is bounded latency under
overload — a load-shedding primitive, paired with the pool cap in TH04's design).

## Lab scoreboard (2026-11-12, update 2)

| Status | Count | Cards |
|---|---|---|
| proven | **2** | M-2, M-5 |
| cataloged (≥2 witnesses, cross-engine) | **3** | M-3 (TH04+TH05), M-4 (TH04+Doom), M-7 (TH04+Doom) |
| single-witness | **4** | M-6, M-8, M-9 (+ M-1 calibration) |

Target 2 (Doom) delivered: engine-family diversity for the catalog's "general"
claims — 1993 C/id Tech vs 1998 Borland/asm PC-98, same mechanisms.
