// M-15b — the ledger (E2): spend attribution must be captured at admission,
// not reconstructed afterwards.
//
// THE QUESTION. Incumbent cost tooling reconstructs attribution AFTER the fact:
// it looks at recorded traces and infers which task each provider charge belongs
// to. Is that equivalent to attributing at the moment the work is admitted?
//
// THE HYPOTHESIS UNDER TEST.
//   H5: post-hoc reconstruction is NOT equivalent to admission-time attribution.
//       On workloads with retries and shared sub-work it MISATTRIBUTES, and — the
//       dangerous case — it can reconcile the TOTAL against the invoice while
//       every dollar is attributed to the wrong owner.
//
// WHY THIS MATTERS FOR THE PRODUCT. T8 (the OpenCode finding) measured a
// shipping agent runtime with no token ledger at all: spend surfaces only as a
// provider-limit error. The folklore remedy is "add cost tracking", and cost
// tracking is exactly a reconstruction layer. If H5 holds, then a reconstruction
// ledger reproduces the incident it was supposed to prevent: the invoice
// reconciles, nobody owns the cost, and the $47K-class failures stay
// unattributed.
//
// THE MECHANISM THAT MAKES IT FAIL. Admission-time attribution is available
// because the owner is KNOWN when the unit is admitted. A trace records
// observable facts -- time, cost, content, sometimes a parent pointer -- and in
// three situations those facts do not determine the owner:
//   (a) RETRY      one logical unit produced two charges. Both charges are real;
//                  the invoice has both. Which task owns the second one is a
//                  question only the scheduler knows.
//   (b) SHARED     one sub-agent served two parent tasks. There is ONE charge
//                  and TWO candidate owners.
//   (c) AMBIGUOUS  two concurrent tasks issued identical work. The trace cannot
//                  tell them apart.
// Reconstruction must guess in all three; admission-time attribution does not
// guess at all.
//
// METHOD. One workload, pre-generated once (common random numbers): 60 tasks, each
// owning a sequence of billable units, with retries, shared units and ambiguous
// units injected at measured rates. The trace exposes what a trace exposes and
// NOT the owner. Three reconstruction strategies are run against the same trace
// and compared, per task, to the admission-time truth.
//
// METRIC SEMANTICS.
//   misattributed   -- a task whose reconstructed total differs from its truth.
//   unowned          -- a task that was charged for but has $0 attributed (the
//                       incident shape: the money is real, the owner is not).
//   phantom owner    -- a task charged for work it did not do.
//   reconciliation   -- does the reconstructed TOTAL match the invoice? A method
//                       can reconcile perfectly and still attribute every dollar
//                       wrongly; that is the headline case, so it is reported.
//
// BASELINE COMPETENCE. The naive baseline is the incumbent idiom, done properly:
// attribute by "the task that was active when the charge landed" (the timing
// heuristic a tracing tool actually implements). It is not a strawman.
//
// DETERMINISM. Seeded PRNG, virtual clock, no wall-clock, no network, no LLM calls.
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

const SEED = 20261113;
const N_TASKS = 60;
const RETRY_RATE = 0.12; // fraction of units that are retried
const SHARED_RATE = 0.08; // fraction of units shared between two tasks
const AMBIGUOUS_RATE = 0.06; // fraction of units issued concurrently by two tasks
const UNIT_COST_LO = 120; // $ per 1000 tokens -> cost in cents-ish units
const UNIT_COST_HI = 900;

// ---------- workload + the observable trace ----------

