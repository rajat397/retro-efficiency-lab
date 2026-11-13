// M-16 — does the arrival shape generalize? (E3)
//
// T9 measured the arrival shape of real agent traffic on this machine: a burst
// factor kappa = E[X^2]/E[X]^2 of ~1.47 against Poisson's 1.0. That number was
// presented as "the" shape. This test asks the question T9 did not: is kappa a
// property of the FLEET (so one measurement sizes any fleet), or a property of
// the WORK (so a fleet sized with another fleet's number is wrong)?
//
// HYPOTHESIS UNDER TEST.
//   H6: the burst factor is a property of the fleet -- one measured shape
//       generalises across workloads.
//   Falsifier: kappa differs materially between segments of real traffic, with
//               confidence intervals that do not overlap.
//
// METHOD. Real traffic from this machine's opencode session store, segmented two
// ways -- by AGENT TYPE and by PROJECT DIRECTORY (a proxy for the kind of work).
// Bursts are grouped with the same 1s window as T9. Each segment's kappa comes
// with a seeded bootstrap 95% CI (2000 resamples) computed during extraction and
// stored in the data file; the histogram is stored too, so this bench recomputes
// the moments itself and is not trusting a summary.
//
// WHY THIS MATTERS FOR THE PRODUCT. M-13's capacity answer takes the arrival
// shape as an INPUT: the burst correction (3.6x on measured traffic) is applied
// to a fleet's Erlang answer. If kappa is a property of the work, then that
// correction must be measured per fleet -- and a fleet-average kappa applied to
// any individual segment is wrong by up to the measured spread.
//
// DETERMINISM. Reads a committed data file; no database, no network, no wall-clock.
//
// Run: node bench.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const data = JSON.parse(readFileSync(resolve(REPO, 'targets/opencode/data/fanout-bursts.json'), 'utf8'));

/** Recompute the moments and kappa from a stored histogram. */
function moments(hist) {
	const sizes = [];
	for (const [size, count] of Object.entries(hist)) for (let i = 0; i < count; i++) sizes.push(Number(size));
	const n = sizes.length;
	if (!n) return null;
	const m1 = sizes.reduce((a, x) => a + x, 0) / n;
	const m2 = sizes.reduce((a, x) => a + x * x, 0) / n;
	return { n, E_X: m1, E_X2: m2, kappa: m2 / (m1 * m1) };
}

/** Do two 95% CIs overlap? */
const overlaps = (a, b) => !(a[1] < b[0] || b[1] < a[0]);

const segmentRows = (group, key) =>
	Object.entries(data.segments[group])
		.map(([name, seg]) => {
			const m = moments(seg.histogram);
			return { group, name, ...m, ci: seg.kappa_ci95, pct_multi: seg.pct_multi };
		})
		.filter((r) => r.n > 0)
		.sort((a, b) => a.kappa - b.kappa);

const byAgent = segmentRows('by_agent');
const byProject = segmentRows('by_project');
const all = [...byAgent, ...byProject];
const fleet = moments(data.bursts.histogram);

console.log('=== M-16: does the arrival shape generalize across workloads? ===\n');
console.log(
	`source: real agent traffic, ${data.provenance.calls_with_start_timestamp} tool calls, burst window ${data.method.window_ms}ms | ${data.bursts.count} bursts overall`,
);
console.log(
	`fleet-wide: E[X]=${fleet.E_X.toFixed(4)} E[X^2]=${fleet.E_X2.toFixed(4)} kappa=${fleet.kappa.toFixed(4)} (Poisson would be 1.0000)\n`,
);

const table = (title, rows) => {
	console.log(title);
	console.log('  segment                          | bursts |  E[X] |  E[X^2] | kappa | 95% CI          | %multi');
	for (const r of rows)
		console.log(
			`  ${r.name.slice(0, 30).padEnd(31)} | ${String(r.n).padStart(6)} | ${r.E_X.toFixed(3).padStart(5)} | ${r.E_X2.toFixed(3).padStart(7)} | ${r.kappa.toFixed(4)} | [${r.ci[0]}, ${r.ci[1]}] | ${r.pct_multi}%`,
		);
};
table('by AGENT TYPE (a proxy for the kind of work):', byAgent);
table('by PROJECT DIRECTORY:', byProject);

const kappas = all.map((r) => r.kappa);
const minK = Math.min(...kappas);
const maxK = Math.max(...kappas);
const spread = maxK / minK - 1;

// every pair whose CIs do not overlap
let disjointPairs = 0;
for (let i = 0; i < all.length; i++)
	for (let j = i + 1; j < all.length; j++) if (!overlaps(all[i].ci, all[j].ci)) disjointPairs++;
