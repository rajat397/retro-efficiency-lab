### M-14 Range-intersection attribution (no registry) (attribution)

**Mechanism.** VMAP decides which memory block "hooked" an interrupt vector by **intersecting the
Interrupt Vector Table's segment words with the segment range of each block it has already
enumerated** — a vector is attributed to a block iff `block_start <= ivt_segment < next_block_start`.
No per-block hook registry exists, none is consulted, and no OS API is asked, because DOS exposes
none: the attribution is *derived* from two tables the tool already holds (the IVT at `0000:0000`
and the arena chain), rather than *recorded* at hook time.

**Witnesses.** `VMAP.COM` (1991 DOS memory-map utility, original binary, 3,173 bytes) —
`FUN_1000_0570` at flat `0x10570` (segment offset `0x0570`, file offset `0x0470`), called from the
conventional-memory walk `FUN_1000_0247` (`0x10247`) once per enumerated block, after the block's
row and owner column have been printed by `FUN_1000_039e` (`0x1039e`) and `FUN_1000_03f5`
(`0x103f5`). Single witness (one target); the transfer test in step 4 is a 2026-stack port, not a
second witness.

**Evidence.** *(all `traced`, static analysis of the original binary; the binary was never executed)*

* The scan — `rea function --procedure 0x10570`, assembly facet, verbatim:

  ```
  0x10576: MOV DX, ES          ; ES = 0  -> the IVT lives at 0000:0000
  0x10578: MOV BX, word ptr [BP + 0x4]   ; block's own segment
  0x1057b: MOV DX, word ptr [BP + 0x6]   ; next block's segment (exclusive bound)
  0x1057e: MOV DI, 0x2         ; segment word of IVT entry 0
  0x10581: MOV CX, 0x100       ; 256 vectors
  0x10584: MOV AX, word ptr ES:[DI]
  0x10587: ADD DI, 0x4
  0x1058a: CMP AX, BX
  0x1058c: JC 0x1000:0592
  0x1058e: CMP AX, DX
  0x10590: JC 0x1000:0595      ; <- attributed to this block
  ```

* The two bounds are the *same* numbers the map prints for the block: `+0x4` is the block's own
  segment (`0x1025f`), `+0x6` is the segment of the next block, obtained by stepping over the
  block header (`0x105bf`: `ADD DX, 0x3(%di)` / `INC DX` / `MOV DS, DX`). No hook table exists in
  the artifact: the whole interrupt inventory is `INT 21h` (version, scratch allocation, DIB
  pointer, stdout, exit), `INT 67h` (EMS), and two `INT 2Fh` calls that are the XMS entry-point
  probe (`0x1070c`, `0x10715`) — nothing asks "which vectors does this program hook", because
  nothing can.
* Output shape: pad to output column 49 (`0x105a7: MOV AX, 0x31`), then one `" %02x"` per hooked
  vector (format string at flat `0x10b49`, bytes `20 25 30 32 78 00`), vector number computed as
  `0x100 - CX` (`0x105ad`/`0x105b0`), ten per line then a newline (`0x1059c: CMP AL, 0xa`).
  Column header at flat `0x10a48`: `"…owner/parameters           hooked vectors\r\n"`.
* The column is emitted only for rows whose owner column did not already claim the slot
  (`0x1029b: CMP byte ptr [BP + 0x36], 0x0`): free/DOS-owned blocks show no vectors, program-owned
  blocks do — a deliberate column budget, not an accident.
* Supporting observation from the same binary (same witness, same file): VMAP **validates the
  integrity of the arena before reporting on it**. The chain walk rejects any link whose signature
  byte is neither `'M'` nor `'Z'` (`0x105c8`) and aborts with the literal
  `"*** Memory Arena Trashed!"` (flat `0x10ade`, bytes `2a 2a 2a 20 4d 65 6d 6f 72 79 …`). The
  tool refuses to print a map it cannot vouch for.
* Full constants, addresses, verbatim quotes and open questions: `targets/vmap/notes-vmap.md`.
  Transfer test: `catalog/transfer-tests/M-14-range-intersection-attribution/`.

**Generalization.** The modern shape of the mechanism is *deriving ownership from the dispatch
table you already read, instead of maintaining a registry of who registered what*. Concretely it
applies wherever a system exposes (a) a global table of handler addresses — an IVT, a signal
dispatch table, a kernel hook list, a route table, an event-bus subscriber array, a plugin
registry, a `SIGxxx` handler vector — and (b) an enumeration of the address ranges or registration
ranges of the components you want to attribute:

* attribute a handler to the module that *physically contains its code* by intersecting the table
  with the module's range — no per-module bookkeeping, no registration API, and it works for
  handlers installed out-of-band (a native addon, a loader, an instrumentation layer, a debugger);
* report *dangling* handlers explicitly — a table entry that falls in no enumerated range is a
  handler owned by nobody you can free, which is exactly the failure a memory map exists to catch;
* keep the two sources separate: the enumeration supplies ranges, the dispatch table supplies
  targets, and the intersection is the join — which means the join is recomputed on demand and
  cannot go stale relative to the live table.

The transfer test ports the algorithm verbatim (256-entry table, half-open segment ranges,
`start <= seg < end`) to a 2026 stack and measures it against a registration-registry baseline.

**Costs.**

* **It attributes by address, not by intent.** A handler installed by module X but whose code lives
  in another module's range (a shared dispatcher, a trampoline, a proxy, a JIT stub) is reported
  as belonging to the block that holds the code, not to X. For VMAP's purpose that is the *correct*
  answer — the question a memory map answers is "which block do I have to keep alive for this
  vector" — but it is the opposite of "which module installed this hook". Any modern port must
  decide which question it is answering; the mechanism answers the physical one.
* **Granularity.** The comparison is on the *segment* (64 KB in real mode). Two modules in one
  segment are indistinguishable, and every handler in that segment is attributed to whichever block
  owns the segment. On a flat 64-bit stack the equivalent granularity is the mapping, not the
  function — an entire shared library or JIT-code range collapses to one owner.
* **Cost is O(vectors × blocks)** comparisons — 256 × blocks here, paid once per block. A registry
  is O(1) per lookup and O(hooks) writes to maintain, so the intersection is the *more* expensive
  strategy when every hook provably goes through one API. The mechanism earns its keep only when
  hooks can be installed out-of-band, which DOS guarantees and modern platforms do not.
* **It needs exact, live ranges.** If the enumerated ranges are stale (a freed block whose range
  was reused, a module unloaded without a notification) the attribution silently points at the
  wrong owner — the mechanism has no way to detect that on its own.
* **Unattributable handlers are invisible.** A vector whose target lies outside every enumerated
  range (a BIOS/RT handler, a kernel handler, a handler in an arena the tool did not walk) is
  attributed to nobody. VMAP's UMB path exists for the same reason: conventional-memory
  intersection alone would miss every UMB-resident TSR.
* **The tool perturbs what it measures.** VMAP allocates 64 KB of scratch (`INT 21h AH=48h`,
  `BX=0xffff`) *before* walking the arena, so the map it prints includes its own allocation. The
  mechanism is read-only with respect to the *dispatch table*, but not with respect to the *arena*.
* **Block-header layout knowledge is baked in.** The chain walk depends on undocumented offsets
  (owner at `+1`, size at `+3`, tag at `+8` — see `targets/vmap/notes-vmap.md` C14). The
  intersection itself only needs the two range bounds, but the enumeration that produces them is
  version-sensitive, and the code branches on the DOS version to cope.

**Status.** single-witness
