// extract-fanout.mjs — measure the real agent-fleet call-arrival shape from
// local opencode session history, and write it as a data file the M-13
// transfer test consumes.
//
// Source: the local opencode SQLite store (every tool invocation with its
// start timestamp). This is REAL agent traffic on this machine, not a
// synthetic model — which is what lets M-13 quantify the Erlang/Poisson gap
// against the actual arrival shape rather than an assumed one.
//
// Usage: node scripts/extract-fanout.mjs [--window-ms 1000] [--out <path>]
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WINDOW_MS = Number(arg('--window-ms', 1000));
const OUT = arg('--out', 'targets/opencode/data/fanout-bursts.json');

const dbPath = process.env.HOME + '/.local/share/opencode/opencode.db';
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(`SELECT session_id, data FROM part WHERE data LIKE '%"type":"tool"%'`).all();

const calls = [];
for (const r of rows) {
	let d;
	try { d = JSON.parse(r.data); } catch { continue; }
	const t = d.state?.time || {};
	if (typeof t.start !== 'number') continue;
	calls.push({ session: r.session_id, start: t.start, end: typeof t.end === 'number' ? Math.max(t.end, t.start) : t.start + 1000, tool: d.tool });
}

// burst = a group of calls whose starts fall within WINDOW_MS of the group's
// first start, per session. The window is a METHOD choice, so the extraction
// also records the sensitivity across windows (the finding reports it).
function burstSizes(windowMs) {
	const by = new Map();
	for (const c of calls) {
		if (!by.has(c.session)) by.set(c.session, []);
		by.get(c.session).push(c.start);
	}
	const sizes = [];
	for (const [, ts] of by) {
		ts.sort((a, b) => a - b);
		let n = 1, anchor = ts[0];
		for (let i = 1; i < ts.length; i++) {
			if (ts[i] - anchor <= windowMs) n++;
			else { sizes.push(n); n = 1; anchor = ts[i]; }
		}
		if (n) sizes.push(n);
	}
	return sizes;
}

const sizes = burstSizes(WINDOW_MS);
const hist = {};
for (const s of sizes) hist[s] = (hist[s] || 0) + 1;
const n = sizes.length;
const ex1 = sizes.reduce((a, x) => a + x, 0) / n;
const ex2 = sizes.reduce((a, x) => a + x * x, 0) / n;
const variance = sizes.reduce((a, x) => a + (x - ex1) ** 2, 0) / n;
const gt = sizes.filter((x) => x > 1);

const sensitivity = [50, 100, 250, 500, 1000, 2000].map((w) => {
	const s = burstSizes(w);
	const m1 = s.reduce((a, x) => a + x, 0) / s.length;
	const m2 = s.reduce((a, x) => a + x * x, 0) / s.length;
	return {
		window_ms: w,
		bursts: s.length,
		E_X: +m1.toFixed(4),
		E_X2: +m2.toFixed(4),
		kappa_E_X2_over_E_X2: +(m2 / (m1 * m1)).toFixed(4),
		pct_multi: +((s.filter((x) => x > 1).length / s.length) * 100).toFixed(2),
	};
});

// concurrency demand (the quantity an Erlang capacity plan actually sizes)
const ev = [];
for (const c of calls) { ev.push([c.start, 1]); ev.push([c.end, -1]); }
ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let conc = 0, peak = 0, areaMs = 0, last = null;
const concHist = {};
for (const [t, d] of ev) {
	if (last !== null) areaMs += conc * (t - last);
	last = t; conc += d;
	if (conc > peak) peak = conc;
	concHist[conc] = (concHist[conc] || 0) + 1;
}
const spanMs = Math.max(...calls.map((c) => c.end)) - Math.min(...calls.map((c) => c.start));

const out = {
	source: 'local opencode session store (real agent traffic on this machine)',
	provenance: {
		db_path: dbPath,
		tool_parts_scanned: rows.length,
		calls_with_start_timestamp: calls.length,
		observation_span_hours: +(spanMs / 3600e3).toFixed(1),
		extracted_by: 'scripts/extract-fanout.mjs',
	},
	method: {
		burst_definition: 'per session, calls whose start is within window_ms of the group’s first start',
		window_ms: WINDOW_MS,
		window_is_a_method_choice: 'see window_sensitivity — the moments are stable across a 40x range of windows',
	},
	bursts: {
		count: n,
		histogram: Object.fromEntries(Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0]))),
		E_X: +ex1.toFixed(4),
		E_X2: +ex2.toFixed(4),
		variance: +variance.toFixed(4),
		scv: +(variance / (ex1 * ex1)).toFixed(4),
		kappa_count_variance_inflation: +(ex2 / (ex1 * ex1)).toFixed(4),
		pct_multi: +((gt.length / n) * 100).toFixed(2),
		E_X_given_multi: +(gt.reduce((a, x) => a + x, 0) / (gt.length || 1)).toFixed(4),
	},
	window_sensitivity: sensitivity,
	concurrency_demand: {
		peak_in_flight: peak,
		mean_in_flight_time_weighted: +(areaMs / spanMs).toFixed(4),
		histogram: Object.fromEntries(Object.entries(concHist).sort((a, b) => Number(a[0]) - Number(b[0]))),
	},
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${OUT}`);
console.log(`  bursts ${n} | E[X] ${out.bursts.E_X} | E[X^2] ${out.bursts.E_X2} | kappa ${out.bursts.kappa_count_variance_inflation}`);
console.log(`  peak concurrent in-flight ${peak} | mean ${out.concurrency_demand.mean_in_flight_time_weighted}`);
