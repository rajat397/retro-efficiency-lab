# Probe contract — VMAP.COM

Filled from `docs/templates/probe-contract.md` **before** evidence collection for the
mechanism claims (runbook step 1). Written by the cold-run engineer (no prior exposure
to this repo's mechanism cards).

- **Target + artifact**: `VMAP.COM` — DOS `.COM` executable, 3,173 bytes, 16-bit x86
  real mode. SHA-256 `1ded169f4a2365be734bd06a092d5e23990e1778e357049af1501105c95376a7`.
  Path (not committed): `/mnt/data/rea/touhou/th04e-files/VMAP.COM`.
  **Authority tier: original-binary.** The artifact is the shipped 1989–91 binary
  (`VMAP Version 2.01  Copyright (C) 1989-91 by c.mos`, string @ `0x10c8a`); no public
  reconstruction of this tool is used, so every load-bearing claim below rests on
  original-binary evidence only.
  Note: this file ships in the Touhou TH04 disk set but is **not** Touhou code — it is a
  third-party DOS memory-map/manager utility that the game disk carries. Treating it as
  "TH04 code" would be wrong; it is an independent 1991 DOS tool, which makes it a clean
  single-artifact witness.

- **Depth budget**: ≥ 90 minutes wall time; ≥ 25 REA tool invocations; ≥ 6 functions
  decompiled to pseudocode; ≥ 8 assembly reads for the anchor procedures; ≥ 10 constants
  extracted, each with address + verbatim quote. Results below this budget are regraded
  `preliminary`.

- **The surprise target**: **how VMAP decides which interrupt vectors a resident
  memory block has "hooked"** — and specifically the hypothesis that it *derives* the
  attribution by intersecting the interrupt-vector table's current targets with each
  block's segment range, rather than reading any per-block hook registry (no such
  registry exists in DOS).
  *Falsifiable form:* "VMAP computes the `hooked vectors` column by comparing the
  segment values in the interrupt vector table against the address ranges of the memory
  blocks it enumerated, and reports a vector for a block iff the IVT entry points into
  that block's range."
  *Surprise-bar check:* the Interrupt Vector Table itself is textbook/wikipedia
  knowledge; the *attribution-by-range-intersection* trick is not — no documented API
  exposes "which vectors does this TSR hook", and it appears on neither page 1 of this
  repo's docs (`README.md`, `catalog/README.md`) nor in the lab's existing families
  (`determinism`, `zero-alloc`, `data-as-program`, `procedural`, `streaming`, `format`,
  `lut`, `adaptive`, `spatial`, `sched`).
  *Honest caveat:* this is a **hypothesis at contract time**, not a finding. It was
  derived from a string-only triage (see *Deviations* below) and may be refuted by the
  evidence. If it is refuted, the contract is amended in the same commit with the
  amendment recorded, and the card states which surprise target actually held.

- **Evidence class sought**: `traced` for every binary-side claim (static analysis only —
  the binary must not be executed, so no `measured` claim can be made *about VMAP
  itself*). `measured` is claimed only for the 2026-stack transfer test (step 4),
  where the bench executes.
  No claim in this target may be `restated`.

- **Repro command** (for measured): the transfer-test bench,
  `node catalog/transfer-tests/M-14-range-intersection-attribution/bench.mjs`, run from its own
  directory; it exits 0 and prints a single `VERDICT:` line containing the deterministic
  counters (hashes / counts / bounds), not wall-clock. *(slug fixed at step 4; the placeholder
  `<slug>` above is the only amendment made to this line.)*

- **Verifier**: a second agent, not the author. The verifier re-runs the repro command
  and checks that the anchors **SUPPORT** the claim, not merely exist — i.e. for each
  quoted constant, the verifier must confirm the quoted bytes exist at the quoted
  address in the original artifact (SHA-256 `1ded169f…`) and that the surrounding
  instruction/dispatch supports the asserted semantics.

## Per-target question list (3–5), with depth class assigned BEFORE evidence

| # | Question | Depth class | Anchor sought |
|---|---|---|---|
| Q1 | What structures does VMAP walk to enumerate conventional-memory blocks, and how is the chain anchored? | `traced` | the enumeration loop + its base pointer / scan |
| Q2 | How is the `hooked vectors` column computed for each block? | `traced` | the comparison against the vector table |
| Q3 | Which interrupt vectors / segment bases / block sizes appear as constants, and what do they mean? | `traced` | address + verbatim quote for each |
| Q4 | Does VMAP obtain ownership data from documented DOS/EMS/XMS APIs (`INT 2Fh`), from raw memory structures, or both? | `traced` | the actual interrupt invocations and the memory reads |
| Q5 | Does the 2026-stack port of Q2 reproduce the claimed property (attribution correctness) against a naive baseline? | `measured` | transfer-test bench counters |

## Deviations from the runbook, logged as they happen

- **D1 (step 1, triage before contract).** The runbook says to pick the suspect
  behavior and assign depth classes *before any evidence is collected*. Picking a
  suspect behavior at all requires knowing what the program does, so a **string-only**
  triage was run first (REA `search --kind strings`, 18 strings, no code read, no
  pseudocode). The contract's *surprise target* is a hypothesis derived from that
  triage, not from any code. No `traced`/`measured` evidence existed when the classes
  were assigned. A stricter reading of "no evidence before the contract" would have
  required picking the mechanism blind, which is not workable; the next best honest
  reading — triage cheap enough that it cannot contain the answer — is used here.

