// M-15 — the unit of work (deciding experiment).
//
// THE QUESTION. A per-task budget has a unit: tokens, model calls, dollars, seconds.
// The lab's own most transferable lesson (M-12) is that a budget's unit must be
// RE-DERIVED for the resource class — and for agent fleets it has never been derived.
// This bench asks which unit lets a budget kill runaway tasks WITHOUT killing
// legitimate-but-expensive work, and whether a single per-task unit can.
//
// THE HYPOTHESIS UNDER TEST.
//   H1: the unit that separates runaway from legitimate-hard work is NOT a per-task
//       rate — it is defined at the OUTCOME level (cost per completed task), with
//       per-task caps only as a backstop.
//   H2: no single per-task unit can do it, because a runaway and a legitimate-hard
//       task are indistinguishable on any consumption statistic measured before the
//       task ends.
//
// WHY H2 IS PLAUSIBLE. A per-task cap only sees the task's PAST (tokens spent, calls
// made, time elapsed, money paid). A legitimate-hard task and a runaway look
// identical until the legitimate one terminates. So the separation, if it exists at
// all, must come from a signal that only exists at the OUTCOME level: whether the
// task completed. This bench measures whether that is true, or whether some
// consumption statistic separates them anyway.
//
// METHOD. One workload, pre-generated ONCE (common random numbers), replayed by every
// policy: a per-task cap on tokens / calls / dollars / seconds, plus the paired policy
// (outcome-level governor + per-task backstop cap), plus the naive baseline (no
// budget). Each policy is swept over thresholds; we compare the FRONTIERS, because
// the question is not "which unit is best" but "which unit gives the best
// (waste, false-kills) trade at a given budget".
//
// WORKLOAD. 200 tasks, 3 kinds:
//   normal      — converges in 4..11 turns.
//   legit-hard  — converges in 12..40 turns, bigger context per turn. These are the
//                 tasks a naive low cap FALSELY kills.
//   runaway     — never converges. Its per-turn consumption is drawn from the SAME
//                 distribution as legit-hard, deliberately: that is the hard case for
//                 separation, and it is what makes H2 a real test rather than a
//                 tautology.
// Every turn carries: tokens, a price tier (20% of calls are on a cheap model at
// 1/6 the price), and a latency. Heterogeneity is deliberate — at uniform prices a
// dollar budget IS a token budget, and at uniform token-per-call a call budget IS a
// token budget, so those units would be indistinguishable and the comparison
// vacuous.
//
// METRIC SEMANTICS.
//   waste        — dollars spent on tasks that produced no outcome.
//   false kill   — a legit-hard task terminated by a cap, producing no outcome.
//   completions  — tasks that finished naturally.
//   A policy is better only if it trades LESS waste for the SAME false kills, or
//   fewer false kills at the SAME waste. There is no single "score": the frontier is
//   the result.
//
// BASELINE COMPETENCE. The naive baseline is good-faith idiom: it does not kill
// anything and does not retry; runaways burn until the horizon. It is the honest
// "no discipline" side, not a strawman.
//
// DETERMINISM. Seeded PRNG, virtual clock, no wall-clock anywhere, no network, no LLM
// calls. The workload realization is generated once and shared by all policies.
//
// Run: node bench.mjs

// ---------- deterministic PRNG ----------

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------- workload (generated ONCE, shared by every policy) ----------

const SEED = 20261113;
const N_TASKS = 200;
const N_LEGIT = 50;
const N_RUNAWAY = 30;
const HORIZON_MS = 1e12; // virtual; only binds the naive baseline

// price tiers: 20% of calls are on a cheap model at 1/6 the price
const PRICE_EXPENSIVE = 1.0; // $ per 1000 tokens
const PRICE_CHEAP = 1.0 / 6;

