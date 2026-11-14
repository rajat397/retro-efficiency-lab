# PLAN: Agent-First Tools — deep-dive flow

**Created:** 2026-11-14
**Inputs:** `docs/AGENT-FIRST-TOOLS.md` (strategy), `docs/THESIS-EFFICIENCY-APPS.md` (mechanisms)
**Method:** one agent per step, thrown sequentially, each step independently resumable.

This is the **execution flow** for the strategy. It is not a product plan — it is the
sequence of questions that must be answered, in order, before anything is built.

---

## 0. The flow at a glance

| # | Step | Kind | Gate (pass) | Gate (fail) |
|---|---|---|---|---|
| **S0** | Measure real harness traffic | Measurement | Friction reproduces on traffic we did not generate | Friction is smaller than claimed → re-rank, ideas change |
| **S1** | Re-rank ideas against measured friction | Decision | One idea, one buyer, one metric, named | No clear winner → run a second measurement, do not build |
| **S2** | Falsification deep-dive on the wedge | Falsification | Falsifier survives | Falsifier triggers → wedge dies, return to S1 |
| **S3** | Demand + competitive validation on the buyer side | Research | Buyer has the problem at scale; no incumbent owns it | Substitute already solves it → pivot or drop |
| **S4** | Smallest testable artifact | Build + measure | Artifact used by a real user; metric moves | Metric does not move → the thesis, not the artifact, is wrong |
| **S5** | Adversarial review (critic → defender) | Adversarial | Defender survives the critic | Critic wins → return to S2/S4 |
| **S6** | Recursive harvest | Meta | New mechanism card(s) + revised strategy | Nothing learned → the deep dive was too shallow, redo it |
| **S7** | Ship decision + catalogue expansion | Decision | Ship / hold / kill recorded with reasons | — |

**Hard rule:** S0 is a **gate, not a formality.** The friction numbers in `AGENT-FIRST-TOOLS.md`
come from vendor surveys and vendor blog posts. The whole strategy rests on them being real.
S0 either confirms them on independent traffic or the strategy changes shape.

**Hard rule 2:** no step may cite a vendor's own claim as evidence without an independent
measurement. This is the anti-bias rule from the lab's charter.

**Hard rule 3:** every step ends with (a) a written artifact in this repo, (b) a commit, and
(c) a stated decision. No step ends in "interesting discussion".

---

## 1. Agent briefing contract

Each step below is designed to be pasted into a fresh agent with no other context. Every
brief carries the seven properties of a good question:

1. **Specified situation** — who is asking, what they know, what is fixed.
2. **Defined output** — the exact shape of the answer.
3. **Explicit success criterion** — what a good answer contains.
4. **Named constraints + their sources** — real limits, stated as constraints.
5. **Checkable reasoning** — the assumptions, the steps, the evidence.
6. **Stated uncertainty** — what would change the agent's mind.
7. **The question** — the thing to be answered.

Plus the six recurring patterns applied where relevant: decomposition before solution,
adversarial pairing, constraint inversion, concrete instance over abstraction, sequenced
passes, and asking for the failure mode.

**Shared context for every agent (paste with every brief):**

```
You are working in /mnt/data/projects/retro-efficiency-lab (a git repo, branch main).
Read first: docs/AGENT-FIRST-TOOLS.md, docs/THESIS-EFFICIENCY-APPS.md, docs/LEARNINGS.md,
docs/methodology.md, and catalog/mechanisms/*.md (the mechanism cards — read at least the
three most recent: M-15, M-15b, M-16).

Working rules for this lab:
- FALSIFIER FIRST. Every experiment starts by writing what result would REFUTE the
  hypothesis. "Confirmed" without a named falsifier is not a result.
- MEASURE, DON'T ASSERT. Prefer a measurement you can reproduce over a claim you can cite.
- A single witness is a single witness. Say so. State the sample, the method, and the limits.
- Write artifacts to disk as you go; an interrupted run must cost minutes, not results.
- Do NOT commit or push unless the brief says to.
- Budget: no paid API calls without an explicit cap stated in the brief and enforced in code.
- Use `rea_*` MCP tools where the task is binary/artifact analysis; use plain shell + node
  for measurement scripts. Node 22 is available. The catalog/transfer-tests/*/bench.mjs
  pattern is the house style for a reproducible experiment (deterministic, seeded,
  mutant-tested, prints a "VERDICT:" line).
```

