# AGENT-FIRST TOOLS: Strategy for Retro-to-Forward Transfer

**Status:** strategy (evidence-backed, build decisions not yet made)
**Date:** 2026-11-14
**Parent:** `docs/THESIS-EFFICIENCY-APPS.md` (the five mechanisms this document transfers)

This document answers one question: **given the mechanisms measured in the retro-efficiency-lab,
what should be built to improve how humans work with agents?**

It is deliberately not a spec. Every idea below carries the demand evidence, the competitive
check, and the falsifier that would kill it.

---

## A. First-principles decomposition

Five primitive facts, each with measured backing. These are the constraints every idea
must satisfy.

**Primitive fact 1 — Context is the scarcest resource, and it is being spent on *catalogues*.**
Every MCP tool schema enters the context window before the user types a word.

| measurement | value | source |
|---|---|---|
| context consumed by tool descriptions before work begins | **40–50 %** of the window | Perplexity CTO, Ask 2026 (they partially withdrew MCP internally) |
| five-server tool definitions (58 tools) | ~55,000 tokens | Anthropic |
| highest observed internally | 134,000 tokens | Anthropic |
| GitHub MCP server alone, 101 default tools | 64,600 tokens | Anthropic (cut to 30,300 by trimming to 52 tools) |
| correctness degrades past this context size | **~32,000 tokens** | Databricks study, lost-in-the-middle |

The last row is the one that matters most: a bloated window doesn't only cost money, **it makes
the model dumber**. The "1M context window" framing is a marketing number, not an operating one.

**Primitive fact 2 — Every tool call is a round trip through the model.** MCP is RPC. Firecrawl
measured CLI operations at ~200 tokens against **32,000–82,000 tokens** for the equivalent MCP
operation — two orders of magnitude. GitHub replaced its own MCP server for data fetching with
the `gh` CLI for exactly this reason: a CLI call is a plain HTTP request, while every MCP tool
call is also a round trip through the model.

**Primitive fact 3 — The model does not know when it is wrong.**

| failure | measurement | source |
|---|---|---|
| tool-selection accuracy with 150K tokens of schemas | **42 %** | Conf42, production agent (Outlook/SharePoint/Jira/Confluence/Slack) |
| hallucination rate without fresh data | ~35 % higher | (see Firecrawl/agent-knowledge reporting) |
| enterprise practitioners reporting self-verification loops from overlapping/contradictory tool results | **65 %** | arXiv 2606.09182, 20 practitioners, 8 companies |
| MCP failure-rate increase in multi-model setups | ~40 % | same |
| MCP servers in the official registry | **40,047** (Oct 2026), ~20× growth since Nov 2025 | MCP registry API |
| registry share held by the top 10 publishers | 18.7 % | same |

The registry number is the supply-side swamp. The demand side for *good procedure* is the
unsolved part.

**Primitive fact 4 — Nobody can say who spent what.** Every platform reconstructs spend after
the fact. M-15b measured that this is *provably* wrong: all three post-hoc strategies reconciled
the invoice total exactly while attributing **25–55 of 60 tasks wrongly**, leaving **36 charges
owned by nobody** and **94 provably wrong** assignments. This is the worst possible failure
shape: the total balances, so no total-vs-bill check can see it.

**Primitive fact 5 — The bottleneck is governance, not capability.** 88 % of enterprises use or
test agents, but only 30 % report the technology handles a majority of their tasks without human
intervention. The winners "constrain scope to make behavior predictable and auditable"; the
losers are "do anything" agents, still stuck in pilots.

### The forcing function

> *Take game AI and force it to solve agent tool-invocation. What would a game engineer do?*

**Doom's monster AI was a behavior tree executing bytecode — one CPU instruction per node, not a
neural-network call per node.** Quake's BSP trees gave the player a *pointer* to a room, not a
map of the level. The retro engineer's answer to "how do I execute thousands of cheap decisions
fast" was: **move the decision loop into code, and reserve the expensive processor for the rare
high-level choice.**

Agents today do the exact opposite — every action is a model turn. That inversion *is* the bloat
this lab exists to remove.

The market has already found the fix, repeatedly and independently:

| implementation | result | source |
|---|---|---|
| Cloudflare server-side code mode | 1.17M → ~1,000 tokens (**99.9 %**) for the whole Cloudflare API | Cloudflare, Feb 2026 |
| Conf42 production agent | 150K → 22K prompt tokens (**85 %**); selection accuracy **42 % → 80 %** | Conf42, Oct 2026 |
| browser-use 1.0 | 80 % of the library deleted; up to 33 points better; **2.7–5.2× cheaper**, 2–3× faster | browser-use 1.0, Nov 2026 |
| browser CLI + skill vs MCP servers | 2.1M vs 4.4M (Playwright MCP) vs 6.7M (chrome-devtools-mcp) median input tokens | browser-use matched eval |