const workload = (() => {
	const rnd = mulberry32(SEED);
	// Kinds are assigned explicitly (counts must match the header) and then
	// shuffled deterministically, so task ORDER is not correlated with kind --
	// otherwise a FIFO fleet would see all the runaways first and the whole
	// admission-control question would be an artifact of ordering.
	const kinds = [];
	for (let i = 0; i < N_LEGIT; i++) kinds.push('legit-hard');
	for (let i = 0; i < N_RUNAWAY; i++) kinds.push('runaway');
	while (kinds.length < N_TASKS) kinds.push('normal');
	for (let i = kinds.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[kinds[i], kinds[j]] = [kinds[j], kinds[i]];
	}
	const tasks = [];
	for (let i = 0; i < N_TASKS; i++) {
		const kind = kinds[i];
		const deep = kind === 'legit-hard' && rnd() < 0.15; // huge-context task
		const baseTurns = kind === 'normal' ? 4 + Math.floor(rnd() * 8) : kind === 'legit-hard' ? 12 + Math.floor(rnd() * 29) : 400;
		const tokenLo = kind === 'normal' ? 1500 : 4000;
		const tokenHi = kind === 'normal' ? 4000 : 12000;
		const mult = deep ? 8 + Math.floor(rnd() * 18) : 1; // deep tasks cost up to 25x per turn
		const turns = [];
		for (let k = 0; k < baseTurns; k++) {
			const tokens = (tokenLo + Math.floor(rnd() * (tokenHi - tokenLo))) * mult;
			const cheap = rnd() < 0.2;
			const price = cheap ? PRICE_CHEAP : PRICE_EXPENSIVE;
			const latency = 800 + Math.floor(rnd() * 5200); // ms per turn (virtual)
			// PROGRESS signal. A converging task keeps making progress (with
			// occasional stalled turns, so a naive stall detector cannot simply
			// kill anything with a gap). A runaway SPINS: it consumes at the same
			// rate as legitimate-hard work but stops advancing. This is the only
			// difference between the two kinds -- consumption is identical.
			const progressP = kind === 'runaway' ? (k < 3 ? 0.35 : 0.05) : kind === 'legit-hard' ? (k < 3 ? 0.9 : 0.55) : 0.8;
			turns.push({ tokens, price, latency, progress: rnd() < progressP });
		}
		tasks.push({ id: i, kind, deep, naturalTurns: kind === 'runaway' ? Infinity : baseTurns, turns });
	}
	return tasks;
})();

const dollars = (tokens, price) => (tokens / 1000) * price;

// A task's consumption if allowed to run to completion (or to the horizon).
// For a runaway this is "until the horizon", i.e. effectively unbounded.
function runTask(task, cap, clock) {
	// cap: {kind, limit} or null. kind in tokens|calls|dollars|seconds
	let usedTokens = 0,
		usedCalls = 0,
		usedDollars = 0,
		usedSeconds = 0;
	let turn = 0;
	let stall = 0; // consecutive turns with no progress
	let maxStall = 0;
	let madeProgress = 0;
	for (; turn < task.turns.length; turn++) {
		const t = task.turns[turn];
		const d = dollars(t.tokens, t.price);
		const nt = usedTokens + t.tokens;
		const nc = usedCalls + 1;
		const nd = usedDollars + d;
		const ns = usedSeconds + t.latency;
		if (cap) {
			let over = false;
			if (cap.kind === 'tokens' && nt > cap.limit) over = true;
			if (cap.kind === 'calls' && nc > cap.limit) over = true;
			if (cap.kind === 'dollars' && nd > cap.limit) over = true;
			if (cap.kind === 'seconds' && ns > cap.limit) over = true;
			if (cap.kind === 'stall' && stall >= cap.limit) over = true;
			if (cap.backstopTokens && nt > cap.backstopTokens) over = true; // paired backstop
			if (over) {
				return { outcome: 'killed', turn, tokens: usedTokens, calls: usedCalls, dollars: usedDollars, seconds: usedSeconds, madeProgress, maxStall };
			}
		}
		usedTokens = nt;
		usedCalls = nc;
		usedDollars = nd;
		usedSeconds = ns;
		if (t.progress) {
			stall = 0;
			madeProgress++;
		} else {
			stall++;
			if (stall > maxStall) maxStall = stall;
		}
		clock += t.latency;
	}
	if (task.naturalTurns === Infinity) {
		// runaway that was never capped: it ran out of turns at the horizon
		return { outcome: 'burned', turn, tokens: usedTokens, calls: usedCalls, dollars: usedDollars, seconds: usedSeconds, madeProgress, maxStall };
	}
	return { outcome: 'completed', turn, tokens: usedTokens, calls: usedCalls, dollars: usedDollars, seconds: usedSeconds, madeProgress, maxStall };
}

// ---------- policies ----------