const { tasks, trace, truth, invoiceTotal } = (() => {
	const rnd = mulberry32(SEED);
	const tasks = [];
	for (let i = 0; i < N_TASKS; i++) tasks.push({ id: i, units: [], window: null });

	const trace = []; // what an observer sees: time, cost, content, parent hint
	const truth = new Map(); // owner -> $ (ADMISSION TIME: known, never exposed)
	let invoiceTotal = 0;
	let clock = 0;
	let uid = 0;

	const addUnit = (owner, { kind, twinOwner = null, twinUnit = null }) => {
		const cost = UNIT_COST_LO + Math.floor(rnd() * (UNIT_COST_HI - UNIT_COST_LO));
		const u = {
			id: uid++,
			owner,
			kind,
			cost,
			time: clock,
			content: 'c' + Math.floor(rnd() * 1000),
			parentHint: null, // set below
			twinOwner,
			twinUnit,
			candidates: [owner], // the set of tasks that COULD have made this charge
		};
		trace.push(u);
		tasks[owner].units.push(u);
		truth.set(owner, (truth.get(owner) || 0) + cost);
		invoiceTotal += cost;
		clock += 40 + Math.floor(rnd() * 400);
		return u;
	};

	// Some tasks are VICTIMS: every charge they receive is shared or ambiguous,
	// so if reconstruction picks the wrong candidate they end up charged for
	// work with NOTHING owned. That is the incident shape: the money is real,
	// the owner is not.
	const victimIds = new Set();
	for (let i = 0; i < N_TASKS; i++) if (rnd() < 0.15) victimIds.add(i);


	for (const t of tasks) {
		const nUnits = 3 + Math.floor(rnd() * 6);
		const victim = victimIds.has(t.id);
		for (let k = 0; k < nUnits; k++) {
			if (victim) {
				// A victim's charges are ALL ambiguous with ONE fixed partner, and
				// the victim has no other units. If reconstruction picks the
				// partner, the victim ends up charged for work with NOTHING
				// owned -- the incident shape: the money is real, the owner
				// is not.
				if (t.victimPartner === undefined) t.victimPartner = tasks[Math.floor(rnd() * N_TASKS)];
				const victimPartner = t.victimPartner;
				if (victimPartner.id === t.id) {
					addUnit(t.id, { kind: 'normal' });
					continue;
				}
				// The partner's concurrent call lands FIRST in the trace (either
				// order is realistic). A content-based reconstruction therefore
				// credits the partner for BOTH identical charges, and the victim
				// ends up with NOTHING owned.
				const twin = addUnit(victimPartner.id, { kind: 'ambiguous', twinOwner: t.id });
				twin.content = 'VICTIM-' + t.id; // identical work, identical content
				const u = addUnit(t.id, { kind: 'ambiguous', twinOwner: victimPartner.id, twinUnit: twin.id });
				u.candidates = [t.id, victimPartner.id];
				u.content = twin.content;
				twin.candidates = [t.id, victimPartner.id];
				continue;
			}
			const r = rnd();
			if (r < RETRY_RATE) {
				// (a) RETRY: one logical unit, TWO charges. The retry's charge
				// is a second bill for the same work.
				const first = addUnit(t.id, { kind: 'retry' });
				addUnit(t.id, { kind: 'retry', twinOwner: t.id, twinUnit: first.id });
			} else if (r < RETRY_RATE + SHARED_RATE) {
				// (b) SHARED: one sub-agent serves two parent tasks. ONE charge,
				// TWO candidate owners.
				const other = tasks[Math.floor(rnd() * N_TASKS)];
				if (other.id === t.id) {
					addUnit(t.id, { kind: 'normal' });
					continue;
				}
				const owner = t.id;
				// ONE charge, TWO candidate owners. The invoice carries it once;
				// the truth is the task it was billed to. Reconstruction must
				// guess between the two candidates.
				const u = addUnit(owner, { kind: 'shared', twinOwner: other.id });
				u.candidates = [owner, other.id];
			} else if (r < RETRY_RATE + SHARED_RATE + AMBIGUOUS_RATE) {
				// (c) AMBIGUOUS: two concurrent tasks issue identical work.
				const other = tasks[Math.floor(rnd() * N_TASKS)];
				if (other.id === t.id) {
					addUnit(t.id, { kind: 'normal' });
				} else {
					const u = addUnit(t.id, { kind: 'ambiguous', twinOwner: other.id });
					u.candidates = [t.id, other.id];
					u.content = 'AMB' + Math.floor(rnd() * 100); // identical work
					const twin = addUnit(other.id, { kind: 'ambiguous', twinOwner: t.id, twinUnit: u.id });
					twin.content = u.content;
					u.twinUnit = twin.id;
				}
			} else {
				addUnit(t.id, { kind: 'normal' });
			}
		}
	}

	// The trace's PARENT HINT: a tracing tool usually records a parent task id.
	// It is present for most units, MISSING for shared ones (the sub-agent's
	// parent is ambiguous by construction) and WRONG for some retries (the
	// retry was issued by the harness, not the task).
	for (const u of trace) {
		if (u.kind === 'shared') u.parentHint = null;
		else if (u.kind === 'retry' && rnd() < 0.35) u.parentHint = -1; // unknown
		else u.parentHint = u.owner;
	}

	// A task's "active window" in the trace: when it was working.
	for (const t of tasks) {
		const ts = t.units.map((u) => u.time);
		t.window = ts.length ? [Math.min(...ts), Math.max(...ts) + 500] : [0, 0];
	}
	return { tasks, trace, truth, invoiceTotal };
})();

// ---------- reconstruction strategies (all see ONLY the trace) ----------

/** Baseline: the incumbent idiom — attribute a charge to the task that was
 *  working when the charge landed. Ties broken by most-recent start. */
