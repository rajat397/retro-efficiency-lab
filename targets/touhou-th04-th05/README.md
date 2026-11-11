# Target 1 — Touhou TH04 (東方幻想郷 Lotus Land Story, 1998) / TH05 (東方怪綺談 Mystic Square, 1998)

Status: **in progress** (started 2026-11-12)

## Why this target

- The canonical "complex game in a tiny budget": PC-98 DOS-era, 640KB conventional
  memory + extended memory, whole bullet-hell sim with zero per-frame allocation.
- Famous public reconstruction projects exist (Project Shrine Maiden-style TH04/TH05
  decompilations) → cross-reference available.
- Directly hits the families: `zero-alloc` (bullet pool), `data-as-program`
  (patterns), `procedural` (backgrounds), `streaming` (audio on PC-98 FM boards).

## Question list (written before diving)

1. How does the bullet pool never allocate during a frame? (slots, lifetimes, reuse)
2. Where does data end and code begin — how much of a bullet pattern is data?
3. How does the frame loop stay deterministic enough for score-play (fixed timestep)?
4. How are sprites/graphics packed and reused (palette discipline)?
5. How does audio (FM/MIDI driver) coexist with the game loop under CPU constraints?

## REA fit

- PC-98 games are DOS executables → REA `dos-mz` / `dos-com` support + Ghidra x86.
- Real-mode 16-bit — Ghidra handles x86 real mode; expect hand-holding on segment math.

## Plan

1. Locate public decompilation (cross-reference only).
2. Obtain the game binaries (TH04 `Lotus Land Story`, TH05 `Mystic Square` — freeware
   distributed by ZUN; mirror verification needed). Analysis-only: no assets reused.
3. REA scope pass → confirm question list against reality.
4. Extract cards: bullet pool (M-2), pattern-as-data (M-3), frame loop (M-4).

## Findings

(to be filled as sessions produce evidence)

## Cross-reference located (2026-11-12)

- **`nmlgc/ReC98`** (886⭐) — The Touhou PC-98 Restoration Project: byte-identical
  source reconstruction of TH01–TH05. Cloned to `/mnt/data/opt/ReC98` (reference only).
  Also uses DOSBox-X + **Neko Project II debug edition** for runtime observation.
- **`N0zoM1z0/th04`** (36⭐) — standalone TH04 source reconstruction.

## Early findings from ReC98 (pre-REA, documentary)

1. **Multi-EXE architecture**: TH04 = `zun.com` + `op.exe` (menus) + `main.exe` +
   `maine.exe` (gameplay variants). Whole game split across executables that chain-load.
2. **Shared-library dominance**: `master.lib` + C runtime = **74% of OP.EXE** and
   **40% of MAIN.EXE** code (ReC98 README). The *game-specific* code is the minority —
   a direct calibration for our extraction effort.
3. **Stage enemies/bullet patterns = bytecode in `.STD` files** (data-as-program);
   **midboss/boss battles are hardcoded** in the executables. The split between
   scripted and compiled behavior is itself a mechanism to document.
