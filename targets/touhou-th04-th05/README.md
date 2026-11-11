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

## Binaries acquired (2026-11-12)

Source: archive.org item `touhou-pc-98-collection` (ZUN-freeware TH01–TH05, HDI disk
images; analysis-only use — binaries are NOT committed to this repo).

**Tooling built:** `/mnt/data/rea/touhou/extract_hdi.py` — parses Anex86/Neko HDI
(4096-byte header), locates the embedded FAT volume by BPB plausibility (PC-98 disks
use 1024-byte sectors!), handles FAT12 (TH04 uses 12-bit cluster chains), extracts the
directory tree.

**TH04 (東方幻想郷) files:**
- `MAIN.EXE` 154,722 B (gameplay) · `MAINE.EXE` 68,194 B (easy-mode variant)
- `OP.EXE` 75,840 B (menus) · `ZUN.COM` 7,754 B (diet-compressed launcher)
- `GENSO1.EXE` 714,469 B / `GENSO2.EXE` 918,724 B — **stage/graphics data shipped as
  executables** (data-as-program candidate to verify: code segments or disguised data?)
- `PMD.COM` (PMD professional music driver, 20 KB) — FM music runs as an external
  driver process; the game communicates with it (shared-memory note queue?)
- 東方幻想郷ED.DAT 1.1 MB (ending data) · MIKO.CFG (config)

**TH05 (東方怪綺談) files:**
- `MAIN.EXE` 188,786 B · `MAINE.EXE` 120,059 B · `OP.EXE` 79,882 B · `KAIKI101.EXE`
- `MUSIC.DAT` 610,990 B (music data) · two ~1 MB data DATs
- Same ZUN.COM + PMD driver pattern.

**Immediately visible architecture fact (compare with MarioXP M-1):** the game ships
its heavy content as **executable-sized data blobs** chained from a small main program +
a separate music-driver process — the 1990s equivalent of "small interpreter, big
payload". Bullet patterns additionally live as `.STD` bytecode (ReC98).

## Next session plan

1. REA scope pass on `MAIN.EXE` (TH04) — format `dos-mz`, 16-bit x86 real mode.
2. Answer Q1 (bullet pool) by finding the per-frame loop and bullet-slot array.
3. Cross-validate against `nmlgc/ReC98` TH04 sources (read-only).

## REA scope pass on TH04 MAIN.EXE (2026-11-12, session 2)

**Artifact.** `MAIN.EXE`, SHA-256 `592903e9…495a32`, DOS MZ, real-mode x86.
Ghidra: 6 code segments (~150 KB), DATA 34,592 B, **920 procedures**, 72 strings.
Evidence: `ev_d226cc…`, `ev_834a54…` (strings), snapshot
`/mnt/data/rea/touhou/th04-MAIN.EXE.snapshot`.

**String evidence (from the binary itself):**
- `DEMO0.REC` — attract demo is a recorded input replay ⇒ deterministic fixed-step sim
  is an architectural fact (Q3 partially answered; needs code confirmation)
