# Thesis-alignment audit — MarioXP worked example

Date: 2026-11-12. Question: did Target 0 produce learnings that meet the lab's
criteria (hard budget + generalizes + evidence + modern analogue)?

## Verdict: calibration artifact, not yet an efficiency exemplar

| Finding | Meets thesis? | Why |
|---|---|---|
| M-1 Event-program-as-VM | **partial** | The mechanism (small interpreter + behavior-as-data payload + extension modules) is real, generalizes, and has a modern analogue. But MarioXP is a *fan game on a commercial engine* — the "small budget" claim is weak (12.6MB CCA + stock 168KB runtime DLL is not a constraint-forced design). Signal is architecture, not efficiency. Kept as M-1 with status downgraded to `calibration`; expected to be re-tested against TH04/TH05 (`.STD` bytecode under a genuine 640KB budget) where it can become a proper 2-witness card. |
| Save encoding (5 byte transforms) | no | Toy-level obfuscation, not a budget mechanism. Documented as pipeline proof, not cataloged. |
| Hidden INFINITE mode machinery | no | Game-design logic; interesting RE exercise, zero transfer surface. |
| HDI/FAT12 extraction tooling | no (tooling) | Infrastructure, not a mechanism. Recorded for reuse. |

## What Target 0 DID earn

1. **Pipeline validation end-to-end** — decompile protected Clickteam CCA → full event
   decode (13,450 records, 0 leftovers) → Ghidra on carved extension DLLs → resource
   menu extraction from a PE. The loop works.
2. **A calibrator for effort estimation** — Clickteam-era PC games are "small
   interpreter + big payload + extension DLLs"; useful as a *shape* to compare against
   TH04's multi-EXE payload architecture (GENSO1.EXE data blobs + MAIN.EXE + PMD.COM
   driver process).
3. **Method refinements** (folded into methodology): per-target question list written
   before diving; unknowns ledger; evidence quotes mandatory.

## Rule going forward

Targets must satisfy the **budget criterion** honestly: the constraint must have
*forced* the design. Fan games on general-purpose engines don't count as exemplars of
small-budget software; they count as format/calibration exercises.
