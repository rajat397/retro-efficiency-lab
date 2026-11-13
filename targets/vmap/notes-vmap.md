# VMAP.COM — extracted constants and anchors (runbook step 2)

**Artifact.** `VMAP.COM` — DOS `.COM` executable, 3,173 bytes, 16-bit x86 real mode.
SHA-256 `1ded169f4a2365be734bd06a092d5e23990e1778e357049af1501105c95376a7`.
Authority tier: **original-binary**. Static analysis only — the binary was never executed.

**Address conventions (verified with REA `address-to-file-offset`).**

| form | meaning | conversion |
|---|---|---|
| REA "ram" flat address (`0x10xxx`) | the COM image as loaded | `flat = 0x10100 + file_offset` (the COM body is loaded at PSP+0x100) |
| segment-relative offset (`0x0xxx`) | what the code's operands actually hold (`MOV SI, 0xb49`) | `seg = flat - 0x10000` |
| file offset | byte offset in the artifact | `file_offset = seg - 0x100` |

Verified: `address-to-file-offset 0x10570 → 1136 (0x470)`; `address-to-file-offset 0x10c8a → 2954 (0xb8a)`.

Every constant below is given as **flat address + segment offset + file offset** plus a **verbatim
quote** of the bytes or the instruction that carries it. REA `read-bytes` output is quoted as the
exact `bytes_hex` string it returned.

---

## C1 — The hooked-vector scan: read the IVT segment word (flat `0x10584`, seg `0x0584`, file `0x0484`)

Verbatim instruction (`rea function --procedure 0x10570`, assembly facet):

```
0x10584: MOV AX, word ptr ES:[DI]
```

`ES` was zeroed at `0x10576` (`MOV DX, ES` after `XOR DX, DX` at `0x10570`), so this reads the
Interrupt Vector Table at **`0000:0000`** — the one global table of handler addresses DOS exposes.
The word read is the **segment** of the handler (the IVT entry is `offset:segment`; the segment
word sits at `+2` inside each 4-byte entry).

## C2 — IVT entry stride = 4 bytes, 256 entries (flat `0x10587`/`0x10581`, seg `0x0587`/`0x0581`)

```
0x10581: MOV CX, 0x100
0x10587: ADD DI, 0x4
```

`DI` starts at `0x2` (`0x1057e: MOV DI, 0x2`) — i.e. the *segment* word of IVT entry 0 — and strides
by 4. So the loop visits all **256** interrupt vectors, reading `0000:0002, 0000:0006, … 0000:03FE`.

## C3 — The attribution test is a half-open segment-range intersection (flat `0x1058a`/`0x1058e`)

```
0x1058a: CMP AX, BX
0x1058c: JC 0x1000:0592
0x1058e: CMP AX, DX
0x10590: JC 0x1000:0595
```

`BX = word ptr [BP + 0x4]` (`0x10578`) and `DX = word ptr [BP + 0x6]` (`0x1057b`) are the **block's own
segment** and the **next block's segment**. The test is therefore
`block_start <= ivt_segment < next_block_start` — a *range* test on the segment, with the next
block's segment as the exclusive upper bound.

## C4 — The two range inputs come from the block chain, not from a hook table (flat `0x1025f` / `0x102fa`)

```
0x1025f: MOV AX, 0x4(%bp)      ; (see 0x1025d: MOV AX, DS)  -> block's own segment
0x102fa: MOV DS, 0x6(%bp)      ; -> next block's segment (exclusive upper bound)
```

The next segment is computed by stepping over the block header (`0x105bf`):

```
0x105bf: MOV DX, DS
0x105c1: ADD DX, 0x3(%di)      ; + size (paragraphs)
0x105c4: INC DX                ; + 1
0x105c5: MOV DS, DX
```

So the "hooked vectors" column is computed from the **same two numbers the map already prints** for
each block — no per-block registry of hooks exists anywhere in the binary.

## C5 — The column starts at output column 49 (flat `0x105a7`, seg `0x05a7`, file `0x04a7`)

```
0x105a7: MOV AX, 0x31
0x105aa: CALL 0x1000:08b5
```