- `0.STD` referenced directly from MAIN.EXE ⇒ stage-enemy bytecode (Q2 partially answered)
- `Borland C++ — Copyright 1993` ⇒ the engine is C++ (BC++ 4.x) + master.lib; the hot
  inner loops are hand-written assembly (per ReC98's `.asm` files)
- 24 spell-card names as plain strings (e.g. `Bad Apple!!`, `Alice Maestra`)
- `GENSOU.SCR`, `0.CDG`, `0.MAP`, `00.mpn`, `GAMEFT.bft` — data-file surface

**Cross-reference (ReC98, read-only):**
- Pool = fixed BSS arrays: TH04 `PELLET_COUNT=180 + BULLET16_COUNT=220` (=400 bullets);
  TH05 `240 + 200` (=440). `bullet_t` ≈ 18 B (TH04: flag/age/motion/group/speed/angle/
  spawn_flag/move_flag/special_motion/patnum…; TH05 adds origin+distance). Pool ≈ 7.2 KB.
- **Behavior as enum, not code**: `bullet_special_motion_t` = decelerate-then-turn(-aimed),
  bounce L/R/T/B, gravity, speedup… — one dispatcher, zero per-bullet objects.
- **Spawn flags as bitfields**, incl. 16 inline "cloud trail" bits (`BSF_CLOUD_*`)
  inside the same 18-byte record — particle system embedded in the bullet struct.
- **Separate render array** `pellet_render_t` (vram_offset + sprite_offset words) —
  sim state decoupled from render state (PC-98 planar VRAM).
- **Adaptive frame budget**: `slowdown.hpp` + `SLOWDOWN_BULLET_THRESHOLD = 24/32` +
  `playperf.hpp` — the game measures live bullet count and *slows the simulation
  rate* instead of dropping frames.
- Hot loops are `.asm` files (`update[bss].asm`, `pellet_r.asm`, `template[bss].asm`);
  `#pragma option -zP` pins code into the exact segments we saw in Ghidra.

**MZ-header math (binary evidence):** load image = 154,722 B (the entire file);
`min_alloc = 2162 paras = 34,592 B` zeroed beyond the image at load = the DATA/BSS
segment REA saw. **Total engine working set ≈ 190 KB** for a full bullet-hell game —
the bullet pool is <4% of it.

## Candidate cards from this scope pass (to be evidence-anchored in REA next)

- **M-2 candidate** (`zero-alloc`): fixed-slot bullet pool, behavior-as-enum, no
  per-frame allocation. Anchor: find pool references + update loop in the binary.
- **M-3 candidate** (`data-as-program`): `.STD` bytecode drives stage enemies; bosses
  hardcoded. Anchor: the STD interpreter in MAIN.EXE.
- **M-4 candidate** (`determinism`): `DEMO0.REC` replay demos. Anchor: input replay
  reader + fixed timestep loop.
- **M-5 candidate** (new family `adaptive`?): measured slowdown instead of frame drops.

## Binary anchoring session (2026-11-12, session 3) — M-2/M-3/M-4

Ghidra snapshot reused (`/mnt/data/rea/touhou/th04-MAIN.EXE.snapshot`). All findings
below carry REA evidence IDs; ReC98 used read-only for naming/orientation.

### M-3 (.STD bytecode) — anchored

- `0.STD` string @ `0x31c61`, referenced from **`FUN_1aaf_0be1` @ `0x1b6d1`**
  (ev_00608d…, decompiled). The loader: builds the filename from the stage number,
  reads the file, then walks **length-prefixed records** — a script-count header
  followed by `[len][payload]` entries — building a **pointer table** into
  `DAT_3134_3d7a[i]` (one entry per enemy script) plus a bytecode stream pointer
  (`DAT_3134_3dba`). Two magic words stored (`0x23a9`, `0x4341`).
- Interpreter (per-frame VM) not yet located — next target.

### M-4 (replay determinism) — anchored, with a limitation

- `DEMO0.REC` @ `0x3152d` has **no static xref** (ev_4dcb72…): ReC98's `demo.cpp`
  explains why — `demo_fn[4] = '0' + demo_num` patches the digit at runtime.
- ReC98 source (read-only): `demo_load()` = `hmem_allocbyte(sizeof(REC<DEMO_N>))` +
  `file_read` — a **fixed-size input-frame recording**; `DemoPlay()` shifts recorded
  inputs into the live input system. Replay determinism is architectural.
- Open: decompile the binary's `demo_load`/`DemoPlay` counterparts (dynamic string
  construction makes byte-search the way in).

### M-2 (bullet pool) — partially anchored

- **`cmp ax,0190h` (=400) × 4 sites** (ev_c0b98d…): 2 in CODE_3 @ `0x23ce8`,
  `0x23d10` = pool-index helpers:
  `slot = (i>>4 + DAT_3134_4278) mod 400` — the 400-slot pool indexed by computed
  4.4-fixed indices, with optional rank-based base offset (`DAT_3134_427c`).
- Stride-based location of `bullets_update` failed: no `sub reg,0x1A` hits —
  my sizeof(bullet_t)=26 arithmetic doesn't match the compiled code (alignment or
  MotionBase layout assumption wrong). Next: pull the true stride from ReC98's
  matching build (their Tupfile generates `.map`/`diff` artifacts) instead of guessing.

### Incidental find — procedural background (candidate M-6)

- CODE_1 @ `0x1b9d6` (`FUN_1aaf_0ee6`, decompiled ev_9a753a…): procedural background
  painter — same `mod 400` constant as the bullet pool but a **bit-packed 400-element
  ring buffer** (`& 7`, `>> 3`, stride `0x20`), conditionally writing `1`s with
  wraparound and a scroll-offset base (`DAT_3134_4260[]`). Matches ReC98's
  `circle.cpp`/`circles[bss].asm` (the TH04 spinning-rings backgrounds).
- Family: `data-oriented` / procedural. Two distinct systems sharing one buffer-size
  constant — a caution for constant-based anchoring: verify semantics, don't assume.

### Method note (added to methodology)

Constant-based function discovery produced false positives here (two different
400-element arrays). Rule: after a constant hit, decompile + semantic-check before
claiming the anchor.
