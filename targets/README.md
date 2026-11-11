# Targets

Selection principle: hard budget + public reconstruction + REA-fit + modern analogue.

| # | Target | Year/Platform | Budget | Mechanisms expected | Status |
|---|---|---|---|---|---|
| 0 | [MarioXP](marioxp/) | 2003 / Win32 | 12.6MB app file | Clickteam VM, save encoding, hidden-mode machinery | ✅ worked example |
| 1 | [Touhou TH04/TH05](touhou-th04-th05/) | 1998 / PC-98 | 640KB conv + ext | bullet pool, fixed-slot entities, pattern-as-data | 🔄 in progress |
| 2 | Doom | 1993 / DOS | 4MB RAM, 12MB disk | determinism, WAD resource system, LUTs | ⏳ queued |
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

- Cards written: **7** (M-1 calibration, M-2..M-7 single-witness — see `catalog/`)
- Cataloged (≥2 witnesses): 0 — TH05 diff pending for M-2/M-3/M-7
- Proven (transfer-tested): 0 — first transfer test is the next milestone
