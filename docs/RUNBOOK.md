# Cold-start runbook — proving the methodology transfers

**Purpose.** The pitch claim "the methodology is repeatable by any engineer" is
currently a belief. This runbook makes the claim *testable*: a second engineer
(who has never seen this repo) executes it cold and produces a mechanism card
that passes the same bar the in-house cards passed. One completed run = the
repeatability datum. Zero runs = the claim stays labeled as belief in any pitch.

**Time budget:** one focused day. **Inputs:** one binary the engineer owns, this
repo, the REA toolkit (`rea --help`), Node 22, and the honesty bar
(`docs/templates/probe-contract.md`, `docs/LEARNINGS.md` §1).

> **Revision history.** v1 — as written before the first run. **v2 — revised after
> cold run #1** (`docs/COLD-RUN-2026-11-13.md`), which found ten gaps; every gap
> is marked below as **[v2]**. Run #1's verdict: the card was good, the
> methodology did **not** fully transfer, and the graduation criterion was not
> met. This revision is the protocol that should carry run #2.

## Rules that bind the reader, not just the writer

- **The read-restrictions below are yours to enforce and yours to disclose.** If you
  overshoot a boundary (e.g. a `limit:` on a file whose section ends earlier), say
  so in your final report — a breach that is reported is an incident; a breach
  that is discovered later is a credibility problem. **[v2]**
- **Do not read** `catalog/mechanisms/*.md`, `catalog/transfer-tests/*/`,
  `targets/*/findings*.md`, `SYNTHESIS.md`, `docs/ANALOGY-MAP.md`,
  `docs/PITCH-STRESS-TEST.md`, or `docs/LEARNINGS.md` beyond §1. Those hold the
  answers for other mechanisms; reading them invalidates the experiment. Listing
  a directory is fine; reading its contents is not.
- **Never execute the target binary.** Static analysis only.
- **Never patch or fork a public reconstruction.** Read, cite, diff — never
  modify.
- **Deterministic metrics are load-bearing; wall-clock numbers are labeled noisy.**

## Steps (each has a pass/fail gate — no step is " vibes")

1. **Charter (15 min).** Pick ONE mechanism-suspect behavior in the target
   (allocation pattern, scheduling, data-driven logic, replay discipline).
   Write the per-target question list (3–5 questions) into
   `targets/<name>/probe-contract.md` using the template. Assign depth classes
   *before any `traced`/`measured` evidence is collected*.
   - **A cheap, string-only triage before the contract is allowed** (search
     strings, read nothing else). Picking a suspect behavior at all requires
     knowing what the program does, so "before *any* evidence" is not workable.
     Log the triage in the contract's Deviations section with what you read and
     why it cannot contain the answer. **[v2]**
   - *Gate: the contract names the classes and the verifier-before-author rule.*

2. **Probe (half day).** REA inventory → locate the 3–5 functions behind the
   behavior → pseudocode + assembly → extract the constants. Rules that gate:
   evidence-first debugging (verbatim errors only), no forking public
   reconstructions (read/cite/diff, never patch), instrument real code for any
   measurement.
   - **Know the address space before you read anything.** **[v2]** For a loaded
     binary there are three coordinate systems — a *flat* address, a
     *segment-relative* operand, and a *file offset* — and they are not
     interchangeable. A COM image is loaded at PSP+0x100, so the code's operands
     are segment-relative while the string inventory reports flat addresses.
     Consequence: **`rea xrefs` on a flat address can return empty while the
     reference exists** in segment space. Empty xrefs is not evidence of
     absence — read the assembly before concluding "unreferenced".
   - **Spend the read budget on the contract's 3–5 functions.** **[v2]** Each
     deep-analysis call re-imports the artifact (~25 s); there is no "dump all
     procedures" verb; and the harness kills background jobs when a tool call
     returns. So: locate candidates cheaply (a full-file disassembly is a fine
     *cross-check*), then re-read only the anchor procedures through the
     analysis tool so every load-bearing quote is tool-attested.
   - **Budget in evidence produced, not tool invocations.** **[v2]** "≥ 25 tool
     invocations" is meaningless when each invocation re-imports the artifact.
     Budget constants extracted, anchor procedures read, quotes verified.
   - *Gate: every extracted constant has an address + a quote in the notes.*

3. **Card (30 min).** Write `catalog/mechanisms/M-XX-<mechanism>.md` in the
   evidence-card format (mechanism / witnesses / evidence / generalization /
   **costs** / status). Status must be `single-witness` at this point.
   - **Include a "what the evidence refuted" line, even when the answer is
     "nothing".** **[v2]** It forces the contract's surprise target to be settled
     rather than sidestepped.
   - **Include an open-questions slot.** **[v2]** A mechanism with genuinely
     unresolved questions needs a home for them that is not prose inside a
     costs field.
   - **If the mechanism fits no existing family**, add the family to
     `catalog/README.md` in the same commit rather than force a bad fit — and
     say so in the card. **[v2]**
   - *Gate: the costs field exists and is not empty. A card without honest costs
     fails the bar.*

4. **Transfer test (half day).** Write `catalog/transfer-tests/M-XX/bench.mjs`
   reproducing the mechanism on a 2026 stack and measuring **the property the
   original mechanism claims** — not a throughput ratio it never claimed.
   Deterministic metrics are load-bearing; wall-clock numbers are labeled
   noisy. Bump status to `proven` only if the bench reproduces.
   - **Mutation-check the bench before it counts.** **[v2]** "A bench that cannot
     fail is theater." Mutate the load-bearing rule (a comparison's bound, a
     threshold, a tie-break) and show the bench **exits non-zero**. A random
     fixture will not do this: random values almost never land on a boundary, so
     a broken rule survives it. Add explicit boundary cases.
   - *Gate: bench runs standalone, `node bench.mjs`, exit 0, prints a verdict
     line a third party can check — and at least one mutant of it fails.*

5. **Audit (15 min).** Run the self-eval: is any claim on page 1 of the docs?
   (fails the surprise bar). Is any claim `restated` where the repo could have
   `measured`? Update `docs/LEARNINGS.md` additively.
   - *Gate: LEARNINGS.md gains a row; any stale line corrected in the same
     commit.*

6. **Record the deviations and fix the protocol.** **[v2]** Every deviation
   logged during the run becomes a proposed edit to *this* file, or an explicit
   decision to keep it. The runbook is versioned; the first outside run is the
   experiment, and its failures are the experiment's output.
   - *Gate: the final report names every deviation, says which runbook lines
     were wrong or unworkable, and states whether the graduation criterion was
     met.*

## Definition of done

A card + bench that (a) an engineer who never met us can read end-to-end, (b)
whose numbers reproduce on their machine, (c) whose honest limits are stated in
the same breath as the headline, and (d) whose bench **fails** when its
load-bearing rule is mutated.

## First-run protocol

Record deviations from this runbook as step 6 of the run. The claim graduates to
"repeatable" only when a run completes and **the reviewer cannot tell which
cards were written in-house**. Run #1 (2026-11-13, `VMAP.COM`) did not meet that
criterion — see `docs/COLD-RUN-2026-11-13.md` for the datum, the ten gaps that
produced this v2, and what would have to change for run #2.