**But every implementation is per-source and per-vendor.** Cloudflare's code mode serves
Cloudflare's API. FastMCP's, limen's, agentgateway's and pi-code-mode-mcp's each wrap something
else, behind their own runtime. The missing primitive is not another gateway — it is a **host-side
kernel that spans sources (browser, database, SaaS, files) and harnesses (Claude Code, OpenCode,
Codex), where the model writes the loop and the engine runs it.**

That is the retro lesson, three layers down.

---

## B. Demand map — where to target

Numbers are workplace adoption unless stated. Sources: JetBrains Developer Ecosystem Survey 2026
(n=15,509, May–Jul 2026); Stack Overflow Developer Survey 2026 (n=30,000, Oct 6 2026); Zapier/
Centiment enterprise survey 2026 (n=513); G2 Insights 2026; Aldric Research mid-2026; Salesforce
Agentic Enterprise Index (Feb 2025–Apr 2026); GitHub Octoverse 2026.

| utilization form | demand evidence | verdict |
|---|---|---|
| **Harnesses (individual devs)** | Claude Code **39 %** work adoption (US 47 %); Codex 16 %; Cursor 12 %; OpenCode 7 % work / 13.6 % "used"; 90 % weekly, 68 % daily; **>40 % of GitHub PRs now AI-started** (17 % in Mar 2026) | **Target — highest volume.** The reference implementation; anything that works here gets adopted |
| **Enterprise customer-service / ops agents** | support 57 %, ops 59 % of enterprises using agents; Salesforce: 170× service-chat volume with **steady** autonomous resolution (7/10); agents scaled 5 → 13 per org | **Target — highest value per seat, biggest governance gap** |
| **Data / analytics agents** | 29–36 % in production; Databricks Genie 2.0 (Nov 11 2026) with 100+ sources; Snowflake CoWork/CoCo; SAP Joule + Reltio | Adjacent — platform-locked, hard to enter |
| **Finance / HR / legal agents** | benefit reported by 41 % / 43 % / 19 % | Watch — low value density, high compliance burden |
| **Generic "do anything" agent** | "Open-ended 'do anything' agents remain stuck in pilots" | **No** |

**Two targets, one shared substrate problem.** Harness users give volume; enterprise governed
fleets give value. Both fail on the same things — context tax, round trips, un-attributable
spend, unreplayable runs. That is why a **kernel** beats a **tool**: it is the substrate both
need.

---

## C. The six ideas

Each carries: the forcing question, the primitive, demand evidence, the competitive check, the
end-user payoff, and what would falsify it.

### 1. The Agent Kernel — one typed language across browser + DB + SaaS

**Forcing question:** *What if an agent had an ABI instead of a catalogue?*

One harness-agnostic, host-side runtime where the model writes code against a **federated typed
surface** (browser, Postgres, REST/OpenAPI, local files) and only the *value* returns to the
context; intermediates stay inside a sandbox.

- **Demand:** primitives 1 and 2 — 40–50 % context tax, the ~32K correctness cliff, 42 %
  selection accuracy.
- **Competitive check:** Cloudflare (own API only), FastMCP (own servers), limen, agentgateway,
  pi-code-mode-mcp. **Every one is single-source or single-vendor. None spans browser + DB +
  SaaS across harnesses.**
- **End user:** "It finished in 90 seconds instead of 12 minutes, and the bill dropped 70 %."
- **Wedge:** ship the **browser + Postgres pair** first — the two the strategy names explicitly —
  not "everything, for everyone."
- **Falsifier:** a cross-source kernel does not beat a well-tuned single-source code-mode server
  on task completion or cost-per-task, across a representative task set.

### 2. The Evidence Browser — not a browser

**Forcing question:** *What if the browser returned claims, not pages?*

The browser market is saturated — browser-use (120K stars), chrome-devtools-mcp (55K),
Playwright MCP (39K), Stagehand (26K), plus Browserbase, Skyvern, BrowserPair, Simular,
Browserless, Steel. **A generic browser is a bad bet.** But every one of them returns *content*:
a tree, a DOM, a screenshot. None returns *verified facts*.

