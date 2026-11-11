// tide/bench.mjs — mechanism receipts measured on the REAL editor core.
// Run: node bench.mjs
import { EditorSession } from './session.mjs';
import { BUF_CAP } from './core.mjs';

const mk = (n, needleEvery = 1000) =>
  Array.from({ length: n }, (_, i) => `line ${i} ${needleEvery && i % needleEvery === 77 ? 'NEEDLE' : 'noise'}`);
const readFile = () => null, writeFile = () => {};

// ---- B1: M-10 list-walk vs naive full-slot scan (3 buffers, active only) ----
{
  const s = new EditorSession({ readFile, writeFile });
  const ba = s.open('a.txt', mk(20000)), bb = s.open('b.txt', mk(20000)), bc = s.open('c.txt', mk(25000));
  s.core.request({ op: 'activate', buf: bc }); s.frame();
  // list-walk (what TIDE does)
  let t0 = performance.now();
  s.search('needle'); while (!s.core.searchJobDone) s.frame();
  const tList = performance.now() - t0;
  const hitsList = s.core.searchHits.length;
  // naive: scan ALL 65,536 line slots flag-testing (what a slot-less design pays)
  t0 = performance.now();
  const c = s.core, q = 'needle';
  let hits = 0;
  for (let slot = 0; slot < c.lineFlag.length; slot++) {
    if (c.lineFlag[slot] !== 1) continue;
    const t = c.lineText[slot];
    if (t && t.toLowerCase().includes(q)) hits++;
  }
  const tScan = performance.now() - t0;
  console.log(`B1 M-10 list-walk  : ${hitsList} hits in ${tList.toFixed(1)}ms (walks 25k lines)`);
  console.log(`B1 naive full-scan : ${hits} hits in ${tScan.toFixed(1)}ms (visits all 65k slots)`);
  console.log(`   -> list discipline pays ${(tScan / Math.max(tList, 0.01)).toFixed(2)}x on this workload`);
}

// ---- B2: M-4 replay determinism on the real core ----
{
  const logLines = [];
  const s = new EditorSession({ readFile, writeFile });
  s.core.logSink = (l) => logLines.push(l);
  const b = s.open('r.txt', mk(200, 50));
  s.frame();
  for (let i = 0; i < 50; i++) { s.move('down'); s.frame(); }
  s.moveToRow(3, 5); s.frame();
  for (const ch of ' injected ') { s.typeChar(ch); s.frame(); }
  s.deleteLine(); s.frame(); s.undo(); s.frame();
  const h = s.core.hash();
  const s2 = new EditorSession({ readFile, writeFile });
  for (const l of logLines) s2.core.apply(JSON.parse(l).cmd);
  console.log(`B2 M-4 replay      : log=${logLines.length} cmds, hash match = ${s2.core.hash() === h} (${h})`);
}

// ---- B3: M-5 bounded search latency on a 65k-line file ----
{
  const s = new EditorSession({ readFile, writeFile });
  s.open('big.txt', mk(65000, 1000));
  s.frames(2);
  const t0 = performance.now();
  s.search('needle');
  let ticks = 0; while (!s.core.searchJobDone) { s.frame(); ticks++; }
  const dt = performance.now() - t0;
  console.log(`B3 M-5 bounded srch: 65k lines, ${ticks} ticks, ${(dt / (ticks + 1)).toFixed(2)}ms/frame (input stays live)`);
}

// ---- B4: M-2 zero structural churn in the hot path ----
{
  const s = new EditorSession({ readFile, writeFile });
  const b = s.open('big.txt', mk(50000, 5000));
  s.frames(3);
  const a0 = s.core.stats.slotAllocs, f0 = s.core.stats.slotFrees;
  for (let i = 0; i < 500; i++) { s.move('down'); s.move('right'); s.move('up'); s.frame(); }
  const churn = (s.core.stats.slotAllocs - a0) + (s.core.stats.slotFrees - f0);
  console.log(`B4 M-2 hot path    : 1500 cursor-move frames, structural churn = ${churn} (must be 0)`);
}