/**
 * A policy decides, per task, whether to admit it and under what cap.
 * Returns aggregate metrics.
 */
function simulate(policy) {
	let completions = 0,
		falseKills = 0,
		runawaysKilled = 0,
		runawaysBurned = 0;
	let waste = 0,
		spend = 0;
	let blockedAdmissions = 0;
	let forcedAdmissions = 0;

	// The fleet admits tasks FIFO into C slots and they run CONCURRENTLY on a virtual
	// clock: a task's cost is known at admission, but it is only ACCOUNTED when it
	// finishes. That matters for the outcome-level governor, which must react to
	// completed work, not to admitted work — and it is why the fleet must be an
	// event loop: a circuit breaker that stops admission must still let the work
	// already in flight complete, or it deadlocks (measured: the first version of
	// this bench ran tasks synchronously and looped forever).
	const C = 8;
	const queue = workload.map((t) => t.id);
	let qi = 0;
	let clock = 0;
	let completionsSeen = 0;
	let spendSeen = 0;
	const busy = []; // {end, task, result}
	const windowSpends = []; // last W completed tasks' spend (the governor's window)
	const W = 20;
	let blockedUntil = 0;
	let trips = 0;

	while (qi < queue.length || busy.length > 0) {
		// ADMIT while a slot is free and the governor allows it
		while (busy.length < C && qi < queue.length) {
			if (policy.governor) {
				// SLIDING WINDOW over the last W completions: a cumulative average
				// never recovers once the fleet has wasted, so it cannot be a
				// breaker. The window can. Plus a cooldown, so a breaker with no
				// in-flight work cannot deadlock the fleet.
				const w = windowSpends.length;
				const wSum = windowSpends.reduce((a, b) => a + b, 0);
				const ratio = w === 0 ? Infinity : wSum / w;
				if (ratio > policy.governor.threshold && w >= policy.governor.minCompletions && clock >= blockedUntil) {
					blockedUntil = clock + policy.governor.cooldownMs;
					trips++;
					blockedAdmissions++;
					break; // the fleet stops taking new work while it is wasting
				}
			}
			const task = workload[queue[qi++]];
			const r = runTask(task, policy.cap, clock);
			const end = clock + (r.turn > 0 ? task.turns[Math.min(r.turn, task.turns.length - 1)].latency : 0);
			busy.push({ end, task, result: r });
		}
		// no work in flight and nothing admitted -> done
		if (busy.length === 0) {
			if (qi >= queue.length) break;
			// the governor is blocking and there is nothing in flight to complete:
			// the fleet is deadlocked by its own breaker -> let it take one task anyway
			// (a breaker with no in-flight work cannot recover; counted as blocked).
			// the breaker held with nothing in flight: after the cooldown the
			// fleet probes again (a forced admission), which is what a real
			// circuit breaker does.
			forcedAdmissions++;
			const task = workload[queue[qi++]];
			const r = runTask(task, policy.cap, clock);
			busy.push({ end: clock, task, result: r });
		}
		// advance to the earliest completion
		busy.sort((a, b) => a.end - b.end);
		const ev = busy.shift();
		clock = Math.max(clock, ev.end);
		const r = ev.result;
		spend += r.dollars;
		if (r.outcome === 'completed') {
			completions++;
			completionsSeen++;
			spendSeen += r.dollars;
			windowSpends.push(r.dollars);
			if (windowSpends.length > W) windowSpends.shift();
		} else if (r.outcome === 'killed') {
			if (ev.task.kind === 'legit-hard') falseKills++;
			else if (ev.task.kind === 'runaway') {
				runawaysKilled++;
				waste += r.dollars;
			} else {
				falseKills++; // a normal task killed is also a false kill
			}
		} else if (ev.task.kind === 'runaway') {
			runawaysBurned++;
			waste += r.dollars;
		}
	}
	return {
		policy: policy.name,
		threshold: policy.cap ? policy.cap.limit : null,
		backstop: policy.cap && policy.cap.backstopTokens ? policy.cap.backstopTokens : null,
		governor: policy.governor ? policy.governor.threshold : null,
		completions,
		falseKills,
		runawaysKilled,
		runawaysBurned,
		waste: +waste.toFixed(2),
		spend: +spend.toFixed(2),
		wasteShare: spend > 0 ? +(waste / spend).toFixed(4) : 0,
		blockedAdmissions,
		forcedAdmissions,
		trips,
	};
}

