# Cold-start runbook — proving the methodology transfers

**Purpose.** The pitch claim "the methodology is repeatable by any engineer" is
currently a belief. This runbook makes the claim *testable*: a second engineer
(who has never seen this repo) executes it cold and produces a mechanism card
that passes the same bar the in-house cards passed. One completed run = the
repeatability datum. Zero runs = the claim stays labeled as belief in any pitch.

**Time budget:** one focused day. **Inputs:** one binary the engineer owns, this
repo, the REA toolkit (`rea --help`), Node 22, and the honesty bar
(`docs/templates/probe-contract.md`, `docs/LEARNINGS.md` §1).

## Steps (each has a pass/fail gate — no step is " vibes")

1. **Charter (15 min).** Pick ONE mechanism-suspect behavior in the target
   (allocation pattern, scheduling, data-driven logic, replay discipline).
   Write the per-target question list (3–5 questions) into
   `targets/<name>/probe-contract.md` using the template. Assign depth classes
   *before* any evidence is collected.
   - *Gate: the contract names the classes and the verifier-before-author rule.*

2. **Probe (half day).** REA inventory → locate the 3–5 functions behind the
   behavior → pseudocode + assembly → extract the constants. Rules that gate:
   evidence-first debugging (verbatim errors only), no forking public
   reconstructions (read/cite/diff, never patch), instrument real code for any
   measurement.
   - *Gate: every extracted constant has an address + a quote in the notes.*

3. **Card (30 min).** Write `catalog/mechanisms/M-XX-<mechanism>.md` in the
   evidence-card format (mechanism / witnesses / evidence / generalization /
   **costs** / status). Status must be `single-witness` at this point.
   - *Gate: the costs field exists and is not empty. A card without honest costs
     fails the bar.*

4. **Transfer test (half day).** Write `catalog/transfer-tests/M-XX/bench.mjs`
   on a 2026 stack reproducing the mechanism and measuring the claimed
   property (allocation counts, hashes, backlog bounds, throughput ratio).
   Deterministic metrics are load-bearing; wall-clock numbers are labeled
   noisy. Bump status to `proven` only if the bench reproduces.
   - *Gate: bench runs standalone, `node bench.mjs`, exit 0, prints a verdict
     line a third party can check.*

5. **Audit (15 min).** Run the self-eval: is any claim on page 1 of the docs?
   (fails the surprise bar). Is any claim `restated` where the repo could have
   `measured`? Update `docs/LEARNINGS.md` additively.
   - *Gate: LEARNINGS.md gains a row; any stale line corrected in the same
     commit.*

**Definition of done:** a card + bench that (a) an engineer who never met us can
read end-to-end, (b) whose numbers reproduce on their machine, (c) whose honest
limits are stated in the same breath as the headline.

**First-run protocol:** record deviations from this runbook as steps 6+ of the
run (the runbook is versioned; the first outside run is the experiment). The
claim graduates to "repeatable" only when run #1 completes and the *reviewer
cannot tell which cards were written in-house*.
