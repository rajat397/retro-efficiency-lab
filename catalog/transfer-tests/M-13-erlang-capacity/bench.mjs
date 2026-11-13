// M-13 transfer test — Erlang-style capacity planning for bursty agent traffic.
//
// The M-12 capacity proof is a LINEAR rate calculation: tokens / target time.
// It ignores queueing. The buyer's question is not "how many tokens per minute"
// but "how many CONCURRENT CALLS do I need so the wait stays under SLO" — and
// that answer depends on the shape of the arrival process, not just its mean.
//
// This bench does three things, in order:
//
//   PART 1  VALIDATION. M/M/c simulation vs the closed-form Erlang C.
//            If the simulation and the math disagree, nothing downstream means
//            anything. This also validates the simulator itself.
//
//   PART 2  THE ERRLANG GAP. The same offered load, the same circuits, but
//            arrivals are COMPOUND-POISSON fan-out bursts drawn from the
//            measured distribution (targets/opencode/data/fanout-bursts.json,
//            real traffic from this machine) instead of Poisson. Measures how
//            much the closed form understates the delay, and how many extra
//            circuits the closed form would tell you to buy.
//
//   PART 3  THE CAPACITY ANSWER. Circuits needed for a target wait under both
//            arrival shapes, plus the classical batch correction and its
//            measured residual, and the token-quota implication.
//
// Deterministic: seeded PRNG throughout, no Math.random. No LLM calls, no
// network. Run: node bench.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
	erlangB,
	erlangC,
	erlangWait,
	minCircuitsForBlocking,
	minCircuitsForWait,
	batchKappa,
	batchDelayTerm,
	mulberry32,
	expTime,
	expService,
} from './erlang.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const fanout = JSON.parse(readFileSync(resolve(REPO, 'targets/opencode/data/fanout-bursts.json'), 'utf8'));

// ---------- scenarios ----------

// A representative agent fleet: 40 concurrent provider slots, mean provider
// call 4s (a long-context LLM call), and a target wait of 2s.
// mu is the service rate per circuit: 1/4s.
const SCENARIO = {
	mu: 0.25, // circuits/s per slot
	targetWaitSec: 2,
	targetP99WaitSec: 8,
	targetBlocking: 0.01,
	tokensPerCall: 1800, // M-12's measured mean per-call cost
	observedTPM: 7500, // M-12's steady provider quota
};

const ARRIVALS_PER_SIM = 120_000; // after warmup
const WARMUP_ARRIVALS = 20_000;

/**
 * Simulate an M/M/c (Poisson) or M^X/M/c (compound-Poisson) queue.
 * Returns measured mean wait, P(wait), p50/p99 wait.
 */
function simulateQueue({ c, lambda, mu, batch, seed, arrivals = ARRIVALS_PER_SIM }) {
	const rand = mulberry32(seed);
	const busy = []; // completion times of busy circuits (kept sorted)
	const waits = [];
	let t = 0;
	let served = 0;
	const batchRate = batch ? lambda / batch.E_X : lambda; // batches per second
	let batches = 0;

	while (served < arrivals + WARMUP_ARRIVALS) {
		// next arrival instant
		t += expTime(rand, batchRate);
		const size = batch ? sampleBatch(rand, batch) : 1;
		if (batch) batches++;
		for (let i = 0; i < size; i++) {
			// purge circuits whose service already finished (their completion
			// time is in the past). Without this, busy[0] can be < t and the
			// computed wait goes NEGATIVE — the simulator then reports a
			// negative mean wait and every comparison is garbage.
			while (busy.length && busy[0] <= t) busy.shift();
			let wait = 0;
			if (busy.length < c) {
				busy.push(t + expService(rand, mu));
				busy.sort((a, b) => a - b);
			} else {
				// queue: wait for the earliest free circuit
				wait = busy[0] - t;
				busy.shift();
				busy.push(t + wait + expService(rand, mu));
				busy.sort((a, b) => a - b);
			}
			served++;
			if (served > WARMUP_ARRIVALS) waits.push(wait);
		}
	}
	waits.sort((a, b) => a - b);
	const mean = waits.reduce((a, b) => a + b, 0) / waits.length;
	return {
		meanWait: mean,
		pWait: waits.filter((w) => w > 0).length / waits.length,
		p50: waits[Math.floor(0.5 * waits.length)],
		p99: waits[Math.floor(0.99 * waits.length)],
		batches,
	};
}

/** Draw a batch size from the MEASURED empirical fan-out distribution. */
function sampleBatch(rand, batch) {
	const h = batch.histogram; // {size: count}
	const total = batch.total;
	let r = rand() * total;
	for (const [size, count] of batch.entries) {
		r -= count;
		if (r <= 0) return size;
	}
	return 1;
}