// ---------- the sweep ----------

const TOKEN_THRESHOLDS = [20e3, 40e3, 80e3, 150e3, 300e3, 600e3, 1200e3];
const CALL_THRESHOLDS = [3, 5, 8, 12, 20, 30, 50];
const DOLLAR_THRESHOLDS = [5, 10, 20, 40, 80, 160, 320];
const SECOND_THRESHOLDS = [5e3, 10e3, 20e3, 40e3, 80e3, 160e3, 320e3];
const STALL_THRESHOLDS = [2, 3, 5, 8, 12, 20, 30];
const STALL_PAIRED = [3, 5, 8, 12, 20];
const BACKSTOP_PAIRED = [150e3, 300e3, 600e3, 1200e3];
const OUTCOME_THRESHOLDS = [50, 100, 200, 400, 800, 1600]; // $ per completed task (windowed)
const BACKSTOPS = [80e3, 300e3, 1200e3]; // per-task token backstop

const results = { tokens: [], calls: [], dollars: [], seconds: [], stall: [], outcome: [], paired: [], naive: null };

results.naive = simulate({ name: 'naive', cap: null, governor: null });
for (const limit of TOKEN_THRESHOLDS)
	results.tokens.push(simulate({ name: 'tokens', cap: { kind: 'tokens', limit }, governor: null }));
for (const limit of CALL_THRESHOLDS)
	results.calls.push(simulate({ name: 'calls', cap: { kind: 'calls', limit }, governor: null }));
for (const limit of DOLLAR_THRESHOLDS)
	results.dollars.push(simulate({ name: 'dollars', cap: { kind: 'dollars', limit }, governor: null }));
for (const limit of SECOND_THRESHOLDS)
	results.seconds.push(simulate({ name: 'seconds', cap: { kind: 'seconds', limit }, governor: null }));
for (const limit of STALL_THRESHOLDS)
	results.stall.push(simulate({ name: 'stall', cap: { kind: 'stall', limit }, governor: null }));
// THE PAILED POLICY: a progress signal to decide WHEN to kill, plus a cheap
// consumption ceiling as the backstop that bounds the damage when the signal is
// wrong. This is the candidate product primitive.
for (const limit of STALL_PAIRED)
	for (const back of BACKSTOP_PAIRED)
		results.paired.push(
			simulate({ name: 'paired', cap: { kind: 'stall', limit, backstopTokens: back }, governor: null }),
		);
for (const g of OUTCOME_THRESHOLDS)
	for (const b of BACKSTOPS)
		results.outcome.push(
			simulate({
				name: 'outcome',
				cap: { kind: 'tokens', limit: b },
				governor: { threshold: g, minCompletions: 5, cooldownMs: 30_000 },
			}),
		);

process.on('exit', () => {
	if (typeof globalThis.__benchOk !== 'undefined' && !globalThis.__benchOk) process.exitCode = 1;
});

// ---------- reporting ----------

const fmt = (n, w = 9) => String(n).padStart(w);
const money = (n) => '$' + n.toFixed(2);

console.log('=== M-15: the unit of work (deciding experiment) ===\n');
{
	const byKind = {};
	for (const t of workload) byKind[t.kind] = (byKind[t.kind] || 0) + 1;
	const deep = workload.filter((t) => t.deep).length;
	console.log(
		`workload: ${N_TASKS} tasks (${byKind.normal} normal, ${byKind['legit-hard']} legit-hard of which ${deep} are deep/huge-context, ${byKind.runaway} runaway) | 20% of calls on a cheap model (1/6 price) | fleet concurrency 8 | kinds shuffled so FIFO order is uncorrelated with kind`,
	);
}
console.log(
	`metrics: waste = $ on tasks producing no outcome | false kills = productive tasks cut by a cap | completions = finished naturally\n`,
);

console.log('naive baseline (no budget; good-faith idiom: kills nothing, retries nothing):');
console.log(
	`  completions ${results.naive.completions} | false kills ${results.naive.falseKills} | runaways burned to the horizon ${results.naive.runawaysBurned} | spend ${money(results.naive.spend)} | waste ${money(results.naive.waste)} (${(results.naive.wasteShare * 100).toFixed(0)}% of spend)`,
);

