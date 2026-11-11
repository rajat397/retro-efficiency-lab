# Target 0 — Super Mario XP (worked example)

Status: **complete** (2026-11-12). Purpose: prove the pipeline end-to-end and calibrate
the evidence-card format. Full analysis artifacts: `/mnt/data/rea/MarioXP/`.

## What it is

Super Mario XP v1.21 (May 2003), Japanese freeware Mario × Castlevania hybrid by "AEGIS"
(CnC Darkside community). Built in **Click & Create 1.x** (Clickteam): `MarioXP_0121.exe`
is a stock runtime shell; **the entire game lives in `MarioXP_0121.cca`** (PAME magic,
build 519, editor-protected, 72 frames, 8-bit).

## Findings (summary)

1. **Editor-protection was reversed and the whole project recovered.** KlikBack
   decompiled the protected CCA → 72 frames, events, artwork references, and carved
   **5 extension modules** (`iniplus`, `CDisplayX`, `kcwnd`, `filecode`, `WinCon`).
2. **Save encoding fully reversed** (Ghidra on `filecode.COX`): five trivial byte
   transforms selected per action — NOT (`~in[i]`), ADD (`in[i] + i%256`), SUB,
   SUB-IDX, SUB-KEY (`in[i] - K`). Later confirmed against the extension's own
   resource menus ("Byte Shift / Byte Inversal / Byte Incremental / Custom Encode").
3. **Full event-program decode**: wrote a CnC1/TGF1 event-format decoder
   (`/mnt/data/rea/MarioXP/tools/cnc_events.py`); 13,450 events across 72 frames,
   zero parse leftovers.
4. **Hidden INFINITE mode mapped**: dying in stage 6-5 warps into arena 8-1 instead of
   game-over; arena pipes warp by `GV#10` into late levels of stages 2–6 or to the
   endless Bowser loop (8-2 → death → back to 8-1 with Lives=5); every playable level
   carries a death-net (Lives:=5, Score:=10, jump to `GV#3` = Opening → stage select)
   when `GV#1 == 1`.

## Mechanism cards extracted

### M-1 Event-program-as-VM: data-driven game logic (`data-as-program`)

**Mechanism.** The entire game (72 frames, 13,450 events, all level logic) is a
bytecode-like event program stored in a data file, interpreted by a stock 168KB runtime
DLL — game-specific code is ~zero; all behavior is data.

**Witnesses.** MarioXP (this target); SCUMM targets (queued) use the same shape.

**Evidence.** CCA hexdump `PAME` header at 0x0; event decoder parsed 13,450 records
with 0 leftover bytes across 72 frames (`cnc_events.py` run log); runtime shell imports
`CNCS32.dll` + reads `.cca` (strings evidence).

**Generalization.** Server-driven UI / rules-as-data on modern stacks: the app is a
fixed interpreter; behavior ships as payload. Directly applicable to plugin systems and
game mods.

**Costs.** Data-driven logic is opaque to static analysis (our hidden-mode hunt required
writing a full event-format decoder); debugging without the editor is painful.

**Status.** calibration (weak budget claim — see ASSESSMENT.md; expected to become a proper card via TH04/TH05 `.STD` bytecode).

## Artifacts

- Extracted + decompiled CCA: `/mnt/data/rea/MarioXP/decompile/`
- Ghidra snapshots: `filecode.COX.snapshot`, `CNCS32.DLL.snapshot`
- Event dumps: `all.events.txt`, `8-1.events.txt`, `8-2.events.txt`
- Tools: `tools/cnc_events.py`, `tools/expr.py`