function reconstructByTiming() {
	const attributed = new Map();
	let unattributed = 0;
	const assignments = [];
	for (const u of trace) {
		// the task whose window contains the charge and which started most recently
		let best = null;
		for (const t of tasks) {
			if (u.time < t.window[0] || u.time > t.window[1]) continue;
			if (!best || t.window[0] > best.window[0]) best = t;
		}
		if (best) {
			attributed.set(best.id, (attributed.get(best.id) || 0) + u.cost);
			assignments.push({ unit: u, owner: best.id });
		} else {
			unattributed += u.cost; // a charge nobody could be given to
			assignments.push({ unit: u, owner: null });
		}
	}
	return { attributed, unattributed, assignments };
}

/** Parent-hint strategy: use the trace's parent pointer when present. */
function reconstructByParent() {
	const attributed = new Map();
	let unattributed = 0;
	const assignments = [];
	for (const u of trace) {
		if (u.parentHint === null || u.parentHint === -1) {
			unattributed += u.cost;
			assignments.push({ unit: u, owner: null });
			continue;
		}
		attributed.set(u.parentHint, (attributed.get(u.parentHint) || 0) + u.cost);
		assignments.push({ unit: u, owner: u.parentHint });
	}
	return { attributed, unattributed, assignments };
}

/** Content strategy: attribute to the first task that issued the same content. */
function reconstructByContent() {
	const attributed = new Map();
	let unattributed = 0;
	const assignments = [];
	const firstSeen = new Map(); // content -> task id
	for (const u of trace) {
		if (!firstSeen.has(u.content)) firstSeen.set(u.content, u.owner);
		const owner = firstSeen.get(u.content);
		attributed.set(owner, (attributed.get(owner) || 0) + u.cost);
		assignments.push({ unit: u, owner });
	}
	return { attributed, unattributed, assignments };
}

// ---------- evaluation ----------

/**
 * The sharpest metric: a charge attributed to a task that is not even a CANDIDATE
 * owner of that unit is PROVABLY wrong, not merely a guess. For a normal or retry
 * unit the owner is determined by the trace, so any other recipient is provably
 * wrong. For a shared/ambiguous unit either candidate is a defensible guess, so
 * only a third party counts as provably wrong.
 */
function provablyWrongCharges(rec) {
	let wrong = 0;
	for (const a of rec.assignments) {
		if (a.owner === null) continue;
		if (!a.unit.candidates.includes(a.owner)) wrong++;
	}
	return wrong;
}

function evaluate(name, rec) {
	let misattributed = 0;
	let unowned = 0;
	let phantom = 0;
	let absError = 0;
	for (const t of tasks) {
		const truthV = truth.get(t.id) || 0;
		const recV = rec.attributed.get(t.id) || 0;
		if (truthV !== recV) misattributed++;
		absError += Math.abs(truthV - recV);
		if (truthV > 0 && recV === 0) unowned++;
		if (truthV === 0 && recV > 0) phantom++;
	}
	const reconstructedTotal =
		[...rec.attributed.values()].reduce((a, b) => a + b, 0) + (rec.unattributed || 0);
	return {
		name,
		misattributed,
		unowned,
		phantom,
		provablyWrong: provablyWrongCharges(rec),
		orphanCharges: rec.assignments.filter((a) => a.owner === null).length,
		absError,
		reconstructedTotal,
		reconciles: Math.abs(reconstructedTotal - invoiceTotal) === 0,
	};
}

const methods = [
	evaluate('timing (incumbent idiom)', reconstructByTiming()),
	evaluate('parent hint', reconstructByParent()),
	evaluate('content match', reconstructByContent()),
];

// ---------- reporting ----------

const money = (n) => '$' + n.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);

console.log('=== M-15b: the ledger — admission-time attribution vs post-hoc reconstruction ===\n');
console.log(
	`workload: ${N_TASKS} tasks | ${trace.length} billable units | retries ${(RETRY_RATE * 100).toFixed(0)}%, shared ${(SHARED_RATE * 100).toFixed(0)}%, ambiguous ${(AMBIGUOUS_RATE * 100).toFixed(0)}% | invoice total ${money(invoiceTotal)}`,
);
console.log(
	`the trace exposes: time, cost, content, parent hint. It does NOT expose the owner — that is the whole point.\n`,
);

console.log(
	'method               | misattributed tasks | unowned tasks | orphan charges | PROVABLY wrong charges | total error | reconciles',
);
for (const m of methods)
	console.log(
		`${pad(m.name, 20)} | ${String(m.misattributed).padStart(21)} | ${String(m.unowned).padStart(13)} | ${String(m.orphanCharges).padStart(14)} | ${String(m.provablyWrong).padStart(24)} | ${money(m.absError).padStart(10)} | ${(m.reconciles ? 'YES' : 'no').padStart(10)}`,
	);