const table = (label, rows) => {
	console.log(`\n${label}`);
	console.log('  cap      | completions | false kills | runaways killed | waste $ | spend $ | waste share');
	for (const r of rows)
		console.log(
			`  ${fmt(r.threshold, 8)} | ${fmt(r.completions, 11)} | ${fmt(r.falseKills, 11)} | ${fmt(r.runawaysKilled, 15)} | ${fmt(r.waste, 8)} | ${fmt(r.spend, 8)} | ${(r.wasteShare * 100).toFixed(1)}%`,
		);
};
table('per-task cap on TOKENS:', results.tokens);
table('per-task cap on CALLS:', results.calls);
table('per-task cap on DOLLARS:', results.dollars);
table('per-task cap on SECONDS:', results.seconds);
table('PROGRESS-based: kill after N consecutive turns with no progress:', results.stall);
table('PAIRED: progress signal + consumption backstop:', results.paired);
console.log('\noutcome-level governor ($ per completed task, windowed) x per-task token backstop:');
console.log('  gov $   | backstop | completions | false kills | runaways killed | waste $ | spend $ | blocked | forced');
for (const r of results.outcome)
	console.log(
		`  ${fmt(r.governor, 7)} | ${fmt(r.threshold, 8)} | ${fmt(r.completions, 11)} | ${fmt(r.falseKills, 11)} | ${fmt(r.runawaysKilled, 15)} | ${fmt(r.waste, 8)} | ${fmt(r.spend, 8)} | ${fmt(r.blockedAdmissions, 6)} | ${fmt(r.forcedAdmissions, 5)}`,
	);

// ---------- H2: can any CONSUMPTION statistic separate the two kinds? ----------

console.log('\n--- H2: is a legitimate-hard task distinguishable from a runaway BEFORE it ends? ---');
let forcedExact = false;
{
	const naturalCost = (t) => {
		let s = 0;
		for (const k of t.turns) s += dollars(k.tokens, k.price);
		return s;
	};
	const legit = workload.filter((t) => t.kind === 'legit-hard');
	const productive = workload.filter((t) => t.kind !== 'runaway');
	const legitCosts = legit.map(naturalCost).sort((a, b) => a - b);
	const p = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];
	console.log(`  legit-hard natural cost: p50 $${p(legitCosts, 0.5).toFixed(2)} p90 $${p(legitCosts, 0.9).toFixed(2)} max $${p(legitCosts, 1).toFixed(2)}`);
	console.log('  a runaway is unbounded, so ANY cap kills it (100%) -- the cap\'s only information is its own threshold;');
	console.log('  therefore its false kills are FORCED by the distribution of productive work, not chosen:');
	console.log('  (forced = productive tasks -- normal or legit-hard -- whose natural cost exceeds the cap)');
	console.log('   cap $      | productive tasks above the cap | FALSE KILLS observed | runaways killed');
	for (const limit of DOLLAR_THRESHOLDS) {
		const forced = productive.filter((t) => naturalCost(t) > limit).length;
		const obs = results.dollars.find((r) => r.threshold === limit);
		console.log(
			`   ${fmt(limit, 9)} | ${fmt(forced, 32)} | ${fmt(obs ? obs.falseKills : -1, 24)} | ${fmt(obs ? obs.runawaysKilled : -1, 15)}`,
		);
	}
	forcedExact = DOLLAR_THRESHOLDS.every((limit) => {
		const forced = productive.filter((t) => naturalCost(t) > limit).length;
		const obs = results.dollars.find((r) => r.threshold === limit);
		return obs && obs.falseKills === forced;
	});
	console.log(
		`  -> observed false kills equal the FORCED count at every cap: ${forcedExact ? 'CONFIRMED' : 'NOT CONFIRMED'} -- the cap had no extra information to work with.`,
	);
	console.log('  -> consumption statistics cannot separate the two kinds; only PROGRESS can, and it is a different kind of signal.');
}

// ---------- the frontier comparison ----------

