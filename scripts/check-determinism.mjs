// check-determinism.mjs — the determinism audit (E6).
//
// The repo's rule is "determinism claims name their matrix". This script builds
// the matrix, and it does so in two halves:
//
//   MEASURED   run every bench twice on this platform and compare the VERDICT
//              counters. A bench whose counters move between identical runs is
//              not deterministic, whatever its source says.
//
//   STATIC     scan every bench for the constructs that make a run
//              platform-dependent: wall-clock reads, unseeded randomness,
//              absolute paths, locale-dependent formatting, environment reads.
//              These are the things that can differ on macOS or Windows even
//              when the counters agree.
//
// Neither half can tell you about a platform you have not run on. That is what
// the CI matrix (.github/workflows/determinism.yml) is for; this script is the
// instrument that produces the per-platform VERDICT lines it compares.
//
// Usage: node scripts/check-determinism.mjs [--runs 2] [--json <out.json>]

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
	const i = argv.indexOf(k);
	return i >= 0 ? argv[i + 1] : d;
};
const RUNS = Number(arg('--runs', 2));
const JSON_OUT = arg('--json', null);

// ---------- the static audit ----------

const PATTERNS = [
	{ id: 'wall-clock', re: /Date\.now\(\)|new Date\(\s*\)|performance\.now\(\)|process\.hrtime/g, why: 'wall-clock read — the value differs on every machine and every run' },
	{ id: 'unseeded-random', re: /Math\.random\(/g, why: 'unseeded randomness — not replayable' },
	{ id: 'absolute-path', re: /['"`]\/(home|mnt|tmp|usr|opt)\//g, why: 'absolute path — differs per machine and per OS separator' },
	{ id: 'locale', re: /toLocaleString|localeCompare|Intl\.|toLocaleDate/g, why: 'locale-dependent formatting — differs by machine locale' },
	{ id: 'env-read', re: /process\.env\./g, why: 'environment read — the value differs per machine' },
	{ id: 'cwd', re: /process\.cwd\(\)/g, why: 'working-directory read — differs by checkout location' },
	{ id: 'float-format', re: /toFixed\(\d+\)/g, why: 'rounding — safe, but listed so the matrix is explicit about it' },
];

const BENCH_DIR = join(REPO, 'catalog', 'transfer-tests');
const benches = readdirSync(BENCH_DIR)
	.filter((d) => statSync(join(BENCH_DIR, d)).isDirectory())
	.filter((d) => {
		try {
			statSync(join(BENCH_DIR, d, 'bench.mjs'));
			return true;
		} catch {
			return false;
		}
	})
	.sort();

console.log(`=== determinism audit: ${benches.length} benches, ${RUNS} run(s) each ===\n`);

// ---------- the measured half ----------

function extractVerdict(stdout) {
	const line = stdout.split('\n').find((l) => l.startsWith('VERDICT:'));
	return line ? line.trim() : null;
}
function extractChecks(stdout) {
	return stdout.split('\n').filter((l) => l.startsWith('CHECK ')).map((l) => l.trim());
}

const rows = [];
for (const b of benches) {
	const dir = join(BENCH_DIR, b);
	const src = readFileSync(join(dir, 'bench.mjs'), 'utf8');

	// static audit
	const findings = [];
	for (const p of PATTERNS) {
		const m = src.match(p.re);
		if (m && m.length) findings.push({ id: p.id, count: m.length, why: p.why });
	}

	// measured: run it RUNS times, compare the VERDICT counters
	const verdicts = [];
	const checks = [];
	let exitCodes = [];
	for (let i = 0; i < RUNS; i++) {
		let out = '';
		let rc = 0;
		try {
			out = execFileSync('node', ['bench.mjs'], { cwd: dir, encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (e) {
			out = (e.stdout || '') + (e.stderr || '');
			rc = e.status ?? 1;
		}
		verdicts.push(extractVerdict(out));
		checks.push(extractChecks(out).join('\n'));
		exitCodes.push(rc);
	}
	// A bench that prints no VERDICT line cannot be compared at all. That is a
	// DIFFERENT finding from "differs between runs" and must not be reported as
	// the same thing -- twelve benches were silently counted as non-deterministic
	// when they simply have no comparable output.
	const hasVerdict = verdicts[0] !== null;
	const identical = hasVerdict && verdicts.every((v) => v === verdicts[0]) && new Set(checks).size === 1;

	rows.push({
		bench: b,
		exit: exitCodes,
		hasVerdict,
		identical,
		verdict: verdicts[0],
		static: findings,
	});
	const status = !hasVerdict ? 'NO-VERDICT' : identical ? 'IDENTICAL ' : 'DIFFERS   ';
	console.log(`  ${status}  ${b.padEnd(36)} exit=${exitCodes.join(',')}`);
}

// ---------- report ----------

const comparable = rows.filter((r) => r.hasVerdict);
const incomparable = rows.filter((r) => !r.hasVerdict);
console.log(
	`\n  comparable (print a VERDICT line): ${comparable.length}/${rows.length}` +
		` — ${comparable.filter((r) => r.identical).length}/${comparable.length} identical across ${RUNS} run(s) on this platform`,
);
console.log(
	`  NOT comparable (no VERDICT line): ${incomparable.length}/${rows.length} — ${incomparable.map((r) => r.bench).join(', ')}`,
);

const flagged = rows.filter((r) => r.static.length);
console.log(`\n--- static audit: platform-sensitive constructs ---`);
for (const r of flagged) {
	console.log(`  ${r.bench}`);
	for (const f of r.static) console.log(`     ${f.id.padEnd(17)} x${String(f.count).padStart(3)}  ${f.why}`);
}
console.log(
	`\n  ${flagged.length}/${rows.length} benches contain at least one platform-sensitive construct. ` +
		`These are the ones a three-platform matrix can move; the others are counters-only and should not.`,
);

const out = {
	generated_at: new Date().toISOString(),
	platform: `${process.platform} ${process.arch}`,
	node: process.version,
	runs_each: RUNS,
	rows: rows.map((r) => ({
		bench: r.bench,
		exit: r.exit,
		has_verdict_line: r.hasVerdict,
		identical_across_runs: r.identical,
		verdict: r.verdict,
		static_findings: r.static,
	})),
};
if (JSON_OUT) {
	writeFileSync(resolve(REPO, JSON_OUT), JSON.stringify(out, null, 1) + '\n');
	console.log(`\nwrote ${JSON_OUT}`);
}
console.log(
	`\nNOTE: identical across runs on ONE platform is necessary, not sufficient. The three-platform` +
		`\n      matrix lives in .github/workflows/determinism.yml; until it has run on macOS and Windows,` +
		`\n      cross-platform reproducibility is UNTESTED and must be labeled that way.`,
);