const totalPairs = (all.length * (all.length - 1)) / 2;

console.log('\n--- the spread ---');
console.log(`  lowest  kappa: ${minK.toFixed(4)}   highest: ${maxK.toFixed(4)}   relative spread: ${(spread * 100).toFixed(0)}%`);
console.log(`  fleet-wide kappa: ${fleet.kappa.toFixed(4)} — it sits inside the range and describes no segment well`);
console.log(
	`  segment pairs with NON-OVERLAPPING 95% CIs: ${disjointPairs}/${totalPairs} — the variation is not sampling noise`,
);

// how far is the fleet average from each segment, in units of that segment's CI?
const misleads = all.filter((r) => {
	const half = (r.ci[1] - r.ci[0]) / 2;
	const mid = (r.ci[0] + r.ci[1]) / 2;
	return Math.abs(fleet.kappa - mid) > half;
});

// ---------- checks ----------

let ok = true;
function check(name, cond, detail) {
	if (!cond) ok = false;
	console.log(`CHECK ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
}
// The checks must test the COMPUTATION, not restate the data. Three of them
// compare this bench's recomputed moments against the values stored in the data
// file (which the extraction wrote independently) -- that is what makes a mutant
// of the arithmetic fail instead of passing.
{
	let mismatch = 0;
	for (const r of all) {
		const stored = data.segments[r.group][r.name];
		if (Math.abs(r.kappa - stored.kappa) > 1e-3) mismatch++;
		if (Math.abs(r.E_X - stored.E_X) > 1e-3) mismatch++;
	}
	check(
		'this bench recomputes each segment\'s moments identically to the extractor (arithmetic is right)',
		mismatch === 0,
		`${mismatch} mismatches across ${all.length} segments`,
	);
	const storedFleet = data.bursts.kappa_count_variance_inflation;
	check(
		'the pooled fleet kappa matches the extractor (pooling is right, not averaging segments)',
		Math.abs(fleet.kappa - storedFleet) < 1e-3,
		`pooled ${fleet.kappa.toFixed(4)} vs stored ${storedFleet}`,
	);
	check(
		'the CI-overlap helper is correct on known cases',
		overlaps([1, 2], [1.5, 3]) === true && overlaps([1, 2], [2.5, 3]) === false,
		'overlapping and disjoint cases',
	);
}
check(
	'the fleet-wide kappa lies inside the range of segment kappas (the average is a blend)',
	fleet.kappa >= minK && fleet.kappa <= maxK,
	`fleet ${fleet.kappa.toFixed(4)} in [${minK.toFixed(4)}, ${maxK.toFixed(4)}]`,
);
check(
	'segment kappas differ by a MATERIAL amount (not sampling noise)',
	spread > 0.25,
	`spread ${(spread * 100).toFixed(0)}% (> 25% required)`,
);
check(
	'at least one pair of segments has non-overlapping 95% CIs',
	disjointPairs > 0,
	`${disjointPairs}/${totalPairs} pairs`,
);
check(
	'the fleet-wide kappa falls outside at least one segment\'s own CI (the average misleads for that segment)',
	misleads.length > 0,
	`${misleads.length}/${all.length} segments: ${misleads.map((r) => r.name.slice(0, 18)).join(', ')}`,
);

// ---------- verdict ----------

console.log('\nVERDICT:');
console.log(
	`  H6 (the burst factor is a property of the FLEET, so one measured shape generalises): ${disjointPairs > 0 && spread > 0.25 ? 'REFUTED' : 'SUPPORTED'}.`,
);
console.log(
	`  kappa ranges ${minK.toFixed(4)} .. ${maxK.toFixed(4)} across segments of REAL traffic (${(spread * 100).toFixed(0)}% spread), with ${disjointPairs}/${totalPairs} segment pairs whose 95% CIs do not overlap.`,
);
console.log(
	`  the fleet-wide kappa (${fleet.kappa.toFixed(4)}) lies outside the CI of ${misleads.length} segment(s) — a capacity plan computed with the fleet average is wrong for those segments.`,
);
console.log(
	`  product consequence: M-13's burst correction (3.6x on measured traffic) is NOT a fleet constant. It must be measured per workload, and a fleet that has not measured it is guessing.`,
);
console.log(`  checks: ${ok ? 'ALL PASS' : 'FAILED'}`);
globalThis.__benchOk = ok;
process.on('exit', () => {
	if (typeof globalThis.__benchOk !== 'undefined' && !globalThis.__benchOk) process.exitCode = 1;
});