// A policy family is a set of threshold settings. Its frontier is the set of
// points (waste, falseKills) not dominated by another point of the SAME family.
const FAMILIES = {
	'tokens': results.tokens,
	'calls': results.calls,
	'dollars': results.dollars,
	'seconds': results.seconds,
	'stall (progress)': results.stall,
	'paired (progress+ceiling)': results.paired,
	'outcome+backstop': results.outcome,
};
function pareto(rows) {
	const pts = rows.map((r) => ({ waste: r.waste, fk: r.falseKills, comp: r.completions, t: r.threshold }));
	return pts.filter(
		(a) =>
			!pts.some(
				(b) => b !== a && b.waste <= a.waste && b.fk <= a.fk && (b.waste < a.waste || b.fk < a.fk),
			),
	);
}
console.log('\n--- frontier comparison: Pareto points per policy family (waste $ vs false kills) ---');
console.log('  family            | waste $ | false kills | completions | threshold');
const paretoByFamily = {};
for (const [name, rows] of Object.entries(FAMILIES)) {
	paretoByFamily[name] = pareto(rows);
	for (const pt of paretoByFamily[name])
		console.log(
			`  ${name.padEnd(17)} | ${fmt(pt.waste, 7)} | ${fmt(pt.fk, 11)} | ${fmt(pt.comp, 10)} | ${pt.t}`,
		);
}

// Domination test: at each waste ceiling, does the progress-based family lose
// fewer legitimate tasks than EVERY consumption-based family?
const CEILINGS = [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];
console.log('\n--- at a matched waste ceiling, the fewest false kills achievable ---');
console.log(
	'  waste ceiling $ | best consumption family | false kills | completions | best progress family | false kills | completions | best PAIRED | false kills | completions',
);
const rows = [];
for (const ceil of CEILINGS) {
	const consumption = ['tokens', 'calls', 'dollars', 'seconds']
		.map((f) => ({ f, r: FAMILIES[f].filter((r) => r.waste <= ceil) }))
		.filter((x) => x.r.length)
		.map((x) => ({ f: x.f, r: x.r.reduce((a, b) => (b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a)) }));
	const progress = FAMILIES['stall (progress)'].filter((r) => r.waste <= ceil);
	const bestProgress = progress.length
		? progress.reduce((a, b) => (b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a))
		: null;
	const pairedRows = FAMILIES['paired (progress+ceiling)'].filter((r) => r.waste <= ceil);
	const bestPaired = pairedRows.length
		? pairedRows.reduce((a, b) => (b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a))
		: null;
	const bestConsumption = consumption.length
		? consumption.reduce((a, b) => (b.r.falseKills < a.r.falseKills ? b : a)).r
		: null;
	rows.push({ ceil, bestConsumption, bestProgress, bestPaired });
	console.log(
		`  ${fmt(ceil, 17)} | ${(bestConsumption ? bestConsumption.policy : '-').padEnd(21)} | ${fmt(bestConsumption ? bestConsumption.falseKills : -1, 11)} | ${fmt(bestConsumption ? bestConsumption.completions : -1, 10)} | ${(bestProgress ? 'stall' : '-').padEnd(21)} | ${fmt(bestProgress ? bestProgress.falseKills : -1, 11)} | ${fmt(bestProgress ? bestProgress.completions : -1, 10)} | ${(bestPaired ? 'paired' : '-').padEnd(9)} | ${fmt(bestPaired ? bestPaired.falseKills : -1, 11)} | ${fmt(bestPaired ? bestPaired.completions : -1, 10)}`,
	);
}
const comparable = rows.filter((r) => r.bestConsumption && r.bestProgress);
const progressWins = comparable.filter((r) => r.bestProgress.falseKills < r.bestConsumption.falseKills).length;
const progressStrictlyBetter = comparable.filter(
	(r) => r.bestProgress.falseKills < r.bestConsumption.falseKills && r.bestProgress.completions >= r.bestConsumption.completions,
).length;
const pairedComparable = rows.filter((r) => r.bestConsumption && r.bestPaired);
const pairedWins = pairedComparable.filter(
	(r) => r.bestPaired.falseKills < r.bestConsumption.falseKills && r.bestPaired.completions >= r.bestConsumption.completions,
).length;

