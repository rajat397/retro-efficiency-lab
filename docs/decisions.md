# Decision Log (append-only)

Format: `YYYY-MM-DD — decision — rationale — status`

---

## 2026-11-12 — Project charter: extract transferable efficiency mechanisms from old small-budget software

**Decision.** The lab's unit of output is the *evidence-backed mechanism card*, not a
decompilation and not a product. First deliverable is a learnings catalog (10–15 cards
from the first two targets), then transfer tests with numbers.

**Rationale.** The REA-community wave showed old games/apps running complex systems in
KB–MB budgets; modern equivalents are heavier. To be impactful rather than nostalgic we
need (a) mechanisms not results, (b) evidence not vibes, (c) measured transfer.

**Rejected alternative.** Building a "modern app using old techniques" first — premature
without a catalog of what the techniques actually are.

## 2026-11-12 — Evidence-card format

**Decision.** Every mechanism is recorded as: **mechanism** (one sentence, names the
structural choice), **witnesses** (targets + function/data pointers), **evidence**
(REA evidence IDs, quotes, measurements), **generalization** (how it applies on other
stacks), **costs** (what it gives up), **status** (single-witness → cataloged → proven).

**Rationale.** The costs field is what separates engineering insight from nostalgia;
the multi-witness requirement is what separates general from accidental.

## 2026-11-12 — Target slate and ordering

**Decision.** Ordered slate (selection principle: hard budget + public reconstruction +
REA-fit + modern analogue):

1. Touhou TH04/TH05 (PC-98, 1998) — bullet pool, fixed-slot entities, pattern-as-data
2. Doom (1993) — deterministic sim, resource system, LUTs
3. RollerCoaster Tycoon (1999) — peep AI in hand-written assembly, no-alloc economy
4. Another World (1991) — game-as-bytecode-VM
5. SCUMM (LucasArts) — resource system, LRU-as-memory-manager
6. X-COM (1994) — snapshot architecture
7. KKrieger/demoscene 64K — procedural-as-compression
8. Genesis/NES raw ROM (m68k/6502 via REA raw-binary mode)

Start with #1 and #2 (reconstructions exist = low risk), then #3 (crown jewel).

**Rejected candidates.** DX-Ball, 90s editors, Winamp-era players — too low mechanism
density; techniques already re-invented and textbook.

**Mechanism families (extraction buckets):** determinism · zero-allocation frames ·
data-as-program · procedural-as-compression · streaming discipline · format discipline ·
precision-by-LUT.

## 2026-11-12 — Extraction loop

**Decision.** Per target, the loop is: (1) scope via REA module/function inventory →
(2) pick 3–5 functions handling allocation/storage/per-frame work → (3) pseudocode +
assembly via REA, validated against any public reconstruction → (4) write cards →
(5) record REA unknowns as a research backlog. Per-target question list is written
*before* diving (prevents wandering).

## 2026-11-12 — Quality gates

**Decision.** A card advances only through: single-witness → cataloged (≥2 witnesses)
→ proven (passes a transfer test with measured numbers vs a naive implementation on a
modern stack). Unsurvivable learnings are dropped or narrowed, not kept for flavor.

## 2026-11-12 — Guardrails

**Decision.** Analysis-only for copyrighted targets (learnings/mechanisms yes, assets
no). Old software has survivorship bias — the card "costs" field and multi-witness rule
are the counterweights. REA unknowns are recorded verbatim as the research backlog.

## 2026-11-12 — Honest audit: MarioXP is calibration, not an efficiency exemplar

**Decision.** Target 0's findings were audited against the thesis. M-1
(Event-program-as-VM) is kept but downgraded to `calibration` — the architecture
signal is real, but a fan game on a stock commercial engine does not satisfy the
hard-budget criterion. Save encoding and hidden-mode machinery are documented as
pipeline proof only, not cataloged.

**Rationale.** The user asked directly whether MarioXP produced thesis-aligned
learnings. Honest answer: mostly no. Guardrail applied: future targets must satisfy
the budget criterion (constraint-forced design) — PC-98 TH04/TH05 qualifies
(640KB-era bullet hell), which is why it is Target 1.

**Effective rule.** "Works on REA" ≠ "meets the thesis." Both gates stay.

---

## 2026-11-13 — Product phase: the catalog is the floor, not the product

**Decision.** The lab's unit of output stops being the mechanism card and becomes a
**product built ground-up from the proven fundamentals**, applied to one big existing
problem, decomposed by first principles to its root causes, ignoring what current
solutions build. Working thesis and the full decomposition: `docs/PRODUCT-THESIS.md`.

**Rationale.** The 2026-11-12 charter made the card the unit of output ("not a
decompilation and not a product") because the catalog did not yet exist and a product
built on air would be unfalsifiable. The catalog now exists (9 proven with numbers,
3 in transfer tests this month). But a card — and, more so, a single low-level tool
built from one mechanism — is not something anybody uses. The operator's framing
(2026-11-13): *the useful product is several improvement layers and harnesses built
around strong fundamentals, applied to a big existing problem broken down by first
principles, then built ground up ignoring what current solutions build.* The
first-principles breakdown of agent-fleet spend shows **four of six root causes already
have a proven fundamental**, and names the two holes that block three of the four
product layers: the **unit of work** and the **measured degradation ladder**.

**Rejected alternatives.**
- *Ship a single low-level artifact* (e.g. a capacity calculator from M-13 alone). This
  was proposed and rejected in the same session: a fundamental with no user. A mechanism
  is a floor, not a product.
- *Build a dashboard.* That is what every incumbent in this space builds
  (LangSmith/Langfuse/Braintrust/Phoenix for tracing; LiteLLM/Portkey/Envoy/Cloudflare
  for gateways; CCusage/billing exports for cost). Observing after the fact cannot
  prevent the outcome; the product's job is to decide at admission time.
- *Keep the catalog as the end product.* Honest but inert — nine proven mechanisms that
  change no one's Tuesday.

**Boundary.** "Ignore what current solutions build" means ignore their **architecture**,
not their **requirements**: streaming, auth, multi-provider routing, and audit survive.
The boundary is stated in the thesis so it cannot be quietly dropped.

**Status.** proposal, not approved. The first experiment it implies — deriving and
measuring the **unit of work** (tokens? calls? dollars? cost per completed outcome?) — is
the M-15 candidate, because it is the one primitive the budget, the ledger, and the
degradation ladder all depend on. If a different big problem fits the fundamentals
structurally better, this thesis is replaced rather than defended.
