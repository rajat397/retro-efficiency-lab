### M-1 Event-program-as-VM: behavior as a data payload (`data-as-program`)

**Mechanism.** The entire application (all frames, levels, and logic) is a bytecode
event program stored in a data file, interpreted by a small fixed runtime — game-
specific code is ~zero; behavior ships as payload.

**Witnesses.**
- MarioXP (Click & Create 1.x, 2003): 72 frames / 13,450 events / zero leftover bytes
  in `MarioXP_0121.cca`; runtime shell `MarioXP_0121.exe` (448 KB) + `CNCS32.DLL`
  (168 KB, 1998).
- TH04 `MAIN.EXE` (1998): stage-enemy scripts as `.STD` bytecode + a function-pointer-
  dispatched VM (see M-3) — same shape under a genuine 640 KB-era budget.

**Evidence.** CCA `PAME` header; event decoder parsed 13,450 records with 0 leftovers
(`/mnt/data/rea/MarioXP/tools/cnc_events.py`); runtime imports `CNCS32.dll` and reads
the `.cca`. TH04 side: `0.STD` string @ `0x31c61`, loader `FUN_1aaf_0be1` @ `0x1b6d1`.

**Generalization.** Server-driven UI / rules-as-data / plugin systems: ship a fixed
interpreter, put behavior in payload. Plugins and patches become data, not code.

**Costs.** Data-driven logic is opaque to static analysis (the MarioXP hidden-mode
hunt required writing a full event-format decoder); debugging without the original
editor is painful; the VM becomes the performance ceiling.

**Status.** calibration (weak budget claim in MarioXP alone; expected to become
`cataloged` via M-3's TH04/TH05 pair).
