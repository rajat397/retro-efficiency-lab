# Target 2 — Doom (id Tech 1, 1993)

Status: **witnessed** (2026-11-12)

## Witness authority

Official id Software source release (`github.com/id-Software/DOOM`, `linuxdoom-1.10`,
cloned to `/mnt/data/opt/doom`) — the shipped engine's own code, so witnesses are
historical-reference authority rather than fresh binary decompiles. Binary anchoring
of `DOOM.EXE` (dos-mz, same loader family as TH04) is possible later if needed.

## Question list status

1. Determinism / replay — **witnessed**: demo = 4 bytes/tic input stream
   (`G_ReadDemoTickers`, d_main.c:1493), `DEMOMARKER 0x80` sentinel, fixed 35 Hz
   (`TICRATE`), `fixed_t` Q16.16 (`m_fixed.h`).
2. Data vs code — witnessed: state machine behaviors in `mobjinfo_t.states[].action`
   function-pointer tables (info.h:1153), dispatched at transitions
   (p_mobj.c:76–78); thinkers dispatched via `function.acp1` (p_tick.c:101–121).
3. Memory — witnessed: tagged zone allocator (M-8 card).
4. Math — witnessed: LUT trig (M-9 card).

## Cards fed

- M-4 replay determinism → **cataloged** (second witness)
- M-7 function-pointer composition → **cataloged** (second witness)
- M-8 zone allocator → new, single-witness
- M-9 LUT trig → new, single-witness