**Resumption:** each step is a separate agent session. Give each agent a stable
`task_id` so it can be resumed with context intact.

---

## S0. Measure real harness traffic

**Purpose.** Replace vendor-reported friction with our own measurement on traffic we did not
generate. This is the gate for the entire strategy.

**Why now.** M-16's corpus contains this experiment's own traffic; the segments are work types
on one machine; the demand data is from vendor surveys; the friction data is from vendor blog
posts. All three need independent confirmation before we spend effort on a wedge.

**Question (all seven properties):**

> You are a performance engineer auditing the efficiency of AI coding harnesses. The
> operating assumption we are testing is that **harnesses pay a large, measurable, and
> recurring "context tax" and "round-trip tax"** — that the dominant cost of agent work is the
> model's context window being consumed by tool schemas and by intermediate tool results,
> and that agent spend is unattributable to the work that caused it.
>
> You have read the vendor claims in `docs/AGENT-FIRST-TOOLS.md` §A. You are skeptical of them.
> Your job is to **measure** the tax on real transcripts, and to report where the vendor
> claims hold, where they fail, and where the real tax is bigger than claimed.
>
> **Output shape:** a markdown report `docs/REAL-TRAFFIC-MEASUREMENTS.md` with (1) a data-source
> section naming exactly which transcript stores were read, with file counts, date ranges and
> row counts; (2) a measurement table with one row per metric, each row giving the metric
> definition, the formula, the value, and the sample size; (3) a table comparing each vendor
> claim with our independent measurement, marking each **confirmed / overstated / understated /
> not reproducible**; (4) a "what the real tax is" section naming the top three cost drivers by
> measured contribution, ordered; (5) an explicit limitations section (sample, selection bias,
> what a transcript cannot tell you).
>
> **Success criterion:** every number in the report is reproducible by re-running a committed
> script over a committed data extract. A reader can check any single claim without reading
> the code. If a vendor claim cannot be checked, it is listed as *not reproducible* with the
> reason — not silently dropped.
>
> **Constraints and their sources:** read-only on all transcript stores (no writes, no cleanup,
> no redaction of the source files); no network calls; no paid APIs; transcripts may contain
> secrets and personal data — **aggregate and hash, never copy raw user content into the repo**
> (this is a hard constraint from the lab's own security rules); one machine only (say so
> everywhere); the harness population is not a random sample (say so everywhere).
>
> **Checkable reasoning:** state, for each metric, the definition and formula before the value;
> where a metric depends on a modelling assumption (e.g. what counts as a "round trip",
> whether a schema is "in context"), state the assumption and give the value under at least
> two settings so the reader can see the sensitivity.
>
> **Stated uncertainty:** "what would change your mind" — name in advance which result would
> make you report that harnesses do *not* have a material context tax. If you find that, report
> it as the headline, not as a footnote.
>
> **Failure mode to ask about:** "How would a smart person get this wrong here?" — consider
> transcripts that were never written, transcripts from users who churned, and the difference
> between a *recorded* transcript and a *representative* session. Your conclusion must survive
> your own answer.

**Method — sequenced passes, not one pass.**

1. **Inventory.** Locate transcript stores (Claude Code `~/.claude/projects/*.jsonl`, opencode
   session store, any others the agent finds). Report counts and date ranges. Do not analyze
   yet.
2. **Decompose.** Define the metric set *before* measuring: context tax, round-trip tax,
   unattributable spend, per-workload arrival shape (κ), re-runnability. Write the definitions
   into the report skeleton. Pass 1 of the user's pattern: decomposition before solution.
3. **Extract.** Write one script per metric family into `scripts/`, each writing a JSON data
   file under `data/`. Per the lab's paid-batch rules (non-paid, but the same discipline):
   per-row appends, resumable done-sets, a committed extract.
4. **Measure.** Run, record with sample sizes.
5. **Cross-check.** For each vendor claim in `AGENT-FIRST-TOOLS.md` §A, mark confirmed /
   overstated / understated / not-reproducible.