`0x31` = 49 decimal. `FUN_1000_08b5` (`0x108b5`) is a column-pad routine: it compares the output
cursor `0x12(%bp)` against `AX + 0xda5` and emits spaces until the cursor reaches column 49.
The header's last column starts there (see C6).

## C6 — The column header (flat `0x10a48`, seg `0x0a48`, file `0x0948`)

Verbatim `rea read-bytes 0x10a48 --length 24` → `bytes_hex`:
`0d0a61646472205053502020626c6b7320202073697a6520`

which decodes to the string

```
\r\naddr PSP  blks   size  owner/parameters           hooked vectors\r\n---- ---- ---- ------  -------------------------  -----------------------------\r\n
```

## C7 — Per-vector output format: hex vector number, two digits (flat `0x10b49`, seg `0x0b49`, file `0x0a49`)

Verbatim `rea read-bytes 0x10b49 --length 24` → `bytes_hex`:
`2025303278002d2d2d20554d4220746f74616c3a25346420`

→ `" %02x"` (then `"--- UMB total:%4d KB ---"` follows at `0x0b4f`).

The value printed is the vector number, computed as `0x100 - CX`:

```
0x105ad: MOV AX, 0x100
0x105b0: SUB AX, CX
```

`CX` is the LOOP counter, so vector 0 prints `00`, vector `0x1a` prints `1a`.

## C8 — Ten vectors per line, then a newline (flat `0x1059c`/`0x105a0`)

```
0x1059c: CMP AL, 0xa
0x1059e: JNZ 0x1000:05ad
0x105a0: MOV byte ptr [BP + 0x32], 0x0
0x105a4: CALL 0x1000:0836      ; newline
```

`0x10836` prints `"\r\n"` (string at seg `0x0adb`: bytes `0d 0a 00`, file offset `0x09db`).
The per-block counter lives at `[BP + 0x32]` and is zeroed at `0x10572` at the start of every block.

## C9 — The hooked-vectors column is only printed for rows whose owner column did not claim the slot (flat `0x1029b`)

```
0x1029b: CMP byte ptr [BP + 0x36], 0x0
0x1029f: JZ 0x1000:02a4
0x102a1: CALL 0x1000:0570
```

`[BP + 0x36]` is set to 1 at `0x10259` and cleared at `0x1041b`, i.e. right after the owner column
printed one of the "simple" labels (`<free>`, `<config>`, `<buffers>`). So free/DOS-owned blocks show
no vectors, program-owned blocks do.

## C10 — The five DOS-area labels, matched by one byte (flat `0x10c4f`, seg `0x0c4f`, file `0x0b4f`)

Verbatim `rea read-bytes 0x10c4f --length 24` → `bytes_hex`:
`4658424c535e0c660c6d0c770c810c3c66696c65733e003c`

→ the 5-byte match table is `"FXBLS"` (`0x0c4f`–`0x0c53`), immediately followed by the 5-word
label-offset table at `0x0c54`:

| table byte | offset | label (flat address) |
|---|---|---|
| `F` (0x46) | `0x0c5e` | `<files>` (flat `0x10c5e`) |
| `X` (0x58) | `0x0c66` | `<fcbs>` (flat `0x10c66`) |
| `B` (0x42) | `0x0c6d` | `<buffers>` (flat `0x10c6d`) |
| `L` (0x4c) | `0x0c77` | `<lastdrv>` (flat `0x10c77`) |
| `S` (0x53) | `0x0c81` | `<stacks>` (flat `0x10c81`) |

Lookup code (flat `0x10494`):

```
0x1049d: MOV DI, 0xc4f
0x104a0: MOV CX, 0x5
0x104a3: REPNZ SCAS ES:(DI), AL
0x104a7: SHL CX, CX
0x104a9: MOV SI, 0xc5c
0x104ac: SUB SI, CX
0x104ae: MOV (SI), SI
```

## C11 — The owner-label strings (flat `0x10afd`, `0x10b04`, `0x10b0d`)

| flat | seg | verbatim bytes | string |
|---|---|---|---|
| `0x10afd` | `0x0afd` | `3c 66 72 65 65 3e 00` | `<free>` |
| `0x10b04` | `0x0b04` | `3c 63 6f 6e 66 69 67 3e 00` | `<config>` |
| `0x10b0d` | `0x0b0d` | `63 6f 6d 6d 61 6e 64 00` | `command` |

