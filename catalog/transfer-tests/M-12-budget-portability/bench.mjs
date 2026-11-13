// M-12 transfer test — budget disciplines ported from TH04 (CPU/frame/slots)
// to agent-fleet resources (tokens / rate limits), extended with a network
// pathology layer.
//
// Discrete-event simulation, fully deterministic (virtual clock, hashed task
// model, hashed pathology tape, metered metrics — no LLM calls, no paid APIs).
// Every runtime processes the SAME task list through a simulated provider that
// applies the SAME pathology tape (same seed -> same draw per provider-call
// index), so the comparison isolates the runtime's discipline, not luck.
//
// Runtimes:
//   naive         : all tasks admitted at t=0, no concurrency discipline, no
//                   per-task budget (runaway agents loop to the horizon and
//                   burn the shared quota), retries with exponential backoff
//                   and NO jitter (synchronized retries -> thundering herd).
//   budgeted      : M-2 call pool (bounded slots leased to provider concurrency),
//                   M-11 per-task turn budget (runaways terminated, flagged),
//                   leased token bucket per minute (never 429s), M-5 one-time
//                   step-down on external quota halving, FIFO admission.
//   aimd          : Jacobson-style AIMD concurrency (additive increase on
//                   success, multiplicative decrease on loss) with NO provider
//                   cooperation, PLUS the M-11 per-task turn budget so the
//                   waste number is measured rather than assumed.
//   aimd_noBudget : AIMD concurrency alone (no M-11 budget) — isolates what
//                   AIMD contributes versus what the budget contributes.
//
// Network pathology (the layer added for the deciding experiment):
//   - latency jitter      : per-call added latency, drawn from the tape
//   - slow tail           : a fraction of calls take far longer than nominal
//   - client-side timeout  : the caller abandons the call after TIMEOUT_MS;
//                            the provider still billed the tokens (the harsh,
//                            realistic assumption: work happened, the bill grew,
//                            the caller never learned — this is the failure the
//                            T8 finding shows OpenCode does not budget for)
//   - partial failure      : 5xx responses (distinct from 429 rate limiting)
//
// Oracle: the orchestration trace (every scheduling/budget/retry decision, in
// order) is FNV-1a hashed per mode — replayable even though LLM completions are
// not.
//
// Run: node bench.mjs

// ---------- deterministic task model ----------

let SEED = 1; // set per run; every hash below mixes SEED -> same seed = same workload