6. **Failure mode.** Answer your own adversarial question; revise if it changes the headline.
7. **Commit.** Artifact + data + scripts, with a README documenting how to reproduce.

**Deliverable:** `docs/REAL-TRAFFIC-MEASUREMENTS.md`, `data/*.json`, `scripts/measure-*.mjs`,
`catalog/transfer-tests/M-17-harness-friction/` (a bench that recomputes the headline
metrics from the committed extract and prints a `VERDICT:` line — mutant-tested, house style).

**Gate.**
- *Pass* → the friction holds on independent traffic; proceed to S1 with our own numbers.
- *Fail* (friction materially smaller than claimed, or concentrated in a segment we cannot
  target) → **the strategy document changes**. Do not proceed to S1 unchanged. Write a short
  "the strategy was wrong about X" section at the top of the report and re-rank immediately.

**Recursion hook.** The measured per-workload κ and the measured ownership-ambiguity rate are
direct inputs to S1 (they change which idea has the biggest payoff) and become the *external
witness* for M-15b and M-16, which currently rest on one machine. Note explicitly which cards
this step strengthens or weakens.

---

## S1. Re-rank the six ideas against measured friction

**Purpose.** Pick one wedge using our own numbers instead of vendor blogs. This is where
"S1 → idea" stops being a guess.

**Question:**

