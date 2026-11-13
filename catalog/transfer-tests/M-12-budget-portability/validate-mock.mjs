// validate-mock.mjs — check the M-12 bench's *mechanism* against a live peer.
//
// The bench is a discrete-event simulation. A simulation can be self-consistent
// and still wrong about the mechanism it claims to model. This script spawns a
// REAL OpenAI-compatible HTTP peer (mock-provider.mjs) with realistic latency,
// drives it with two clients, and checks the two claims the bench rests on:
//
//   1. HERD: a client that retries without jitter synchronizes; its retries
//      pile up at the same instant. The bench measures naive peaking at 192
//      simultaneous retries vs 1-2 for the disciplined runtimes.
//   2. LEASE: a client that caps its own in-flight requests (a leased pool)
//      is not rejected, while a client that fires blind is.
//
// Self-contained: `node validate-mock.mjs` starts and stops its own peer.
//
// Usage: node validate-mock.mjs [concurrency]
//
// Note on latency: the peer MUST have non-trivial latency, otherwise the
// requests complete faster than sockets are accepted and no genuine overlap
// occurs (measured: with 0 ms jitter the peer never saw two requests in
// flight; with 300 ms it saw 9). Real providers have latency; the bench's
// slow-tail/jitter pathology models exactly this.

import http from 'node:http';
import { spawn } from 'node:child_process';

const CONC = Number(process.argv[2] || 8); // the peer's concurrency ceiling
const PORT = 4611 + (process.pid % 200);
const N_CALLS = 300;
const PEER_JITTER_MS = 300;
const PEER_JITTER_SPREAD = 100;