- **D2 (step 2, tooling — `rea xrefs` blind spot).** `rea xrefs` on the *ram-space* string
  addresses (`0x10a48` = the `hooked vectors` header, `0x10c8a` = the banner) returned an
  **empty** reference list. Reason: the COM image is loaded at PSP+0x100, so the code's
  operands are *segment-relative* (`MOV SI, 0xa48`), and Ghidra's data references live in the
  segment-relative address space, not in the flat `ram` space the string inventory reports.
  The references were therefore located by reading the assembly of the procedures that
  contain the loads (`0x10129: MOV SI, 0xa48`). **Consequence for the runbook:** any step that
  says "find the function that uses this string" needs the *segment-relative* address, and
  `rea search --kind strings` alone is not enough. Also note `rea search` rejects an empty
  pattern, so "list all strings" needs a regex such as `--pattern "." --mode regex`.

- **D3 (step 2, tooling — cost shape).** The CLI has no "dump every procedure" verb; each
  `rea function` call re-imports the binary into Ghidra (~25 s), and the harness kills
  background jobs when a tool call returns. The runbook's "locate the 3–5 functions behind
  the behavior" is therefore enforced by tooling cost, not by discipline: I first located the
  candidate procedures with a full-file `objdump -b binary -m i8086 --adjust-vma=0x10100`
  disassembly (a cross-check, **not** a fork and not an execution of the target), then
  re-read the four anchor procedures through REA so every load-bearing claim is REA-attested
  (`entry` `0x10100`, `FUN_1000_017b` `0x1017b`, `FUN_1000_0247` `0x10247`,
  `FUN_1000_0570` `0x10570`). Byte-level quotes for the data constants come from
  `rea read-bytes`. The runbook does not mention this cost, which materially changes how the
  "half day" of step 2 should be spent.

- **D4 (step 2, depth budget).** The budget above asks for "≥ 8 assembly reads for the anchor
  procedures". Only four anchor procedures exist for this behavior, and REA's `function`
  dossier returns the **whole** procedure's assembly in one call; the eighth read was spent on
  `rea read-bytes` calls for the eight data constants (C1–C15 in
  `targets/vmap/notes-vmap.md`). The budget is met in *invocations* (≥ 25 REA invocations) and
  in constants (≥ 10, each with address + verbatim quote) but not in "assembly reads" as
  literally worded.

- **D5 (step 3, catalog surface).** The mechanism does not fit any of the eleven families
  listed in `docs/methodology.md` / `catalog/README.md` (it is not determinism, zero-alloc,
  data-as-program, procedural, streaming, format, lut, adaptive, spatial, sched,
  budget-portability or erlang-capacity). I added the family **`attribution`** to
  `catalog/README.md` (additive) rather than force a bad fit. The runbook should say what to
  do when a mechanism does not fit the existing families.

- **D6 (step 4, metric choice).** The runbook lists example metrics "allocation counts,
  hashes, backlog bounds, throughput ratio". The original mechanism makes **no** timing claim,
  so a throughput ratio would be noise. The bench therefore measures deterministic counters
  only — accuracy against physical containment, the exact comparison count
  (`vectors × blocks`), registry writes, allocations, and a pinned SHA-256 of the attribution
  table — and says so on the `VERDICT:` line. No wall-clock number is printed anywhere.

- **D7 (step 2, notes file name).** The notes are in `targets/vmap/notes-vmap.md`, not
  `targets/vmap/findings*.md`, purely so the file cannot be confused with the other targets'
  findings files (which this run is forbidden to read).

## Outcome (end of step 2 — the surprise target HELD)

**The surprise target HELD.** The falsifiable form written above is confirmed by the code, not
refuted: VMAP computes the `hooked vectors` column by intersecting the Interrupt Vector Table's
**segment words** with each block's **segment range**.

The routine is `FUN_1000_0570` at flat `0x10570` (segment offset `0x0570`, file offset `0x0470`):

```
0x10576: MOV DX, ES          ; ES = 0  -> the IVT at 0000:0000
0x10578: MOV BX, word ptr [BP + 0x4]   ; this block's own segment
0x1057b: MOV DX, word ptr [BP + 0x6]   ; next block's segment (exclusive bound)
0x1057e: MOV DI, 0x2         ; segment word of IVT entry 0
0x10581: MOV CX, 0x100       ; 256 vectors
0x10584: MOV AX, word ptr ES:[DI]
0x10587: ADD DI, 0x4
0x1058a: CMP AX, BX
0x1058c: JC 0x1000:0592
0x1058e: CMP AX, DX
0x10590: JC 0x1000:0595      ; <- vector attributed to this block
```

Three refinements to the contract's wording, all in the card:

1. The comparison is on the **segment word** of each IVT entry (the offset word at `+0` of the
   entry is ignored), so the test is 64 KB-granular.
2. The upper bound is the **next block's** segment, i.e. the range is half-open
   `[block_start, next_block_start)`.
3. The column is only printed for blocks whose owner column did not already consume the slot
   (free / DOS-owned blocks show no vectors) — a column-budget decision at `0x1029b`.

The card (`catalog/mechanisms/M-14-range-intersection-attribution.md`) states that the
**range-intersection** surprise target is the one that held. A secondary finding in the same
binary — the arena chain-integrity check that aborts with `"*** Memory Arena Trashed!"`
(`0x10ade`) — is reported as a *supporting observation inside the same witness*, not as a second
witness, so the card's status stays `single-witness`.