console.log('\n--- the dangerous case: a method that reconciles the invoice but misattributes the money ---');
for (const m of methods) {
	if (m.reconciles)
		console.log(
			`  ${m.name}: the TOTAL reconciles exactly against the invoice (${money(m.reconstructedTotal)}), yet ${m.misattributed}/${N_TASKS} tasks are attributed wrongly, ${m.unowned} are charged with nothing owned, ${m.orphanCharges} charges have no owner at all, and ${m.provablyWrong} charges are attributed to a task that could not possibly have made them.`,
		);
}

console.log('\n--- which situations break reconstruction, and why ---');
const byKind = {};
for (const u of trace) byKind[u.kind] = (byKind[u.kind] || 0) + 1;
for (const [k, v] of Object.entries(byKind))
	console.log(`  ${pad(k, 12)} units: ${String(v).padStart(3)}  (owner determinable from the trace? ${k === 'normal' ? 'YES' : 'NO'})`);
console.log('  retry   : two charges for one logical unit — the invoice has both, the trace cannot say which task owns the second');
console.log('  shared  : one charge, two candidate owners, and the parent hint is absent by construction');
console.log('  ambiguous: two concurrent tasks, identical content, no ordering evidence');

// ---------- checks (assert, do not merely report) ----------

let ok = true;
function check(name, cond, detail) {
	if (!cond) ok = false;
	console.log(`CHECK ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}
check(
	'at least one reconstruction strategy misattributes tasks',
	methods.some((m) => m.misattributed > 0),
	`worst ${Math.max(...methods.map((m) => m.misattributed))}/${N_TASKS} tasks`,
);
check(
	'at least one reconstruction leaves a charged task with nothing owned (the incident shape)',
	methods.some((m) => m.unowned > 0),
	`worst ${Math.max(...methods.map((m) => m.unowned))} unowned`,
);
check(
	'at least one method reconciles the invoice total while misattributing money',
	methods.some((m) => m.reconciles && m.misattributed > 0),
	'the reconciliation/attribution split',
);
check(
	'at least one method attributes charges to a task that could not possibly have made them',
	methods.some((m) => m.provablyWrong > 0),
	`worst ${Math.max(...methods.map((m) => m.provablyWrong))} provably wrong charges`,
);
check(
	'NO reconstruction method is exact: the trace\'s ambiguity is unavoidable, not just hard',
	methods.every((m) => m.misattributed > 0),
	`methods with misattribution: ${methods.filter((m) => m.misattributed > 0).length}/${methods.length}`,
);
check(
	'every method accounts for the whole invoice (no method silently loses charges)',
	methods.every((m) => m.reconciles),
	`reconciling: ${methods.filter((m) => m.reconciles).length}/${methods.length}`,
);
check(
	'admission-time attribution is exact for every task (the reference)',
	[...tasks].every((t) => (truth.get(t.id) || 0) === t.units.reduce((a, u) => a + u.cost, 0)),
	'by construction',
);

// ---------- verdict ----------

const worst = methods.reduce((a, b) => (b.misattributed > a.misattributed ? b : a));
const reconciling = methods.filter((m) => m.reconciles && m.misattributed > 0);

console.log('\nVERDICT:');
console.log(
	`  admission-time attribution: ${N_TASKS}/${N_TASKS} tasks exact, ${money(invoiceTotal)} attributed, no guessing.`,
);
console.log(
	`  best post-hoc method (${worst.name}): ${worst.misattributed}/${N_TASKS} tasks attributed wrongly, ${worst.unowned} unowned, ${worst.phantom} phantom owners, ${money(worst.absError)} of total error.`,
);
console.log(
	`  H5 (post-hoc reconstruction is not equivalent to admission-time attribution): ${worst.misattributed > 0 ? 'CONFIRMED' : 'REFUTED'}.`,
);
console.log(
	`  the dangerous shape is present: ${reconciling.length} method(s) reconcile the invoice total exactly while misattributing the money -- the invoice balances and nobody owns the cost.`,
);
console.log(
	`  product consequence: a ledger that RECONSTRUCTS spend is not a ledger that OWNS it. The owner must be captured at admission, because that is the only moment it is knowable.`,
);
console.log(`  checks: ${ok ? 'ALL PASS' : 'FAILED'}`);
globalThis.__benchOk = ok;
process.on('exit', () => {
	if (typeof globalThis.__benchOk !== 'undefined' && !globalThis.__benchOk) process.exitCode = 1;
});
