// erlang.mjs — Erlang's queueing math, ported to agent-fleet capacity planning.
//
// Classical, closed-form, and exactly what a capacity plan needs:
//   Erlang B  — loss system: probability an arrival is BLOCKED (no queue).
//   Erlang C  — delay system: probability an arrival must WAIT.
// Both take the OFFERED TRAFFIC A (in Erlangs) = λ/μ, where λ is the arrival
// rate and μ the service rate of ONE circuit.
//
// Mapping to an agent fleet:
//   circuit  = one concurrent provider-call slot
//   μ        = 1 / mean provider-call service time
//   λ        = provider-call arrival rate
//   A        = offered load
//   n        = the provider's concurrency ceiling (or the fleet's own)
//
// No dependencies, no special functions: the recursion below is the stable
// form (no factorials, no overflow), and it is the same form used in the
// original 1909/1929 papers.
//
// SCOPE HONESTY: these formulas are for POISSON arrivals and EXPONENTIAL
// service times (M/M/c). Real agent traffic is neither — arrivals are
// fan-out bursts (compound-Poisson) and service times are heavy-tailed. The
// M-13 transfer test measures what that costs; the helpers at the bottom
// provide the batch-moment corrections so the correction can be VALIDATED
// against the simulation rather than asserted.

/** Erlang B: P(block) for n circuits and offered traffic A. */
export function erlangB(n, a) {
	if (n <= 0) return 1;
	if (a <= 0) return 0;
	let b = 1; // B(0, A)
	for (let i = 1; i <= n; i++) {
		b = (a * b) / (i + a * b); // stable recursion, no factorials
	}
	return b;
}

/** Erlang C: P(wait) for n circuits and offered traffic A. Requires A < n. */
export function erlangC(n, a) {
	if (n <= 0) return 1;
	if (a >= n) return 1; // unstable: the queue grows without bound
	const b = erlangB(n, a);
	return b / (1 - (a / n) * (1 - b));
}

/** Mean queueing delay (seconds) in an M/M/c system. μ = service rate per circuit. */
export function erlangWait(n, a, mu) {
	if (a >= n) return Infinity;
	const lambda = a * mu;
	return erlangC(n, a) / (n * mu - lambda);
}

/** Offered traffic in Erlangs from an arrival rate and a per-circuit service rate. */
export function offeredLoad(lambda, mu) {
	return lambda / mu;
}

/** Smallest n with P(block) <= beta. The classic "how many circuits?" answer. */
export function minCircuitsForBlocking(a, beta) {
	let n = Math.max(1, Math.ceil(a));
	while (n < 1_000_000 && erlangB(n, a) > beta) n++;
	return n;
}

/** Smallest n with mean queueing delay <= targetWait (seconds). */
export function minCircuitsForWait(a, targetWait, mu) {
	let n = Math.max(1, Math.ceil(a) + 1);
	while (n < 1_000_000 && erlangWait(n, a, mu) > targetWait) n++;
	return n;
}

/**
 * Count-variance inflation factor of a compound-Poisson arrival process with
 * batch moments E[X], E[X^2]: kappa = E[X^2]/E[X]^2. Poisson arrivals have
 * kappa = 1; every burst inflates it. This is the quantitative size of the
 * assumption that Erlang's formulas make about agent traffic.
 */
export function batchKappa(ex1, ex2) {
	return ex2 / (ex1 * ex1);
}

/**
 * The batch term of the compound-Poisson (M^X/G/1) Pollaczek-Khinchine
 * generalization: (E[X^2] - E[X]) / (2 E[X] (1 - rho)). It vanishes for
 * Poisson arrivals (E[X^2] = E[X] = 1) and is the classical additive
 * correction for batch arrival processes.
 *
 * The M-13 transfer test checks this against a simulation. If the residual is
 * large, the correction is reported as inadequate rather than quietly used.
 */
export function batchDelayTerm(ex1, ex2, rho) {
	if (rho >= 1) return Infinity;
	return (ex2 - ex1) / (2 * ex1 * (1 - rho));
}

/** Deterministic PRNG (mulberry32) — the bench must be replayable. */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Exponential inter-arrival time for rate λ. */
export function expTime(rand, lambda) {
	return -Math.log(1 - rand()) / lambda;
}

/** Exponential service time for rate μ. */
export function expService(rand, mu) {
	return -Math.log(1 - rand()) / mu;
}
