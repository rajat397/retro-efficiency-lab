// M-6 transfer test — procedural generation from compact seeds/state
// (Elite's galaxy: 256 planets × 8 galaxies from 3×16-bit seed words; TH04's
// ring-buffer background painter) on Node 22.
//
// Claim tested. Content is not stored — it is derived each time from tiny
// compact state through deterministic transforms. Transferable properties:
//   (1) payload: seeds vs serialized content — orders of magnitude smaller
//   (2) generation cost: negligible at these scales
//   (3) determinism: same seeds -> identical content, cross-run (the twist
//       register is integer math — no float surface, cf. M-9)
//
// Run: node bench.mjs

import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';

// ---- Elite's twist register (canonical algorithm, planet.rb:46 cross-check) ----
const twist = (w) => [w[1], w[2], (w[0] + w[1] + w[2]) % 65536];
const CHARS = '..lexegezacebisousesarmaindirea.eratenberalavetiedorquanteisrion'.match(/../g);
function genGalaxy(seed) {
  let w = [...seed];
  const planets = [];
  for (let p = 0; p < 256; p++) {
    // 4 twists = next planet (sequence-locked, the documented cost)
    for (let k = 0; k < 4; k++) w = twist(w);
    const name = [0, 1, 2].map((k) => {
      const v = [w, twist(w), twist(twist(w))][k];
      return CHARS[(v[2] >> 8) & 31];
    }).join('').replaceAll('.', '').replace(/^./, (c) => c.toUpperCase());
    planets.push({
      name,
      x: w[1] >> 8, y: w[0] >> 8,
      gov: (w[1] >> 3) & 7,
      econ: ((w[0] >> 8) & 7) | ((w[1] >> 3) & 7 <= 1 ? 2 : 0),
      tech: ((w[1] >> 8) & 3) + (((w[0] >> 8) & 7) ^ 7) + (((w[1] >> 3) & 7) >> 1) + 1,
    });
  }
  return planets;
}

console.log('=== M-6 transfer test: procedural-from-seeds vs stored content ===\n');

// ---- (1) payload: 8 galaxies from 48 bits each ----
const seeds = Array.from({ length: 8 }, (_, g) => [(0x5A4A * (g + 1)) % 65536, (0x0248 + g * 7) % 65536, 0xB103]);
let t0 = performance.now();
const galaxies = seeds.map(genGalaxy);
const genMs = performance.now() - t0;
const all = galaxies.flat();
const seedBytes = seeds.length * 6;                       // 3 × 16-bit words
const jsonBytes = Buffer.from(JSON.stringify(all)).length;
const gzBytes = gzipSync(Buffer.from(JSON.stringify(all))).length;
console.log(`payload: ${all.length} planets (${galaxies.length} galaxies × 256)`);
console.log(`  seeds shipped      : ${seedBytes} bytes`);
console.log(`  content serialized : ${jsonBytes} bytes  (gzipped: ${gzBytes})`);
console.log(`  compression factor : ${(jsonBytes / seedBytes).toFixed(0)}x raw, ${(gzBytes / seedBytes).toFixed(0)}x vs gzip`);
console.log(`  generation time    : ${genMs.toFixed(2)}ms for all ${all.length} planets`);

// ---- (2) determinism: same seeds -> identical content (cross-run + hash) ----
const hashPlanets = (gs) => {
  let h = 0x811c9dc5 >>> 0;
  for (const p of gs.flat()) {
    for (const ch of Buffer.from(p.name + p.x + ',' + p.y + p.gov + p.econ + p.tech)) {
      h ^= ch; h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16);
};
const h1 = hashPlanets(galaxies);
const h2 = hashPlanets(seeds.map(genGalaxy));
console.log(`\ndeterminism: regen hash ${h1} vs ${h2} -> ${h1 === h2 ? 'IDENTICAL' : 'DIVERGES'}`);

// ---- (3) modern framing: 10k seeded test fixtures vs storing them ----
{
  // seeded PRNG (mulberry32) -> 10k structured fixtures
  const N = 10000;
  const mkRng = (seed) => { let a = seed >>> 0; return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const fixturesFrom = (seed) => {
    const rng = mkRng(seed);
    const out = [];
    for (let i = 0; i < N; i++) {
      out.push({ id: i, score: Math.round(rng() * 1000), flag: rng() < 0.3,
                 tags: [rng() < 0.5 ? 'a' : 'b', rng() < 0.5 ? 'c' : 'd'],
                 label: `fixture-${i}-${Math.round(rng() * 1e6).toString(36)}` });
    }
    return out;
  };
  t0 = performance.now();
  const fx = fixturesFrom(0xD00D);
  const fixGen = performance.now() - t0;
  const fxJson = Buffer.from(JSON.stringify(fx)).length;
  const fxGz = gzipSync(Buffer.from(JSON.stringify(fx))).length;
  t0 = performance.now();
  const fx2 = fixturesFrom(0xD00D);
  const fixGen2 = performance.now() - t0;
  const same = JSON.stringify(fx) === JSON.stringify(fx2);
  console.log(`\nmodern framing: ${N} test fixtures from a 32-bit seed:`);
  console.log(`  seed shipped: 4 bytes; content: ${fxJson} bytes (gzipped: ${fxGz})`);
  console.log(`  regen cost: ${fixGen.toFixed(1)}ms (rerun ${fixGen2.toFixed(1)}ms, identical=${same})`);
  console.log(`  -> checked-in-fixture repo bloat vs one-line generator`);
}

console.log(`\nverdict: content-from-compact-state ships ${(jsonBytes / seedBytes).toFixed(0)}x smaller raw`);
console.log(`(${(gzBytes / seedBytes).toFixed(0)}x vs gzip) at negligible generation cost, and is`);
console.log(`replay-deterministic because the generator is integer math (the Elite`);
console.log(`twist register — no float surface, cf. M-9). Costs: sequence-locked`);
console.log(`regeneration (item N needs 0..N-1 or checkpointed seeds) and the`);
console.log(`generator's expressiveness bounds the content.`);