`"<free>"` is the default owner label (`0x103fa: MOV SI, 0xafd`); `"<config>"` is used when the
block's owner segment is 8 (DOS) (`0x10406: MOV SI, 0xb04`); `"command"` is used when the owner is
the COMMAND.COM PSP (`0x10460: MOV SI, 0xb0d`).

## C12 — "Memory Arena Trashed": the chain-integrity abort (flat `0x10ade`, seg `0x0ade`, file `0x09de`)

Verbatim bytes at flat `0x10ade`: `2a 2a 2a 20 4d 65 6d 6f 72 79 20 41 72 65 6e 61 20 54 72 61 73 68 65 64 21`
→

```
*** Memory Arena Trashed!
```

Printed at `0x101dd`/`0x101e0` when the walk fails: the block-signature check at `0x105c8`
(`CMPB $0x4d,(%di)` / `CMPB $0x5a,(%di)`) rejects a link, or the chain runs past `0xf000`
(`0x10225: CMP AX, 0xf000`). **VMAP validates the integrity of the arena it is about to report on
before trusting it.**

## C13 — The arena is read from raw memory, not through an API (flat `0x1018b`–`0x101af`)

```
0x1018b: MOV AX, ES:[0xba]
0x1018f: MOV AX, 0xc(%bp)
0x10192: MOV AH, 0x52
0x10194: INT 0x21
0x10196: MOV AX, ES:-0x2(%bx)
0x101a1: MOV AX, 0xe(%bp)
0x101a8: MOV AX, 0x2c(%bp)
0x101af: MOV AX, 0x2e(%bp)
```

`INT 21h AH=52h` ("DOS allocation information") returns `ES:BX` = the DOS Information Block at
`0000:0004`; the code then reads the fixed low-memory words `0000:0002` (first block segment),
`0000:0012`, `0000:0016`, `0000:0018` directly. The **entire interrupt inventory** of the binary is:

| interrupt | where | purpose |
|---|---|---|
| `INT 21h AH=30h` | `0x1011e` | DOS version → `[BP+0x30]` |
| `INT 21h AH=48h` | `0x10180` | allocate 64 KB (`BX=0xffff`) as scratch — **the tool perturbs the arena it maps** |
| `INT 21h AH=52h` | `0x10194` | DOS allocation information (DIB pointer) |
| `INT 21h AH=40h` | `0x1082c` | write to stdout |
| `INT 21h AH=4Ch` | `0x1013e` | exit |
| `INT 21h AX=3567h` | `0x106c2` | locate the EMS device driver (`"EMMXXXX0"`, flat `0x10b68`) |
| `INT 67h` | `0x106d5`,`0x106dd`,`0x106ee`,`0x1079a`,`0x107c0` | EMS version / handle list |
| `INT 2Fh AX=4300h/4310h` | `0x1070c`,`0x10715` | XMS detection only |

**There is no `INT 2Fh` handler-registry query and no API that answers "which vectors does this
program hook"** — the two `INT 2Fh` calls are the XMS entry-point probe, nothing else.

## C14 — The block header fields VMAP reads (flat `0x102b1`, `0x102bf`, `0x102fd`, `0x102e5`)

```
0x102b1: MOV AX, 0x1(%di)      ; owner (word)
0x102bf: MOV CX, 0x3(%di)      ; size in paragraphs (word)
0x102fd: MOV DX, 0x1(%di)
0x102e5: CMPB $0x5a,(%di)      ; signature byte 'Z' = end of chain
0x10279: CMPW $0x8,0x1(%di)    ; owner == 8 (DOS)
0x1027f: CMPW $0x4453,0x8(%di) ; two-char tag "SD" (bytes 'S','D')
0x1031b: CMPW $0x4353,0x8(%di) ; two-char tag "SC" (bytes 'S','C')
```

VMAP's model of a block header: signature byte at `+0` (`'M'`/`'Z'`), owner **word** at `+1`,
size **word** at `+3` (paragraphs), two-character tag at `+8`.
*Honest uncertainty:* the exact DOS structure these offsets correspond to (the DOS ≥ 4 block
header layout, as opposed to the DOS 3.x `M`/`Z`+size@2+owner@3 layout) is **not settled by this
binary** — the code branches on the DOS version (`0x10273: CMPB $0x4,0x30(%bp)`) and the branch
at `0x10421`/`0x10442` treats DOS ≥ 4 and DOS 3 owners differently. Recorded as an open question,
not as a claim.