Output = structured claims, each carrying: the source span, a fetch timestamp, a
re-verification handle, and a confidence basis. Raw DOM retrievable only on demand.

- **Demand:** primitive 3 — ~35 % more hallucination without fresh data, 42 % wrong-tool
  selection, 65 % self-verification loops.
- **Competitive check:** Firecrawl extracts *structure*; nobody ships provenance-bearing,
  re-verifiable *claims*.
- **Extra wedge:** a **fleet-wide identity vault** — one human's auth, shared across every
  sub-agent, once. Nobody has this: browser-use cannot share a local Chrome profile concurrently;
  Playwright MCP runs one browser instance at a time.
- **End user:** "It stopped making things up, and when it does, I can check the line."
- **Falsifier:** claim-level output does not reduce hallucination or verification time versus
  the same agent given structured extraction with source spans.

### 3. The Admission Ledger — M-15b as a product

**Forcing question:** *Who owns a token, at the moment it is spent?*

Every platform reconstructs. M-15b measured that reconstruction is *provably* wrong while
reconciling the invoice exactly. The product captures ownership at the one moment it is
unambiguous — admission — and aggregates from there.

- **Demand:** primitive 4 and 5. Unity Gateway budgets; Snowflake's acquisition of Natoma for MCP
  governance and identity; G2's "visibility problem" (38 % run 100+ agents, 15 % run 501–1,000,
  usage growing faster than anticipated); Salesforce needing *steady* autonomous resolution at
  170× scale.
- **Competitive check:** spend *tracking* exists (LiteLLM, LangSmith, OpenTelemetry GenAI).
  **Admission-time ownership with per-task and per-sub-agent attribution does not.**
- **Human payoff:** the human's own bill becomes explainable — "38 % of your tokens went to
  sub-agents you never asked for."
- **Moat:** this is the lab's own falsified-mechanism IP, not a re-implementation of someone
  else's dashboard.
- **Falsifier:** on real multi-agent traffic with retries and shared sub-work, admission-time
  attribution is not measurably more accurate than the best post-hoc strategy.

### 4. The Replayable Agent — determinism as an enterprise product

**Forcing question:** *What would it take to hand an agent's run to an auditor and have it
re-execute identically?*

- **Demand:** primitive 5 — governance gates expansion, not capability. G2: "the next hurdle is
  giving agents more consequential work without adding enough supervision to erase the gains."
  40 % of GitHub PRs are AI-started and **none can be reproduced**.
- **Competitive check:** LangSmith/Langfuse/Braintrust **trace**; Temporal **replays workflows**.
  **Nobody does cross-machine, bit-identical replay of an LLM agent.**
- **End user:** "Every run arrives with a record I can re-execute, on any machine, and get the
  same bytes." That is the missing prerequisite for letting agents act unattended.
- **Our edge:** M-4 established replay determinism is architectural; M-16 supplies per-workload
  shaping; the E6 determinism matrix supplies the CI harness.
- **Falsifier:** bit-identical cross-machine replay cannot be achieved for realistic agent work
  (non-deterministic tool outputs, model version drift) — in which case the product becomes
  *verified re-execution within tolerance* rather than byte-identical replay.

### 5. The Skill Foundry — procedural memory mined from real runs

**Forcing question:** *Why does every org hand-write its agent procedures when it already runs
thousands of them?*