function fnv1a(str) {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

const N_TASKS = 200;
const RUNAWAY_EVERY = 10; // every 10th task never converges

const tasks = [];
for (let i = 0; i < N_TASKS; i++) {
	const h = fnv1a(SEED + '-task-' + i);
	tasks.push({
		id: i,
		turnsNeeded: 4 + (h % 8), // 4..11 turns for real tasks
		runaway: i % RUNAWAY_EVERY === 3, // 20 runaway agents
	});
}

// ---------- simulated provider (shared quota — external, bursty) ----------
// Sized so BOTH the concurrency lease and the token quota bind.

const PROVIDER = {
	maxConc: 8,
	tpmStart: 15_000, // tokens per minute
	tpmAfterHalve: 7_500, // bursty external quota: halves after minute 1
	halveAtMinute: 1,
};

// ---------- network pathology (deterministic tape, shared across modes) ------

const PATHOLOGY = {
	jitterMs: 0, // baseline added latency per call
	jitterSpread: 60, // uniform 0..60 ms of added latency
	slowTailPermille: 20, // 2% of calls take far longer than nominal
	slowTailMsMin: 6_000,
	slowTailMsMax: 18_000,
	timeoutMs: 2_000, // client-side give-up deadline
	fail5xxPermille: 10, // 1% of calls return 503
};

// The tape: draw N is a pure function of (SEED, N), so every runtime sees the
// same pathology for the same provider-call index regardless of its own
// scheduling decisions. Same tape -> the difference between modes is caused by
// discipline, not by luck.
const tape = [];
for (let i = 0; i < 200_000; i++) {
	const h = fnv1a(SEED + '-path-' + i);
	const slow = (h % 1000) < PATHOLOGY.slowTailPermille;
	const slowMs = PATHOLOGY.slowTailMsMin + ((h >>> 7) % (PATHOLOGY.slowTailMsMax - PATHOLOGY.slowTailMsMin));
	tape.push({
		timeout: (h >>> 3) % 1000 < 0, // placeholder; timeouts are induced by the slow tail
		fail5xx: ((h >>> 10) % 1000) < PATHOLOGY.fail5xxPermille,
		jitter: PATHOLOGY.jitterMs + ((h >>> 20) % (PATHOLOGY.jitterSpread + 1)),
		slow,
		slowMs,
	});
}

const callTokens = (taskId, turn) => 600 + (fnv1a(SEED + '-c-' + taskId + '-' + turn) % 2400); // 600..3000
const callLatency = (tok) => 100 + Math.floor(tok / 10); // virtual ms nominal (fast calls: conc binds bursts, TPM binds sustained)

// ---------- the simulator ----------

const MODES = ['naive', 'budgeted', 'aimd', 'aimd_noBudget'];

function simulate(mode, horizon) {
	const trace = [];
	const emit = (s) => trace.push(`${clock}|${s}`);

	let clock = 0;
	let seq = 0;
	const events = []; // {t, seq, fn}
	const push = (t, fn) => events.push({ t, seq: seq++, fn });

	// provider state
	let conc = 0;
	let minute = -1;
	let minuteTokens = 0;
	let curTpm = PROVIDER.tpmStart;
	let providerCall = 0; // index into the shared pathology tape

	// provider-side outcome counters
	let four29s = 0;
	let timeouts = 0;
	let fivexx = 0;
	let stepdowns = 0;

	// task state
	const st = new Map();
	for (const t of tasks) {
		st.set(t.id, { turnsDone: 0, submitAt: null, done: false, budgetKilled: false, retryK: 0 });
	}

	const MAX_TURNS = 12; // M-11 per-task budget (budgeted + aimd runtimes)
	const hasBudget = mode === 'budgeted' || mode === 'aimd';
	const lagSamples = []; // non-runaway completed tasks
	let tokensTotal = 0;
	let runawayWaste = 0; // tokens spent on runaway tasks beyond MAX_TURNS (all modes)
	let retryAttempts = 0; // total retries (any cause)
	let doneReal = 0;
	let runawayStopped = 0;
	let peakHerd = 0; // max retries scheduled at the same virtual instant
	const herdAt = new Map(); // clock -> retries scheduled at that instant

	// budgeted runtime's pending FIFO + leases
	const pending = []; // {taskId, turn}
	let ownConcLease = PROVIDER.maxConc;
	let ownTokenLease = PROVIDER.tpmStart; // leased per-minute budget

	// aimd runtime state: discovers the quota without provider cooperation.
	// Two levers, because the provider has two scarce resources: a concurrency
	// ceiling and a token rate. TCP's congestion window is a BYTE window, so
	// the faithful port of AIMD to a token-rate limit needs a token window;
	// an AIMD with only a concurrency lever thrashes against a TPM ceiling
	// (it halve to C=1 and still exceeds the quota). Both windows are additive
	// on success and multiplicative on the loss that violated them.
	let aimdC = 1; // adaptive in-flight limit
	// the MSS floor applies to the INITIAL window too, or a single oversized
	// call at the head of the queue blocks admission forever (head-of-line
	// deadlock — measured as aimd 0/180 completion).
	let aimdW = Math.max(3000, Math.floor(PROVIDER.tpmStart / 8)); // adaptive token window per minute
	let aimdSuccesses = 0;
	let aimdLosses = 0;
	// Additive increase = ACK-clocking, the textbook rule: every completed
	// call is an ACK, and an ACK adds ONE SEGMENT's worth of window. So the
	// in-flight window grows by 1 slot per ACK and the token window grows by
	// the acknowledged call's own token count. (Growing by a small fixed
	// constant instead was ~40x too slow: the window never converged inside
	// the horizon and AIMD completed 73/180 instead of 180/180.)
	const AIMD_MAX = 64; // in-flight window ceiling
	const AIMD_W_MAX = PROVIDER.tpmStart * 2; // token window ceiling
	// MSS floor: the window may never shrink below one maximum-segment (one
	// call). TCP's cwnd has the same floor — without it, the window collapses
	// below a single transfer and the sender deadlocks (it can never admit
	// again). Measured here as an aimd 0/180 completion.
	const AIMD_W_MIN = 3000; // = max single-call tokens

	const minuteOf = (t) => Math.floor(t / 60000);
	const tpmFor = (m) => (m > PROVIDER.halveAtMinute ? PROVIDER.tpmAfterHalve : PROVIDER.tpmStart);

	function onMinuteRollover() {
		const m = minuteOf(clock);
		if (m === minute) return;
		minute = m;
		minuteTokens = 0;
		curTpm = tpmFor(m);
		if (mode === 'budgeted') {
			ownTokenLease = curTpm;
			if (curTpm === PROVIDER.tpmAfterHalve && stepdowns === 0) {
				// M-5: ONE-TIME step-down on observed quota change (lease halves)
				ownConcLease = Math.max(1, Math.floor(PROVIDER.maxConc / 2));
				stepdowns++;
				emit(`stepdown concLease=${ownConcLease}`);
			}
		}
		if (mode !== 'naive') pump();
		push((m + 1) * 60000, onMinuteRollover); // self-rescheduling: no horizon cap
	}

	function tryAdmitFromPending() {
		// Admission control. The client-side test uses the runtime's own view of
		// capacity (a lease for budgeted, a LEARNED window for aimd); the
		// provider-side test is the real external quota. Only the provider's
		// rejection is a loss signal.
		while (pending.length) {
			const { taskId, turn } = pending[0];
			const tok = callTokens(taskId, turn);

			// client-side admission test
			if (mode === 'budgeted') {
				if (conc >= ownConcLease) return;
				if (minuteTokens + tok > ownTokenLease) return; // wait for the next minute window
			} else if (isAimdMode()) {
				if (conc >= aimdC) return; // learned in-flight window is full -> wait (not a loss)
				if (minuteTokens + tok > aimdW) return; // learned token window is full -> wait (not a loss)
			}

			// provider-side enforcement: the true, external, bursty quota
			if (conc >= PROVIDER.maxConc || minuteTokens + tok > curTpm) {
				four29s++;
				if (isAimdMode()) {
					aimdLosses++;
					if (conc >= PROVIDER.maxConc) {
						aimdC = Math.max(1, Math.floor(aimdC / 2)); // multiplicative decrease
						emit(`aimd halve C=${aimdC}`);
					} else {
						aimdW = Math.max(AIMD_W_MIN, Math.floor(aimdW / 2)); // multiplicative decrease (MSS floor)
						emit(`aimd halve W=${aimdW}`);
					}
				}
				// DEQUEUE before re-queueing: leaving the head in place while
				// pushing a retry made the same task appear TWICE in the queue,
				// so it was admitted twice concurrently, finished twice, and
				// double-counted completions (measured 199/180 real tasks).
				pending.shift();
				const s = st.get(taskId);
				s.retryK++;
				retryAttempts++;
				noteHerd();
				push(clock + Math.min(4000, 100 * 2 ** Math.min(s.retryK, 6)), () => {
					pending.push({ taskId, turn });
					pump();
				});
				return;
			}

			pending.shift();
			fireTurn(taskId, turn, tok);
		}
	}
	function pump() {
		tryAdmitFromPending();
	}
	function isAimdMode() {
		return mode === 'aimd' || mode === 'aimd_noBudget';
	}

	// A client-side timeout: the caller gives up at timeoutMs, but the tokens
	// were already billed. The slot is released at the same instant (the
	// provider's work is abandoned, not completed).
	function scheduleTimeout(taskId, turn) {
		push(clock + PATHOLOGY.timeoutMs, () => {
			timeouts++;
			const s = st.get(taskId);
			s.retryK++;
			retryAttempts++;
			noteHerd();
			emit(`timeout t${taskId}#${turn}`);
			onClientFailure(taskId, turn, 'timeout');
		});
	}

	function noteHerd() {
		const n = (herdAt.get(clock) || 0) + 1;
		herdAt.set(clock, n);
		if (n > peakHerd) peakHerd = n;
	}

	function onClientFailure(taskId, turn, cause) {
		// budgeted: back onto the FIFO (lease-governed). aimd*: treat as a loss
		// signal. naive: immediate exp-backoff retry (no jitter -> herd).
		const s = st.get(taskId);
		if (mode === 'budgeted') {
			pending.push({ taskId, turn });
			pump();
			return;
		}
		if (mode === 'aimd' || mode === 'aimd_noBudget') {
			aimdLosses++;
			aimdC = Math.max(1, Math.floor(aimdC / 2)); // multiplicative decrease
			emit(`aimd halve C=${aimdC} cause=${cause}`);
		}
		const backoff = Math.min(4000, 100 * 2 ** Math.min(s.retryK, 6)); // exp backoff
		s.retryK++;
		retryAttempts++;
		noteHerd();
		push(clock + backoff, () => requestTurn(taskId, turn));
	}

	function fireTurn(taskId, turn, tok) {
		const path = tape[providerCall % tape.length];
		providerCall++;
		conc++;
		minuteTokens += tok;
		tokensTotal += tok;
		if (tasks[taskId].runaway && st.get(taskId).turnsDone >= MAX_TURNS) {
			runawayWaste += tok; // turns beyond the budget — counted for EVERY mode
		}
		emit(`turn t${taskId}#${turn} tok=${tok}`);
		const work = callLatency(tok) + path.jitter + (path.slow ? path.slowMs : 0);
		if (path.fail5xx) {
			// partial failure: the provider errors out; the slot frees at the
			// normal completion instant, the tokens are NOT billed as success.
			fivexx++;
			push(clock + work, () => {
				conc--;
				onMinuteRollover();
				emit(`5xx t${taskId}#${turn}`);
				onClientFailure(taskId, turn, '5xx');
			});
			return;
		}
		if (work > PATHOLOGY.timeoutMs) {
			// the call will time out client-side before the provider answers
			scheduleTimeout(taskId, turn);
			push(clock + PATHOLOGY.timeoutMs, () => {
				conc--; // slot released at give-up
				onMinuteRollover();
			});
			return;
		}
		push(clock + work, () => completeTurn(taskId, turn));
	}

	function requestTurn(taskId, turn) {
		if (mode !== 'naive') {
			// budgeted and aimd both admit through a queue; they differ in what
			// their admission test uses (a lease vs a learned window).
			pending.push({ taskId, turn });
			pump();
			return;
		}
		// naive: fire immediately; the provider 429s if over its limits
		const tok = callTokens(taskId, turn);
		const s0 = st.get(taskId);
		const backoffOf = (k) => Math.min(4000, 100 * 2 ** Math.min(k, 6)); // exp backoff, NO jitter
		if (conc >= PROVIDER.maxConc || minuteTokens + tok > curTpm) {
			four29s++;
			s0.retryK++;
			retryAttempts++;
			noteHerd();
			push(clock + backoffOf(s0.retryK), () => requestTurn(taskId, turn));
			return;
		}
		st.get(taskId).retryK = 0;
		fireTurn(taskId, turn, tok);
	}

	function completeTurn(taskId, turn) {
		conc--;
		onMinuteRollover();
		if (isAimdMode()) {
			aimdSuccesses++;
			if (aimdC < AIMD_MAX) {
				aimdC++; // ACK-clocked: one more in-flight slot per ACK
				emit(`aimd raise C=${aimdC}`);
			}
			const acked = callTokens(taskId, turn); // bytes acknowledged this RTT
			if (aimdW + acked <= AIMD_W_MAX) {
				aimdW += acked; // ACK-clocked: one segment worth of window
				emit(`aimd raise W=${aimdW}`);
			}
		}
		const s = st.get(taskId);
		s.turnsDone++;
		const t = tasks[taskId];
		const budgetHit = hasBudget && t.runaway && s.turnsDone >= MAX_TURNS;
		const finished = (s.turnsDone >= t.turnsNeeded && !t.runaway) || budgetHit;
		if (finished) {
			s.done = true;
			if (budgetHit) s.budgetKilled = true;
			if (t.runaway) {
				if (s.budgetKilled) runawayStopped++;
				// a runaway that somehow finished without being budget-killed
				// is NOT a completed real task and must not be counted as one
			} else {
				doneReal++;
				lagSamples.push(clock - s.submitAt);
			}
			emit(`done t${taskId}${s.budgetKilled ? ' BUDGET-KILLED' : ''}`);
			if (doneReal + runawayStopped === N_TASKS) {
				events.length = 0;
				return;
			} // all finished: stop self-rescheduling minute events
			if (mode !== 'naive') pump();
			return;
		}
		push(clock + 1, () => requestTurn(taskId, s.turnsDone));
		if (mode !== 'naive') pump();
	}

	function admitTask(taskId) {
		const s = st.get(taskId);
		s.submitAt = clock;
		emit(`admit t${taskId}`);
		requestTurn(taskId, 0);
	}

	// kickoff
	for (const t of tasks) admitTask(t.id);

	push(60000, onMinuteRollover); // first token-window boundary (both modes)

	// event loop
	let processed = 0;
	while (events.length && processed < 2_000_000) {
		events.sort((a, b) => a.t - b.t || a.seq - b.seq);
		const ev = events.shift();
		clock = Math.max(clock, ev.t);
		if (clock > horizon) break;
		ev.fn();
		processed++;
	}
	return {
		mode,
		simEnd: clock,
		tokensTotal,
		runawayWaste,
		four29s,
		timeouts,
		fivexx,
		retryAttempts,
		peakHerd,
		stepdowns,
		doneReal,
		runawayStopped,
		lagSamples,
		pendingLeft: mode !== 'naive' ? pending.length : NaN,
		traceHash: fnv1a(trace.join('\n')),
		traceLen: trace.length,
	};
}

// ---------- run: multi-seed (reproducibility demand: repeated runs, not one) ----------

const SEEDS = [1, 2, 3];
const runs = [];
for (const sd of SEEDS) {
	SEED = sd;
	const a = simulate('budgeted', Infinity);
	const b = simulate('budgeted', Infinity);
	const HORIZON = Math.max(a.simEnd, b.simEnd);
	const n = simulate('naive', HORIZON);
	const m = simulate('aimd', HORIZON);
	const m0 = simulate('aimd_noBudget', HORIZON);
	runs.push({ seed: sd, a, b, n, m, m0, horizon: HORIZON });
}
const realTasks = N_TASKS - tasks.filter((t) => t.runaway).length;

const lagPct = (arr, p) => {
	const s = [...arr].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const dollars = (tok) => ((tok / 1e6) * 2).toFixed(2); // $2 per 1M tokens
const med = (arr) => [...arr].sort((x, y) => x - y)[Math.floor(arr.length / 2)];
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

console.log('=== M-12 transfer test: agent-fleet budgets vs naive loop (with network pathology) ===\n');
console.log(
	`workload: ${N_TASKS} tasks (${tasks.filter((t) => t.runaway).length} runaway), provider ${PROVIDER.maxConc} conc / ${PROVIDER.tpmStart}->${PROVIDER.tpmAfterHalve} TPM (halves at minute ${PROVIDER.halveAtMinute})`,
);
console.log(
	`pathology: jitter 0..${PATHOLOGY.jitterSpread}ms | slow tail ${(PATHOLOGY.slowTailPermille / 10).toFixed(1)}% (${PATHOLOGY.slowTailMsMin}-${PATHOLOGY.slowTailMsMax}ms) | client timeout ${PATHOLOGY.timeoutMs}ms | 5xx ${(PATHOLOGY.fail5xxPermille / 10).toFixed(1)}%`,
);
console.log(
	`horizon: ${(runs[0].horizon / 60000).toFixed(1)} virtual minutes (budgeted runtime's completion time)\n`,
);

// ---------- the four-way table ----------

const headline = ['naive', 'budgeted', 'aimd', 'aimd_noBudget'];
const pick = (r, mode) => (mode === 'naive' ? r.n : mode === 'budgeted' ? r.a : mode === 'aimd' ? r.m : r.m0);

const row = (label, fn) =>
	console.log(
		label.padEnd(31) +
			headline.map((m) => String(fn(pick(runs[0], m))).padStart(14)).join('') +
			'   ',
	);
console.log('metric                        ' + headline.map((m) => m.padStart(14)).join(''));
row('real tasks completed', (x) => `${x.doneReal}/${realTasks}`);
row('runaway agents stopped', (x) => x.runawayStopped);
row('tokens total', (x) => num(x.tokensTotal));
row('tokens burned past budget', (x) => num(x.runawayWaste));
row('429 rate-limit rejections', (x) => num(x.four29s));
row('client timeouts', (x) => num(x.timeouts));
row('5xx partial failures', (x) => num(x.fivexx));
row('retry attempts', (x) => num(x.retryAttempts));
row('peak synchronized retries', (x) => num(x.peakHerd));
row('lag p50 (s)', (x) => (lagPct(x.lagSamples, 50) / 1000).toFixed(0));
row('lag p99 (s)', (x) => (lagPct(x.lagSamples, 99) / 1000).toFixed(0));
row('real tasks UNFINISHED', (x) => realTasks - x.doneReal);
row('$ spent', (x) => '$' + dollars(x.tokensTotal));
row('$ wasted (runaway)', (x) => '$' + dollars(x.runawayWaste));
row('step-downs (M-5)', (x) => x.stepdowns);

console.log('\noracle: orchestration trace hash per mode (two runs each, same seed)');
{
	const stable = (mode) => {
		const one = pick(runs[0], mode);
		const second = simulate(mode, runs[0].horizon);
		return one.traceHash === second.traceHash;
	};
	SEED = 1;
	for (const m of headline) {
		const x = pick(runs[0], m);
		console.log(
			`  ${m.padEnd(13)} ${x.traceHash.toString(16)} (${x.traceLen} decisions) — ${stable(m) ? 'replayable' : 'DIVERGED'}`,
		);
	}
}

console.log('\n--- what each discipline actually contributes (seed 1) ---');
{
	const n = runs[0].n, b = runs[0].a, m = runs[0].m, m0 = runs[0].m0;
	console.log(
		`  aimd_noBudget vs naive : completes ${m0.doneReal}/${realTasks} vs ${n.doneReal}/${realTasks}; waste ${num(m0.runawayWaste)} vs ${num(n.runawayWaste)} — AIMD bounds the *concurrency*, not the per-task spend`,
	);
	console.log(
		`  aimd (with M-11 budget) : completes ${m.doneReal}/${realTasks}, waste ${num(m.runawayWaste)}, ${num(m.four29s)} 429 probes — the same completion+waste win as budgeted,`,
	);
	console.log(
		`                            without a lease (it must probe for the quota: ${num(m.four29s)} 429s vs budgeted ${num(b.four29s)})`,
	);
	console.log(
		`  budgeted                 : ${num(b.four29s)} 429s, ${num(b.timeouts)} timeouts, peak herd ${num(b.peakHerd)} — leased, so it never probes`,
	);
	console.log(
		`  naive                    : ${num(n.four29s)} 429s, peak herd ${num(n.peakHerd)} retries at one instant — no jitter means the herd synchronizes`,
	);
}

console.log('\n--- multi-seed reproducibility (3 seeds, same provider/workload/pathology shape) ---');
for (const r of runs) {
	const parts = headline.map((m) => {
		const x = pick(r, m);
		return `${m} ${x.doneReal}/${realTasks} done, ${num(x.runawayWaste)} waste, ${num(x.four29s)} 429, ${num(x.timeouts)} to`;
	});
	console.log(`  seed ${r.seed}: ` + parts.join(' | '));
}
console.log(
	`  median: ` +
		headline
			.map(
				(m) =>
					`${m} ${med(runs.map((r) => pick(r, m).doneReal))}/${realTasks} done, ${(med(runs.map((r) => pick(r, m).runawayWaste / Math.max(1, pick(r, m).tokensTotal))) * 100).toFixed(0)}% waste`,
			)
			.join(' | '),
);
console.log(
	`  oracle across seeds: ${runs.every((r) => r.a.traceHash === r.b.traceHash) ? 'trace-hash stability holds per seed (hashes differ across seeds by design — different workloads)' : 'FAILED'}`,
);

// capacity proof (the measurement product wedge): given the observed workload,
// what concurrency/token-quota finishes the queue within a target lag?
{
	const totalTok = runs[0].a.tokensTotal;
	const targetLagMin = 60;
	const reqRate = (totalTok / (targetLagMin * 60000)) * 1000;
	console.log('\n--- capacity proof (measurement product, demonstrated) ---');
	console.log(
		`  workload: ${Math.round(totalTok).toLocaleString('en-US')} tokens across ${N_TASKS} tasks; target: all done in <=${targetLagMin} min of provider time`,
	);
	console.log(
		`  required sustained quota: ${Math.ceil(reqRate * 60).toLocaleString()} tokens/min (${(reqRate / 1000).toFixed(1)}k tok/s)`,
	);
	console.log(
		`  at the observed ${PROVIDER.tpmAfterHalve} TPM steady quota: projected finish ${(totalTok / PROVIDER.tpmAfterHalve).toFixed(0)} min; naive never finishes (runaway share)`,
	);
	console.log(
		`  recommendation: either raise quota to ${Math.ceil(reqRate * 60).toLocaleString()} TPM, or run ${Math.ceil(reqRate * 60 / PROVIDER.tpmAfterHalve)}x parallel tenants, or shed 20% of spend via per-task budgets`,
	);
}

console.log('\nverdict:');
console.log(
	`  the TH04 disciplines (pool / budget / step-down) port to token+quota resources, and the network pathology layer separates the disciplines:`,
);
console.log(
	`  - the M-11 per-task budget is what stops runaway SPEND (${num(runs[0].n.runawayWaste)} -> ${num(runs[0].m.runawayWaste)} tok with AIMD, ${num(runs[0].b.runawayWaste)} with the lease) — AIMD alone does NOT:`,
);
console.log(
	`  - a leased bucket avoids probe traffic entirely (${num(runs[0].b.four29s)} 429s); AIMD must pay for discovery (${num(runs[0].m.four29s)} 429 probes) to get the same completion`,
);
console.log(
	`  - without jitter, retries synchronize: naive peaked at ${num(runs[0].n.peakHerd)} retries in one instant`,
);
console.log(
	`  and the orchestration trace replays byte-identically across runs (oracle: ${runs[0].a.traceHash.toString(16)}).`,
);