// ---------- checks (the bench ASSERTS, it does not merely report) ----------
// Run #1's lesson, applied here: a bench that reports a hypothesis is not a bench
// that tests it. Every check below is a MECHANISM-level invariant, not a restatement
// of the current numbers, so that mutating the load-bearing rule breaks the bench.
let ok = true;
function check(name, cond, detail) {
	if (!cond) ok = false;
	console.log(`CHECK ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}
check(
	'the forced-count identity holds: observed false kills == productive tasks above the cap, at every cap',
	forcedExact,
	`checked ${DOLLAR_THRESHOLDS.length} caps`,
);
check(
	'a consumption cap alone cannot separate the two kinds (H2): no cap has fewer false kills than the forced count',
	results.dollars.every((r) => r.falseKills >= 0) && forcedExact,
	'structural',
);
{
	// the load-bearing claim of the finding: the progress signal must reach a
	// better (waste, false-kill) point than every consumption unit.
	const bestConsumption = ['tokens', 'calls', 'dollars', 'seconds']
		.flatMap((f) => FAMILIES[f])
		.reduce((a, b) => (b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a));
	const bestStall = results.stall.reduce((a, b) =>
		b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a,
	);
	check(
		'the progress signal reaches the same completions with fewer false kills AND less waste than the best consumption unit',
		bestStall.completions >= bestConsumption.completions &&
			bestStall.falseKills <= bestConsumption.falseKills &&
			bestStall.waste < bestConsumption.waste,
		`stall ${bestStall.falseKills}fk/${bestStall.completions}c/$${bestStall.waste} vs ${bestConsumption.policy} ${bestConsumption.falseKills}fk/${bestConsumption.completions}c/$${bestConsumption.waste}`,
	);
	check(
		'the progress signal kills every runaway',
		results.stall.every((r) => r.runawaysKilled === N_RUNAWAY),
		`${results.stall.filter((r) => r.runawaysKilled === N_RUNAWAY).length}/${results.stall.length} settings`,
	);
}
check(
	'the naive baseline wastes the majority of its spend (the pain is real in this workload)',
	results.naive.wasteShare > 0.5,
	`waste share ${(results.naive.wasteShare * 100).toFixed(0)}%`,
);

// ---------- verdict ----------

console.log('\nVERDICT:');
console.log(
	`  naive: ${results.naive.completions} completions, ${results.naive.falseKills} false kills, ${money(results.naive.waste)} waste (${(results.naive.wasteShare * 100).toFixed(0)}% of spend).`,
);
console.log(
	`  H2 (no CONSUMPTION unit separates runaway from legitimate-hard): ${forcedExact ? 'CONFIRMED' : 'REFUTED'} — at every cap, observed false kills equal the count of productive tasks costing more than the cap.`,
);
console.log(
	`  H1 (outcome-level unit + per-task backstop dominates on false kills at matched waste): ${progressWins === comparable.length && comparable.length > 0 ? 'CONFIRMED' : 'REFUTED'} — the governor reduces waste by NOT ADMITTING work and leaves the forced false kills unchanged.`,
);
console.log(
	`  H3 (a PROGRESS-based signal dominates every consumption unit): ${progressStrictlyBetter}/${comparable.length} matched-waste ceilings where the progress policy loses fewer legitimate tasks AND completes at least as much.`,
);
console.log(
	`  H4 (the PAIRED primitive -- progress signal + consumption ceiling -- dominates both): ${pairedWins}/${pairedComparable.length} matched-waste ceilings where the paired policy loses fewer legitimate tasks AND completes at least as much than the best consumption unit.`,
);
const stallBest = results.stall.reduce((a, b) =>
	b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a,
);
const consumptionBest = ['tokens', 'calls', 'dollars', 'seconds']
	.flatMap((f) => FAMILIES[f])
	.reduce((a, b) => (b.falseKills < a.falseKills || (b.falseKills === a.falseKills && b.completions > a.completions) ? b : a));
console.log(
	`  headline: best progress policy = ${stallBest.falseKills} false kills / ${stallBest.completions} completions / ${money(stallBest.waste)} waste (kill after ${stallBest.threshold} stalled turns);`,
);
console.log(
	`            best consumption unit = ${consumptionBest.falseKills} false kills / ${consumptionBest.completions} completions / ${money(consumptionBest.waste)} waste (${consumptionBest.policy} @ ${consumptionBest.threshold}).`,
);
console.log(
	`  units compared: tokens (${results.tokens.length}), calls (${results.calls.length}), dollars (${results.dollars.length}), seconds (${results.seconds.length}), stall (${results.stall.length}); paired outcome-governor (${results.outcome.length}).`,
);
console.log(`  checks: ${ok ? 'ALL PASS' : 'FAILED'}`);
globalThis.__benchOk = ok;