## C15 — The owner of a block is found by the "previous block" trick (flat `0x102b4`, `0x10380`)

```
0x102b4: CALL 0x1000:105d1
0x102b9: MOV AX, 0x8
0x10380: PUSH AX
0x10381: CMPW $0x0,0xa(%bp)
0x10387: CMP DX, 0xff00
0x1038f: CMP AL, 0xff
0x10393: INC AX
0x10394: ADD AX, 0x3(%di)
```

`0x105d1` classifies the block as DOS-owned when the byte at `+0` is `'D'` (0x44) or `'I'` (0x49)
(`0x105d7: CMPB $0x44,(%di)` / `CMPB $0x49,(%di)`), and `0x10380` recognises the "owner lives in
the 0xff00–0xffff upper area" case (the classic DOS high-memory resident convention).

---

## Answers to the contract's question list

* **Q1 — how the blocks are enumerated.** A chain walk over the conventional arena: the first
  block segment comes from the DOS Information Block word at `0000:0002` (read via `INT 21h AH=52h`,
  `0x10196`); each step advances by `size + 1` paragraphs (`0x105bf`), and the signature byte at
  each block's `+0` must be `'M'`/`'Z'` (`0x105c8`). The last block is the one whose signature byte
  is `'Z'` (`0x102e5`). A per-block range `[start, next_start)` is what the map prints and what the
  hook attribution uses.
* **Q2 — how the `hooked vectors` column is computed.** By **intersecting the Interrupt Vector
  Table's segment words with each block's segment range**: `FUN_1000_0570` (`0x10570`) walks the
  256 IVT entries at `0000:0000` and reports vector *n* for a block iff
  `block_start <= ivt_segment(n) < next_block_start` (`0x1058a`/`0x1058e`).
  **The contract's surprise target is CONFIRMED.**
* **Q3 — the constants.** C1–C15 above: IVT base `0000:0000`, 256 entries, stride 4, segment word
  at `+2`; range bounds from `[BP+0x4]`/`[BP+0x6]`; column 49 (`0x31`); ten per line (`0xa`);
  format `" %02x"` at `0x0b49`; label tables `"FXBLS"` at `0x0c4f` and 5 label offsets at `0x0c54`;
  header at `0x0a48`; `"*** Memory Arena Trashed!"` at `0x0ade`.
* **Q4 — documented APIs vs raw structures.** **Both, but the hook attribution uses only raw
  structures.** The IVT is read directly at `0000:0000` and the arena headers directly from their
  segments. The `INT 21h`/`INT 67h`/`INT 2Fh` calls listed in C13 are used for DOS version, scratch
  allocation, DIB pointer, screen output, exit, EMS and XMS — **not** for hook attribution, because
  DOS exposes no such query.
* **Q5 — does the port reproduce the property?** See `catalog/transfer-tests/M-14-range-intersection-attribution/bench.mjs`
  (step 4).

## Open questions / unresolved (recorded, not papered over)

1. The DOS block-header layout (C14): VMAP reads owner@+1, size@+3, tag@+8. Which DOS version's
   header that is, and what exactly the `"SD"`/`"SC"` tags denote, is **not determined** by this
   binary. The card does not depend on it: the hook attribution depends only on the two range
   bounds, which are observed directly.
2. `0000:0012` (read at `0x1019d` into `[BP+0xe]`) is used at `0x104b2` to test whether one fixed
   segment falls inside the current block and, if so, to print the 8 characters at that
   segment's `+0x0A`. Its DOS meaning is not determined here.
3. `FUN_1000_10494` matches a single byte against `"FXBLS"`; which byte of which structure it reads
   is not settled (see C10/C14).
4. `INT 21h AH=48h` with `BX=0xffff` at `0x1017e` allocates a 64 KB scratch block *before* the
   arena is walked, so the map VMAP prints includes VMAP's own allocation. Noted as a cost, not
   fixed.