Agent Skills (donated to the Linux Foundation's AAIF alongside MCP) made progressive disclosure
standard. But skills are hand-authored per repo. **Nobody mines a team's actual runs to extract,
verify and publish them.**

- **Demand:** 63 % of MCP use is to access data sources ("people aren't wiring up MCP so agents
  can do things, they're wiring it up so agents to know things"); 65 % hit self-verification loops
  from contradictory tools; the registry holds 40,047 servers with the top 10 publishers holding
  18.7 % — supply-side swamp, demand-side for good procedure enormous.
- **Competitive check:** no public tooling mines runs into verified skills.
- **Our edge:** the lab's discipline — a skill is not published because someone wrote it, but
  because it **reproduced N times and beat the alternative.** Falsification as a product filter.
- **End user:** "My agent knows how to do *our* things, because it learned them from *our* runs."
- **Falsifier:** mined skills do not reduce token cost or raise success rate versus hand-written
  skills for the same task class.

### 6. The Shaped Fleet — per-workload κ scheduling

**Forcing question:** *If one concurrency heuristic serves every workload, who measured that?*

Every orchestrator today (LangGraph, Temporal, Kubernetes HPA, Bedrock AgentCore) uses one global
concurrency/rate heuristic.

- **Our measurement:** κ = E[X²]/E[X]² varied **1.0818 → 1.6569** across segments of real
  traffic (53 % relative spread; 24/28 segment pairs with non-overlapping 95 % CIs), and the
  fleet-wide κ lay **outside the CI of 8/8 segments**. A borrowed κ is wrong by up to ~50 % on
  delay.
- **Competitive check:** no scheduler is shaped per task class. Everyone fleet-averages — and
  we measured that the average is wrong everywhere.
- **End user:** "My long-running agent tasks finish in half the wall-clock and half the cost,
  because the fleet stopped over-provisioning for a sequential workload."
- **Falsifier:** per-class shaping does not reduce wall-clock or cost on a multi-class workload
  versus a well-tuned global heuristic.

---

## D. What NOT to build (and why)

| Tempting idea | Why no |
|---|---|
| Another agent browser | Saturated: browser-use 120K stars, chrome-devtools-mcp 55K, Playwright MCP 39K, Stagehand 26K. Commoditized by platform vendors. |
| Another MCP gateway | Cloudflare, FastMCP, Requesty, limen, agentgateway all ship it. Defensive, not offensive. |
| A generic "do-anything" agent | Stays in pilots (Aldric). The winners constrain scope deliberately. |
| A new SQL client for agents | Lakebase (Databricks, "serverless, mission-critical Postgres built for AI apps and agents"), Snowflake Cortex Agents and MCP-native DBs own it. |
| Another tracing/observability tool | LangSmith, Langfuse, Braintrust, OpenTelemetry. Crowded and well served. |
| An agent scheduler from scratch | Temporal, LangGraph, Bedrock AgentCore, K8s are incumbents. **Shape** the scheduler (idea 6); do not re-implement it. |

---

## E. Sequencing

**1 → 3 → 4.** The kernel (1) is the substrate everything else rides on — it *is* the tool-interface
fix. The ledger (3) attaches at admission, the one moment ownership can be captured correctly and
the only mechanism no platform ships. Replay (4) rides on both, and it is the capability that
unlocks the enterprise buyer.

**Idea 2 (Evidence Browser)** is the best *standalone* wedge: it can ship as a single binary any
harness connects to, and it converts a browsing tool into a *trust* tool — the differentiator no
platform currently ships.

**Ideas 5 and 6** are the moat: built on lab IP a competitor cannot easily buy, and both provable
with the lab's own falsification discipline.

### The validation to run first

> Full execution flow: `docs/PLAN-AGENT-FIRST.md` — eight gated steps (S0 measure → S1 re-rank
> → S2 falsify → S3 buyer → S4 artifact → S5 adversarial → S6 harvest → S7 decide), each with a
> self-contained agent brief.

Not a build — a **measurement**, and it uses machinery the lab already has:

> *Instrument a real Claude Code / OpenCode fleet and measure the context tax, the round-trip
> count, and the misattribution rate on real user traffic.*

If the lab's numbers reproduce on real user traffic (not only on our own session store), every idea
above has a receipt. If they do not, the ideas change. This experiment is a weekend.

**Why it comes first:** M-16's own corpus contains this experiment's own traffic, and the segments
are work types on one machine. The demand data in section B is from vendor surveys; the friction
data in section A is from vendor blog posts. Both need independent confirmation on traffic the lab
did not generate.

---

## F. Open questions (explicitly unresolved)

1. **Does the 42 % → 80 % tool-selection gain reproduce on agent traffic outside enterprise IT?**
   The measurement came from one production agent with Outlook/SharePoint/Jira/Confluence/Slack.
2. **How much of the 40–50 % context tax is harnesses' own tools rather than MCP?** Claude Code
   disables 100+ of its own tools in this very session under the same pressure.
3. **Is code mode safe for consequential actions?** The Conf42 team reports the model calling
   methods that do not exist, stale generated stubs after MCP server changes, and harder debugging.
   Failure modes were named but not quantified.
4. **Does admission-time ownership survive the stateless MCP transition (July 28, 2026 spec)?**
   Session-scoped ownership has no natural home in a stateless protocol.
5. **Can a sub-50 MB browser be both correct and fast?** The browser lane is crowded and the
   correctness bar is now "claims with provenance," which needs verification infrastructure the
   lite tier may not afford.
6. **What does the 32K correctness cliff imply for agent fleet design?** If correctness degrades
   past ~32K context, then the whole "give the agent more context" movement (1M-window marketing)
   may be actively harmful. This is the single most consequential unmeasured question here.
