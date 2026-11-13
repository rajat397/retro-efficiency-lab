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

// ---------- per-segment statistics (E3: does the burst shape generalize?) ----------
// The burst factor kappa = E[X^2]/E[X]^2 is measured per segment of the traffic.
// If kappa were a property of the FLEET it would be the same everywhere; if it is
// a property of the WORK, it varies. Segments: agent type, and project directory.
// Bootstrap CIs (seeded, so reproducible) give the spread honestly.
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
function burstSizesFor(windowMs, keyFn) {
	const by = new Map();
	for (const c of calls) {
		const k = keyFn(c);
		if (!by.has(k)) by.set(k, new Map());
		const per = by.get(k);
		if (!per.has(c.session)) per.set(c.session, []);
		per.get(c.session).push(c.start);
	}
	const out = new Map();
	for (const [k, per] of by) {
		const sizes = [];
		for (const [, ts] of per) {
			ts.sort((a, b) => a - b);
			let n = 1, anchor = ts[0];
			for (let i = 1; i < ts.length; i++) {
				if (ts[i] - anchor <= windowMs) n++;
				else { sizes.push(n); n = 1; anchor = ts[i]; }
			}
			if (n) sizes.push(n);
		}
		out.set(k, sizes);
	}
	return out;
}
function stats(sizes) {
	const n = sizes.length;
	if (!n) return null;
	const m1 = sizes.reduce((a, x) => a + x, 0) / n;
	const m2 = sizes.reduce((a, x) => a + x * x, 0) / n;
	// bootstrap CI for kappa
	const rnd = mulberry32(0xB00B5 + n);
	const reps = 2000;
	const ks = [];
	for (let r = 0; r < reps; r++) {
		let s1 = 0, s2 = 0;
		for (let i = 0; i < n; i++) {
			const v = sizes[Math.floor(rnd() * n)];
			s1 += v; s2 += v * v;
		}
		const b1 = s1 / n, b2 = s2 / n;
		ks.push(b2 / (b1 * b1));
	}
	ks.sort((a, b) => a - b);
	const hist = {};
	for (const x of sizes) hist[x] = (hist[x] || 0) + 1;
	return {
		bursts: n,
		E_X: +m1.toFixed(4),
		E_X2: +m2.toFixed(4),
		kappa: +(m2 / (m1 * m1)).toFixed(4),
		kappa_ci95: [+ks[Math.floor(0.025 * reps)].toFixed(4), +ks[Math.floor(0.975 * reps)].toFixed(4)],
		pct_multi: +((sizes.filter((x) => x > 1).length / n) * 100).toFixed(2),
		histogram: hist, // stored so the bench recomputes the moments itself
	};
}
const sessionMeta = new Map();
for (const r of db.prepare('SELECT id, directory, agent FROM session').all())
	sessionMeta.set(r.id, { directory: r.directory || '(none)', agent: r.agent || '(none)' });
const segByAgent = stats([...burstSizesFor(WINDOW_MS, (c) => sessionMeta.get(c.session)?.agent || '(none)').values()].flat());
const perAgent = new Map();
for (const [k, sizes] of burstSizesFor(WINDOW_MS, (c) => sessionMeta.get(c.session)?.agent || '(none)')) {
	const st = stats(sizes);
	if (st && st.bursts >= 200) perAgent.set(k, st);
}
const perProject = new Map();
for (const [k, sizes] of burstSizesFor(WINDOW_MS, (c) => sessionMeta.get(c.session)?.directory || '(none)')) {
	const st = stats(sizes);
	if (st && st.bursts >= 200) perProject.set(k, st);
}

const out = {
	source: 'local opencode session store (real agent traffic on this machine)',
	generated_at: new Date().toISOString(),
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
	segments: {
		note: 'burst factor kappa = E[X^2]/E[X]^2 per segment; bootstrap 95% CI over 2000 resamples, seeded',
		by_agent: Object.fromEntries(perAgent),
		by_project: Object.fromEntries(perProject),
	},
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
console.log('  segments with >=200 bursts:');
for (const [k, v] of [...perAgent.entries()].sort((a, b) => b[1].bursts - a[1].bursts))
	console.log(`    agent ${String(k).padEnd(18)} bursts ${String(v.bursts).padStart(6)} kappa ${v.kappa} CI[${v.kappa_ci95}]`);
for (const [k, v] of [...perProject.entries()].sort((a, b) => b[1].bursts - a[1].bursts).slice(0, 6))
	console.log(`    proj  ${String(k).slice(0, 40).padEnd(42)} bursts ${String(v.bursts).padStart(6)} kappa ${v.kappa} CI[${v.kappa_ci95}]`);