> You have measured the real friction (S0) and you have six candidate products
> (`docs/AGENT-FIRST-TOOLS.md` §C). Your task is to **choose one to deep-dive**, and to defend
> the choice against the strongest alternative.
>
> **Output shape:** (1) a scored table — each idea scored on *friction addressed* (from S0's
> measured numbers, with the numbers cited), *demand evidence quality* (primary data vs vendor
> blog), *defensibility* (can a platform vendor ship this in a quarter?), *buildability by us*
> (one person, weeks), and *time-to-evidence* — with the total and the ranking; (2) the chosen
> wedge, its **one named buyer**, its **one metric**, and the **one number** that would make us
> abandon it; (3) the strongest alternative idea and the single decisive reason it lost;
> (4) the **ten ideas you rejected** that were not on the original list, with one line each
> (the user's "rejected options" pass — the less common ideas appear here).
>
> **Success criterion:** a reader who disagrees can identify the *scoring row* they disagree
> with and the number they would change. The wedge must be one idea, not a portfolio.
>
> **Constraints:** the six ideas are not the candidate set — the candidate set is the six *plus*
> your ten new ones; the metric must be measurable within four weeks by one person; the buyer
> must be reachable (a named company, role, and existing spend), not "developers" in general.
>
> **Checkable reasoning:** every score cites either an S0 measurement or a cited source with its
> provenance. Scores are integers; ties are broken by time-to-evidence and the tie-break is
> stated.
>
> **Stated uncertainty:** "which single number in S0, if it changed, would flip the ranking?"

**Method.** Scoring pass → forced-choice pass → inverted pass ("what would guarantee this
wedge is wrong?" → if the answer is "it doesn't apply to the buyer we named", go back) →
rejected-options pass → commit.

**Deliverable:** `docs/WEDGE-DECISION.md`.

**Gate.** One idea, one buyer, one metric, one abandonment number. If the scoring produces a
genuine tie that cannot be broken, **do not build** — run a second measurement instead, and
name it.

**Recursion hook.** The ten rejected ideas become the candidate list for the *next* cycle of
this plan, and several may be sharper than the original six.

---

## S2. Falsification deep-dive on the chosen wedge

**Purpose.** Kill the wedge before we spend a quarter on it.

**Question:**

> You are the skeptic assigned to kill a promising idea. The idea has a metric and a buyer
> from S1. **Write the experiment that would refute it, then run it.**
>
> **Output shape:** (1) the hypothesis stated as a single falsifiable sentence, with the
> mechanism it relies on; (2) the **falsifier** — the precise observation that would refute it,
> with the numeric threshold and the measurement method; (3) the experiment: what is built,
> what is measured, on what data, with what sample size; (4) the result; (5) the verdict:
> **SURVIVED** or **REFUTED**, with the evidence; (6) if refuted, the **refuted sub-claim** —
> the narrower claim that is still true, stated so it could be its own mechanism card.
>
> **Success criterion:** the falsifier was written *before* the result was known, and the result
> is reported as found. A "confirmed" verdict that could not have come out otherwise is a failed
> experiment and must be labeled so.
>
> **Constraints:** use real traffic or a faithful simulation of it — not a toy. The sample size
> must be justified before running, not chosen after. If the experiment is too expensive to
> run honestly, say so and run the smaller honest version.
>
> **Checkable reasoning:** show the data. Anyone can re-run the bench and get the same verdict
> line. Where the mechanism is borrowed from a card (M-13, M-15, M-16), say which card and
> whether this experiment independently corroborates it.
>
> **Stated uncertainty:** name the alternative explanation for a surviving result that this
> experiment cannot rule out.

**Method.** Falsifier first → design → build the bench (house style: deterministic, seeded,
mutant-tested, `VERDICT:` line) → run → report. **Mutants are mandatory:** at least three
mutants of the load-bearing computation must exit non-zero. (This is the lesson from M-16,
where the first bench had no teeth — four mutants all passed — and it was only caught because
the checks were re-pointed at the *computation* instead of restating properties of the data.)

**Deliverable:** `catalog/transfer-tests/M-1X-<slug>/` (bench + README + mutants) and
`catalog/mechanisms/M-1X-<slug>.md`.

**Gate.** Survived → S3. Refuted → the wedge dies; return to S1 **with the refutation as new
evidence**, which may reorder the list.

**Recursion hook.** Every refuted sub-claim that survives becomes a new mechanism card, and the
set of cards grows — which is the lab's actual product.

---

## S3. Demand and competitive validation on the buyer side

**Purpose.** Confirm the buyer has the problem at a scale we can win, and that nobody already
owns it.

**Question:**

> You are researching whether a specific named buyer (from S1) actually has this problem, at
> what scale, and what they pay for it today.
>
> **Output shape:** (1) the buyer's current workflow for the task, walked through as a concrete
> Tuesday for one named person (the user's "concrete instance" pattern) — what they do now, how
> long it takes, what it costs, what they already pay for; (2) the *current substitute* —
> including the "do nothing / spreadsheet / hire a contractor" option, which is usually the real
> competitor and is almost always missing from vendor competitive analyses; (3) the competitive
> map: who could ship this, who would have to, and what stops them (the question that usually
> matters is not "why won't they?" but "why haven't they already, and what changed?"); (4) the
> **quality bar check**: does the idea name the specific person who pays, the cost they pay
> today, and why no current product solves it; (5) the ten alternative framings of the same
> problem with the three strongest and why they lose.
>
> **Success criterion:** the substitute analysis changes the pitch at least once — if it does
> not, the research was too shallow.
>
> **Constraints:** primary sources where possible; vendor claims labeled as vendor claims; the
> buyer must be reachable — a named company, role, and existing spend. No "developers" in
> general.
>
> **Checkable reasoning:** cite the primary source and its date for every claim about the
> buyer's spend or workflow. Where evidence is secondhand, label it.
>
> **Stated uncertainty:** what evidence would you need to see to switch to a different buyer.

**Method.** Substitute-first pass (the one people skip) → concrete-instance pass → competitor
pass → quality-bar check → reframing pass → commit.

**Deliverable:** `docs/BUYER-VALIDATION-<slug>.md`.

**Gate.** The named buyer has the problem, at scale, with a current spend we can name, and no
substitute already solves it. If a substitute already solves it → pivot or drop.

**Recursion hook.** The re-framings that lose often win with a different buyer; they become the
next cycle's candidates.

---

## S4. Build the smallest testable artifact and measure

**Purpose.** Produce evidence of value, not evidence of concept.

**Question:**

> Design and build **the smallest artifact a real user would actually use** that would falsify
> or confirm the value proposition from S1 — and then get it in front of a real user.
>
> **Output shape:** (1) the artifact's scope, with an explicit list of what it deliberately does
> *not* do and why; (2) the design, with the one design decision that carries the most risk and
> how it is de-risked; (3) the build, in-repo, following the lab's bench conventions where the
> artifact is measurable; (4) the measurement plan — the metric, the baseline, the target, the
> instrument, and the sample size; (5) the result, measured, with the baseline comparison; (6)
> the decision: does the metric move enough to justify the next order of magnitude of work.
>
> **Success criterion:** a real user (not a teammate) used the artifact, and the metric moved.
> "A teammate said it felt good" is explicitly not a success.
>
> **Constraints:** one person, weeks not months; the artifact must be usable without onboarding
> a human; **no paid API calls without an explicit cap declared in the brief, enforced in code,
> and written to a spend ledger** (the lab's paid-batch rules apply in full).
>
> **Checkable reasoning:** the baseline must be measured on the same artifact class, not
> asserted from literature. Show the baseline run.
>
> **Stated uncertainty:** name the single biggest way this measurement could mislead us —
> and say what would be needed to remove that doubt.

**Method.** Inversion pass ("what would guarantee this artifact fails to impress?") → scope
cut → build → baseline → instrumented run → adversarial read of the result.

**Deliverable:** the artifact in `prototypes/<slug>/`, plus `docs/ARTIFACT-RESULTS-<slug>.md`.

**Gate.** Metric moves on real users → S5. Metric does not move → **the thesis is wrong, not
the artifact**; return to S2 and re-examine the mechanism.

**Recursion hook.** Whatever the artifact's real users did that we did not predict becomes the
next cycle's best source of ideas.

---

## S5. Adversarial review — critic, then defender

**Purpose.** Sharpen the surviving version by making the attack explicit rather than implicit.

**Question (run as two separate agents):**

> **Critic:** Attack the wedge as hard as a skeptical investor who has watched the last three
> AI-tool companies fail would. Assume it will be read by someone looking for the reason to
> pass. Produce: the strongest single argument against it (one argument, not a list); the
> strongest supporting evidence for that argument (cite it); the most likely reason it fails
> despite working; the thing that would have to be true for it to work and is not yet
> established; and your verdict (FUND / PASS) with the one condition that would change it.
>
> **Defender:** Here is the critic's argument (paste it). Now defend the strongest surviving
> version of the idea. You may change the idea, its scope, its buyer, or its metric — but you
> may not answer the critic's argument without addressing it. Produce: what in the idea
> survives the attack unchanged; what must change; the narrowest version of the idea that
> survives; the metric that would be honest for that narrow version; and whether the change
> is small enough to keep going.

**Success criterion.** The pair produces a *narrower* idea with an honest metric. If the
defender's answer is "the critic is wrong because X" with no change, the review failed —
either the critic was too weak or the defender was not reading.

**Deliverable:** `docs/ADVERSARIAL-REVIEW-<slug>.md` (both passes, in order, unabridged).

**Gate.** A narrowed idea with an honest metric → S6. The critic wins outright → return to
S2.

---

## S6. Recursive harvest

**Purpose.** Convert what was learned into the lab's actual asset: mechanism cards, learnings,
and a revised strategy.

**Question:**

> We have run S0–S5. **What did we learn that we did not know before, and does it generalize
> beyond this one idea?**
>
> **Output shape:** (1) the **refuted assumptions** — what we believed entering this cycle that
> the evidence has now falsified, each with the evidence that killed it; (2) the **new mechanism
> cards** — one per genuinely generalizable finding, each written in the house card format
> (mechanism / witnesses / evidence table / generalization / costs & honest limits / status /
> repro), each with at least one named falsifier; (3) the **revised strategy** — what changes
> in `docs/AGENT-FIRST-TOOLS.md`, with the reasoning; (4) the **next cycle's question list** —
> the ten best new questions this cycle produced, each in good-question form (specified
> situation, defined output, success criterion, named constraints, checkable reasoning, stated
> uncertainty); (5) the **LEARNINGS row(s)** — one line each, in house format, with the source.
>
> **Success criterion:** at least one new mechanism card that generalizes past the wedge, and
> at least one assumption explicitly falsified. A cycle that confirms everything teaches nothing.
>
> **Constraints:** a card must not be a restatement of the wedge; a card with a single witness
> says so. No claim without a repro path.
>
> **Checkable reasoning:** each card's evidence table cites a committed artifact.
>
> **Stated uncertainty:** which new card is most likely to be wrong, and what would test it
> fastest.

**Method.** Assumptions audit → card extraction (with the "would a practitioner of X do this?"
forcing question) → strategy revision → next-question generation → learnings → commit.

**Deliverable:** `catalog/mechanisms/M-1X-*.md` (new cards), revised
`docs/AGENT-FIRST-TOOLS.md`, `docs/LEARNINGS.md` rows, `docs/NEXT-QUESTIONS.md`.

**Recursion hook.** This is the loop point. `docs/NEXT-QUESTIONS.md` becomes the seed for the
next cycle of S1.

---

## S7. Ship decision and catalogue expansion

**Purpose.** Close the loop with a decision, and keep the catalogue as the durable asset.

**Question:**

> We have a validated, adversarially-survived result. **What do we actually do?**
>
> **Output shape:** (1) the decision — **SHIP / HOLD / KILL** — with the reason and the
> conditions that would flip it; (2) if SHIP: the smallest shippable scope, the first user, the
> date; (3) if HOLD: what specific evidence would unblock it and who gets it; (4) if KILL: the
> archived artifact locations and the one-paragraph post-mortem that would save the next person
> six weeks; (5) the **catalogue update** — which card changes status, which new card ships,
> and how the thesis statement changes; (6) the **next cycle's entry point** — a single sentence
> naming the first question of the next loop.
>
> **Success criterion:** a decision someone else could execute without asking you anything.
>
> **Constraints:** no decision of "keep exploring" — that is HOLD with a named unblocking
> artifact. Everything a future agent needs is written down in the repo.

**Deliverable:** `docs/DECISION-<slug>.md`, updated cards, updated thesis, `docs/NEXT-QUESTIONS.md`.

---

## 2. Sequencing rationale (and what would reorder it)

- **S0 first** because every friction claim in the strategy is vendor-reported and the whole
  plan inherits them. S1's scoring is only meaningful against measured numbers.
- **S1 second** because S2–S5 are expensive and there is no point falsifying the wrong idea.
- **S2 before S3** because falsification is cheap and cannot be bought; demand research is
  expensive and can be deferred until the idea survives its own mechanism test.
- **S4 after S3** because building before confirming the buyer's substitute is how you build
  something nobody wanted.
- **S5 after S4** because the critic should attack a real artifact and real numbers, not a
  proposal.
- **S6 last** because the harvest is only meaningful once there is something to harvest.

**Reorder triggers.**

| Trigger | Move |
|---|---|
| S0 shows the friction is real but concentrated in a segment we cannot reach | narrow S1's candidate set to that segment before scoring |
| S1's scoring ties | run a second measurement; **do not build** |
| S2 refutes the wedge but a refuted sub-claim survives with a wider scope | skip to S3 with the sub-claim as the wedge |
| S4's metric moves but on teammates only | S4 did not pass; find a real user before S5 |
| S6 produces no generalizable card | the cycle was too narrow; re-run S2 with a broader hypothesis |

---

## 3. Global rules for the whole flow

1. **No step may cite a vendor's own claim as evidence without independent measurement.**
2. **Falsifier before experiment, always.** "Confirmed" without a named falsifier is not a result.
3. **Every step writes to disk and commits.** An interrupted run must cost minutes, not results.
4. **Every bench has teeth.** ≥3 mutants of the load-bearing computation must fail. This is a
   hard lesson from M-16.
5. **Single witnesses say so.** The lab's honesty rule: state sample, method, limits, and the
   number of independent witnesses for every claim.
6. **Paid work is capped and ledgered.** No paid batch without a declared USD cap enforced in
   code, per-row appends, a spend ledger, and a verify-5-first run.
7. **Never publish or share externally without explicit consent.**
8. **The catalogue is the asset.** Every cycle must end with the mechanism set larger and more
   general than it was, not just with a product decision.

---

## 4. Status

| Step | Status |
|---|---|
| S0 Measure real harness traffic | **NOT STARTED** |
| S1 Re-rank ideas | not started |
| S2 Falsification deep-dive | not started |
| S3 Buyer validation | not started |
| S4 Smallest testable artifact | not started |
| S5 Adversarial review | not started |
| S6 Recursive harvest | not started |
| S7 Ship decision | not started |