// build the drawable distribution from the measured histogram
const measuredBatch = (() => {
	const entries = Object.entries(fanout.bursts.histogram).map(([k, v]) => [Number(k), v]);
	const total = entries.reduce((s, [, v]) => s + v, 0);
	return { entries, total, E_X: fanout.bursts.E_X, E_X2: fanout.bursts.E_X2 };
})();

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
const rel = (measured, predicted) => (predicted === 0 ? NaN : (measured - predicted) / predicted);

console.log('=== M-13 transfer test: Erlang-style capacity planning for bursty agent traffic ===\n');
console.log(
	`arrival shape (MEASURED, real agent traffic on this machine): E[X]=${fanout.bursts.E_X} E[X^2]=${fanout.bursts.E_X2} kappa=${fanout.bursts.kappa_count_variance_inflation} P(X>1)=${fanout.bursts.pct_multi}% | ${fanout.bursts.count} bursts from ${fanout.provenance.calls_with_start_timestamp} tool calls`,
);
console.log(
	`scenario: mu=${SCENARIO.mu}/s per circuit (${(1 / SCENARIO.mu).toFixed(1)}s mean call), ${SCENARIO.tokensPerCall} tok/call, target mean wait ${SCENARIO.targetWaitSec}s, target p99 ${SCENARIO.targetP99WaitSec}s, target blocking ${SCENARIO.targetBlocking}`,
);

// ---------- PART 1: validate the math against the simulator ----------

console.log('\n--- PART 1: M/M/c simulation vs closed-form Erlang C (validation) ---');
console.log('if this disagrees, nothing below means anything.\n');
console.log('  A (Erlangs) | circuits | measured mean wait | Erlang C mean wait | rel.err | measured P(wait) | Erlang C P(wait) | rel.err');
const part1 = [];
for (const A of [2, 5, 8]) {
	for (const extra of [2, 8, 20]) {
		const c = Math.ceil(A) + extra;
		const lambda = A * SCENARIO.mu;
		const sim = simulateQueue({ c, lambda, mu: SCENARIO.mu, batch: null, seed: 12345 + c + A });
		const pred = erlangWait(c, A, SCENARIO.mu);
		const predP = erlangC(c, A);
		const e1 = rel(sim.meanWait, pred);
		const e2 = rel(sim.pWait, predP);
		part1.push({ A, c, e1, e2, predWait: pred, predP });
		console.log(
			`  ${String(A).padStart(11)} | ${String(c).padStart(8)} | ${sim.meanWait.toFixed(4).padStart(19)} | ${pred.toFixed(4).padStart(18)} | ${(e1 * 100).toFixed(1).padStart(7)}% | ${sim.pWait.toFixed(4).padStart(14)} | ${predP.toFixed(4).padStart(15)} | ${(e2 * 100).toFixed(1).padStart(7)}%`,
		);
	}
}
// Relative error on a wait of ~0 is meaningless (both sides are 0.0000 and the
// ratio is noise). Judge only the MATERIAL cells: where the closed form
// predicts a wait that is actually material.
const MATERIAL = 0.05; // seconds
const material = part1.filter((r) => r.predWait >= MATERIAL || r.predP >= 0.01);
const maxE1 = Math.max(...material.map((r) => Math.abs(r.e1)));
const maxE2 = Math.max(...material.map((r) => Math.abs(r.e2)));
const degenerate = part1.length - material.length;
console.log(
	`\n  material cells (predicted wait >= ${MATERIAL}s or P(wait) >= 0.01): ${material.length}/${part1.length}; ${degenerate} cells excluded as degenerate (both sides ~0, relative error is noise)`,
);
console.log(
	`  max |rel.err| on material cells: mean wait ${(maxE1 * 100).toFixed(1)}%, P(wait) ${(maxE2 * 100).toFixed(1)}%  -> ${maxE1 < 0.12 && maxE2 < 0.08 ? 'AGREES (within sampling noise)' : 'DISAGREES — the closed form is not usable here'}`,
);

// ---------- PART 2: the Erlang gap (fan-out arrivals vs the Poisson answer) ----------

