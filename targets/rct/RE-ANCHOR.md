# RCT2 re-anchor protocol (written before the binary is available)

**Why this file exists.** The T5A–T5D findings are class `restated +
informed-reconstruction`: anchored on OpenRCT2 (which preserves original
constants, formulas, and `rct2: 0x...` address annotations), never on the shipped
1999/2002 binary. The investor-audit called this the one honesty gap ("zero
hand-waving" fails while this stands). This protocol makes the re-anchor
mechanical and bounded the moment `rct2.exe` is supplied. It also pins what
evidence would *count*, so the upgrade cannot be soft.

**Blocker:** no original RCT2 binary exists on this machine (checked 2026-11-13:
only `/mnt/data/opt/openrct2`, the reconstruction). The original is commercial
software — REA policy: we do not fetch it; the operator supplies `rct2.exe`
(v1.20.013 or similar retail build) + `Data/` + `ObjData/`.

## What each finding needs from the binary

| finding | claim | re-anchor evidence required (class `measured`) |
|---|---|---|
| T5A guest generation | per-tick stochastic roll `ScenarioRand() & 0xFFFF < guestGenerationProbability`; target rate formula (park rating + guest-happiness coupling) | locate `rct2: 0x0069A05D` (OpenRCT2's annotation) in the binary; disassemble the roll; extract the two constants feeding the comparison; confirm the branch polarity |
| T5B pathfinding | single-peep bounded DFS, step limits, direction heuristics | locate the pathfinding entry (OpenRCT2 annotates it); confirm the DFS bound constants and the heuristic's shape in assembly |
| T5C economy | ride value = f(excitement, intensity, nausea) with age-decay table + duplicate penalty; guest spend thresholds | locate ride-value computation; extract the decay table bytes from `.data`/`.rdata` and diff against OpenRCT2's copy |
| T5D (see file) | (same pattern: constant + formula extraction at the annotated address) | (same) |

## Method (REA, bounded)

1. `rea open_binary rct2.exe` (PE32, Ghidra auto-analysis). Bound the session to
   the four annotated addresses — this is a verification pass, not a re-RE.
2. For each anchor: `rea_search_procedures`/xref from the address (OpenRCT2's
   annotations are the map), `rea_procedure_pseudo_code`, extract constants with
   `rea_list_strings`/data reads.
3. Evidence = address + bytes + disassembly snippet per constant; diff against
   OpenRCT2's annotated formula.
4. Verdict per finding: `measured` if the binary constants + structure match the
   reconstruction's claims; **contradicted** if they differ (that would be a
   result too — OpenRCT2 divergence documented); `restated` stands if the binary
   cannot be obtained (no silent downgrade).

## Honesty note

Until the binary is supplied, T5A–T5D remain `restated` and any pitch sentence
built on them must say so in the same breath. The protocol's existence is the
difference between "we intend to" and "we know exactly what evidence closes it."