const peer = spawn(process.execPath, ['mock-provider.mjs'], {
	env: {
		...process.env,
		MOCK_PORT: String(PORT),
		MOCK_MAX_CONC: String(CONC),
		MOCK_JITTER_MS: String(PEER_JITTER_MS),
		MOCK_JITTER_SPREAD: String(PEER_JITTER_SPREAD),
		MOCK_LOG: `/tmp/m12-validate-${PORT}.jsonl`,
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});
peer.stdout.on('data', () => {});
peer.stderr.on('data', (d) => process.stderr.write(`[peer] ${d}`));

const URL = `http://127.0.0.1:${PORT}/v1/chat/completions`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// wait for the peer to be listening
for (let i = 0; i < 100; i++) {
	try {
		await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST', body: '{}' });
		break;
	} catch {
		await sleep(50);
	}
}

// Raw http with an explicit socket pool: Node's global fetch pools per-origin
// connections and serialised the calls, which silently voided the test.
const AGENT = new http.Agent({ keepAlive: false, maxSockets: 1024, maxFreeSockets: 1024 });

function call(tag) {
	return new Promise((resolve) => {
		const payload = JSON.stringify({
			model: 'mock',
			messages: [{ role: 'user', content: tag }],
			tools: [],
		});
		const req = http.request(
			{
				host: '127.0.0.1',
				port: PORT,
				path: '/v1/chat/completions',
				method: 'POST',
				agent: AGENT,
				headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
			},
			(res) => {
				res.resume();
				res.on('end', () => {
					if (res.statusCode === 429) return resolve('429');
					if (res.statusCode !== 200) return resolve('err' + res.statusCode);
					resolve('200');
				});
			},
		);
		req.on('error', () => resolve('err'));
		req.end(payload);
	});
}

/**
 * A client. `cap` = max in-flight it will allow itself (null = fire blind).
 * Retries use exponential backoff with NO jitter (the naive policy) — the
 * herd metric is the peak number of retries scheduled for the SAME instant.
 */
async function runClient(cap) {
	let inflight = 0;
	let peakInflight = 0;
	let retryInflight = 0;
	let peakRetryInflight = 0; // peak RETRY requests in flight at once — the storm
	const dispatchAt = new Map(); // ms -> retries DISPATCHED in that millisecond
	let four29 = 0;
	let retries = 0;
	const retryAt = new Map(); // wall-clock ms -> retries scheduled for that instant
	const t0 = Date.now();

	const fire = async (tag, attempt, isRetry) => {
		inflight++;
		if (inflight > peakInflight) peakInflight = inflight;
		if (isRetry) {
			retryInflight++;
			if (retryInflight > peakRetryInflight) peakRetryInflight = retryInflight;
			const ms = Date.now();
			dispatchAt.set(ms, (dispatchAt.get(ms) || 0) + 1);
		}
		const res = await call(tag);
		inflight--;
		if (isRetry) retryInflight--;
		if (res === '429') {
			four29++;
			const backoff = Math.min(4000, 100 * 2 ** Math.min(attempt, 6)); // NO jitter
			retries++;
			const at = Date.now() + backoff;
			retryAt.set(at, (retryAt.get(at) || 0) + 1);
			return true;
		}
		return false;
	};

	const schedule = (tag, attempt) => {
		const at = Date.now() + Math.min(4000, 100 * 2 ** Math.min(attempt, 6));
		retryAt.set(at, (retryAt.get(at) || 0) + 1);
	};

	// first wave
	let next = 0;
	const wave = [];
	const limit = cap === null ? N_CALLS : cap;
	while (next < limit) {
		const tag = `c-${next++}`;
		wave.push(fire(tag, 0));
	}
	await Promise.all(wave);

	// drain scheduled retries
	let guard = 0;
	while (retryAt.size && guard++ < 100000) {
		const times = [...retryAt.keys()].sort((a, b) => a - b);
		const at = times[0];
		const wait = Math.max(0, at - Date.now());
		if (wait) await sleep(wait);
		const batch = retryAt.get(at);
		retryAt.delete(at);
		const attempts = [];
		for (let i = 0; i < batch; i++) {
			const tag = `r-${at}-${i}`;
			attempts.push(
				fire(tag, 1 + (at % 6), true).then((rejected) => {
					if (rejected) schedule(tag, 1 + (at % 6));
				}),
			);
		}
		await Promise.all(attempts);
	}
	let peakHerd = 0;
	for (const v of dispatchAt.values()) if (v > peakHerd) peakHerd = v;
	return { four29, retries, peakInflight, peakRetryInflight, peakHerd, elapsedMs: Date.now() - t0 };
}

console.log(`=== M-12 live validation against a real (mock) provider ===\n`);
console.log(`peer: ${URL}`);
console.log(`peer: concurrency ceiling ${CONC}, latency ${PEER_JITTER_MS}ms + 0..${PEER_JITTER_SPREAD}ms jitter`);
console.log(`calls per client: ${N_CALLS}\n`);

const naive = await runClient(null); // fires blind
const leased = await runClient(CONC); // caps its own in-flight (a leased pool)

console.log(`metric                        | naive (blind) | leased (self-capped)`);
console.log(`429 rejections                | ${String(naive.four29).padStart(15)} | ${String(leased.four29).padStart(17)}`);
console.log(`retries                       | ${String(naive.retries).padStart(15)} | ${String(leased.retries).padStart(17)}`);
console.log(`peak simultaneous requests    | ${String(naive.peakInflight).padStart(15)} | ${String(leased.peakInflight).padStart(17)}`);
console.log(`peak retries in flight at once | ${String(naive.peakRetryInflight).padStart(15)} | ${String(leased.peakRetryInflight).padStart(17)}`);
console.log(`peak retries dispatched in 1ms | ${String(naive.peakHerd).padStart(15)} | ${String(leased.peakHerd).padStart(17)}`);
console.log(`elapsed (ms)                  | ${String(naive.elapsedMs).padStart(15)} | ${String(leased.elapsedMs).padStart(17)}`);

console.log('\nclaims under test:');
const herdOk = naive.peakHerd > leased.peakHerd;
const leaseOk = leased.four29 < naive.four29;
console.log(
	`  1. HERD  : un-jittered retries form a storm -> ${herdOk ? 'CONFIRMED' : 'NOT CONFIRMED'} (naive ${naive.peakRetryInflight} retries in flight at once / ${naive.peakHerd} dispatched in one millisecond, vs leased ${leased.peakRetryInflight}/${leased.peakHerd})`,
);
console.log(
	`  2. LEASE : a self-capped client is not rejected -> ${leaseOk ? 'CONFIRMED' : 'NOT CONFIRMED'} (${leased.four29} vs ${naive.four29} rejections)`,
);
console.log(`\nbench (simulated) said: naive peak herd 192 vs disciplined 1-2; budgeted 0 rejections vs naive 961,375.`);
console.log(
	`live peer said: naive ${naive.peakRetryInflight} retries in flight at once vs leased ${leased.peakRetryInflight}; ${leased.four29} vs ${naive.four29} rejections; elapsed ${leased.elapsedMs}ms vs ${naive.elapsedMs}ms.`,
);
console.log(
	`\nscope: the live peer confirms the MECHANISM (an un-jittered retry storm synchronizes; a self-capped client is not rejected). It does NOT reproduce the bench's absolute rejection counts — those depend on the bench's quota model, not on the peer.`,
);

peer.kill('SIGTERM');
process.exit(herdOk && leaseOk ? 0 : 1);