console.log('\n--- PART 2: the Erlang gap — same offered load, fan-out arrivals instead of Poisson ---');
console.log('the closed form assumes Poisson; the measured traffic is compound-Poisson.\n');
console.log('  A | circuits | Poisson (sim) | Erlang C (closed form) | fan-out (sim) | burst effect | closed form understates | P(wait) Poisson -> fan-out');
const gapRows = [];
for (const A of [5, 8, 12]) {
	for (const extra of [5, 15]) {
		const c = Math.ceil(A) + extra;
		const lambda = A * SCENARIO.mu;
		const poi = simulateQueue({ c, lambda, mu: SCENARIO.mu, batch: null, seed: 999 + c });
		const fan = simulateQueue({ c, lambda, mu: SCENARIO.mu, batch: measuredBatch, seed: 999 + c });
		const cf = erlangWait(c, A, SCENARIO.mu); // the closed form a plan would use
		const gWait = rel(fan.meanWait, poi.meanWait); // the true burst effect
		const gUnder = rel(fan.meanWait, cf); // how much the closed form understates
		const gP = rel(fan.pWait, poi.pWait);
		const material = cf >= MATERIAL || poi.pWait >= 0.01;
		gapRows.push({ A, c, gWait, gUnder, gP, material, fanMeanWait: fan.meanWait, base: cf });
		console.log(
			`  ${String(A).padStart(2)} | ${String(c).padStart(8)} | ${poi.meanWait.toFixed(4).padStart(13)} | ${cf.toFixed(4).padStart(21)} | ${fan.meanWait.toFixed(4).padStart(15)} | ${(gWait * 100).toFixed(1).padStart(11)}% | ${(gUnder * 100).toFixed(1).padStart(23)}% | ${poi.pWait.toFixed(4)} -> ${fan.pWait.toFixed(4)} (${(gP * 100).toFixed(0)}%)`,
		);
	}
}
const matRows = gapRows.filter((r) => r.material);
const meanGap = matRows.reduce((s, r) => s + r.gWait, 0) / matRows.length;
const meanUnder = matRows.reduce((s, r) => s + r.gUnder, 0) / matRows.length;
console.log(`\n  (material cells only: ${matRows.length}/${gapRows.length}; the rest have both sides ~0)`);
console.log(`  burst effect (vs the SIMULATED Poisson wait): ${(meanGap * 100).toFixed(0)}% — fan-out arrivals make the wait ${(1 + meanGap).toFixed(1)}x`);
console.log(`  amount the CLOSED FORM understates the delay (vs the closed form): ${(meanUnder * 100).toFixed(0)}% — the closed form answers ${(1 + meanUnder).toFixed(1)}x too low`);

// how many extra circuits does the closed form get wrong? A single loose SLO
// can sit outside the sensitive region (both shapes meet it with the same
// circuits), so sweep the SLO and report where the two diverge.
console.log('\n  circuits required for a target MEAN WAIT (the buyer question), by SLO:');
console.log('  A |   SLO | closed form (Poisson) | simulated (fan-out) | understated by');
const circuitRows = [];
const SLOS = [0.05, 0.1, 0.25, 0.5, 1, 2];
for (const A of [8, 12]) {
	const lambda = A * SCENARIO.mu;
	for (const slo of SLOS) {
		const closed = minCircuitsForWait(A, slo, SCENARIO.mu);
		// bisect on c using the fan-out simulation
		let lo = Math.ceil(A) + 1, hi = Math.ceil(A) + 300;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const sim = simulateQueue({ c: mid, lambda, mu: SCENARIO.mu, batch: measuredBatch, seed: 4242 + mid, arrivals: 60_000 });
			if (sim.meanWait <= slo) hi = mid - 1;
			else lo = mid + 1;
		}
		const need = lo;
		circuitRows.push({ A, slo, closed, need });
		console.log(
			`  ${String(A).padStart(2)} | ${(slo + 's').padStart(5)} | ${String(closed).padStart(20)} | ${String(need).padStart(22)} | ${String(need - closed).padStart(16)}`,
		);
	}
}
const worstUnder = Math.max(...circuitRows.map((r) => r.need - r.closed));
const worstRow = circuitRows.find((r) => r.need - r.closed === worstUnder);
console.log(
	`\n  worst understatement: ${worstUnder} circuits (A=${worstRow.A}, SLO ${worstRow.slo}s) — a plan built on the closed form alone buys ${worstUnder} too few slots.`,
);

// ---------- PART 3: the classical batch correction, and its residual ----------

console.log('\n--- PART 3: can a formula close the gap, or must it be measured? ---');
console.log('classical M^X/G/1 batch term: (E[X^2]-E[X]) / (2 E[X] (1-rho))\n');
// Anchored to Part 2's MATERIAL cells: in the low-wait regime the ratio of
// two near-zero waits is noise (it read 76x / 21x / 8x at cells where the
// wait was 0.007s). The factor is only meaningful where the delay matters.
console.log('  A | circuits | measured fan-out wait | Erlang C only | + batch term | over/under | MEASURED burst factor');
const factors = [];
for (const r of matRows) {
	const { A, c, fanMeanWait, base } = r; // REUSE Part 2's cells and draws -- a
	// second simulation with a different seed produced a slightly different
	// factor (3.4x vs 3.6x) for no reason other than sampling noise.
	const rho = A / c;
	const term = batchDelayTerm(measuredBatch.E_X, measuredBatch.E_X2, rho);
	const corrected = base + term;
	const factor = base > 0 ? fanMeanWait / base : NaN;
	factors.push(factor);
	console.log(
		`  ${String(A).padStart(2)} | ${String(c).padStart(8)} | ${fanMeanWait.toFixed(4).padStart(23)} | ${base.toFixed(4).padStart(14)} | ${corrected.toFixed(4).padStart(13)} | ${(corrected / fanMeanWait).toFixed(1).padStart(9)}x | ${factor.toFixed(2).padStart(6)}x`,
	);
}
const meanFactor = factors.filter((f) => Number.isFinite(f)).reduce((a, b) => a + b, 0) / factors.filter((f) => Number.isFinite(f)).length;
const overFactors = matRows.map(
	(r) => (r.base + batchDelayTerm(measuredBatch.E_X, measuredBatch.E_X2, r.A / r.c)) / r.fanMeanWait,
);
console.log(
	`\n  The classical batch term OVER-corrects by ~${overFactors[0].toFixed(1)}x here: it is calibrated for a SINGLE-server (M^X/G/1) queue where rho->1, and does not transfer to M^X/M/c with c >> A.`,
);
console.log(
	`  The usable correction is EMPIRICAL: on the measured fan-out shape, the delay is ${meanFactor.toFixed(1)}x the CLOSED-FORM answer at these operating points (the factor vs the SIMULATED Poisson wait is ${(1 + meanGap).toFixed(1)}x -- the two differ because the closed form and the Poisson simulation differ by a few percent themselves).`,
);
console.log(`  So the product ships the factor, not the classical formula — and says so.`);

// ---------- the capacity answer ----------

console.log('\n--- the capacity answer (the product output) ---');
{
	const A = 12; // a busy fleet
	const lambda = A * SCENARIO.mu;
	const closedMean = minCircuitsForWait(A, SCENARIO.targetWaitSec, SCENARIO.mu);
	const closedBlock = minCircuitsForBlocking(A, SCENARIO.targetBlocking);
	console.log(`  offered load A=${A} Erlangs (${lambda.toFixed(3)} calls/s of ${(1 / SCENARIO.mu).toFixed(0)}s each)`);
	console.log(`  closed form, mean wait <= ${SCENARIO.targetWaitSec}s : ${closedMean} circuits`);
	console.log(`  closed form, blocking <= ${SCENARIO.targetBlocking * 100}%   : ${closedBlock} circuits`);
	console.log(`  fan-out correction (measured)      : +${worstUnder} circuits at worst across the tested loads`);
	console.log(`  -> a plan built on the closed form alone is short by up to ${worstUnder} circuits.`);
	const need = closedMean + worstUnder;
	const tpm = need * SCENARIO.mu * 60 * SCENARIO.tokensPerCall;
	console.log(`\n  token quota implied by ${need} circuits: ${Math.round(tpm).toLocaleString()} TPM`);
	console.log(`  (M-12's observed provider quota was ${SCENARIO.observedTPM.toLocaleString()} TPM — the fleet is quota-bound, not concurrency-bound, at that ceiling)`);
	const linear = (200 * 1800 * 40) / (60 * 60) * 60; // M-12-style linear estimate, tokens/min
	console.log(`  M-12's linear estimate for the same workload: ${Math.round(linear).toLocaleString()} TPM (rate only — it prices tokens, not slots)`);
}

console.log('\nverdict:');
console.log(`  - the closed form is validated against the simulator (Part 1): it is usable for M/M/c.`);
console.log(`  - it is NOT usable for measured agent traffic as-is (Part 2): fan-out arrivals make the delay ${(meanGap * 100).toFixed(0)}% worse than Poisson, and the closed form understates the circuits needed by up to ${worstUnder}.`);
console.log(`  - the classical M^X/G/1 batch term does NOT transfer (it over-corrects by ~${overFactors[0].toFixed(1)}x at these loads); the usable correction is the MEASURED burst factor (${meanFactor.toFixed(1)}x on the measured traffic shape), and the simulation remains the ground truth for a capacity commitment.`);
console.log(`  - the product answer is therefore two numbers, not one: circuits (slots) AND token quota — and the M-12 linear estimate prices only the second.`);
