// tide/test.mjs — headless verification of the TIDE core. Run: node tide/test.mjs
// Every PASS line is a mechanism receipt; failure exits nonzero.

import { EditorSession } from './session.mjs';
import { EditorCore } from './core.mjs';

let fails = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
}

// ---- fixture store ----
const files = new Map();
const readFile = (p) => files.get(p) ?? null;
const writeFile = (p, s) => files.set(p, s);

// 1. edit -> undo-all -> identical hash
{
  const s = new EditorSession({ readFile, writeFile });
  const b = s.open('a.txt', ['hello', 'world']);
  s.frame();
  const h0 = s.core.contentHash();
  for (let i = 0; i < 10; i++) { s.typeChar('x'); s.frame(); }
  s.newline(); s.frame();
  s.backspace(); s.frame();
  s.deleteLine(); s.frame();
  const st = s.core.undoStacks[b];
  while (st.length) { s.undo(); s.frame(); }
  check('undo-all restores opening content', s.core.contentHash() === h0, `${h0} vs ${s.core.contentHash()}`);
}
// capture h2 properly this time
{
  const s = new EditorSession({ readFile, writeFile });
  const b = s.open('a.txt', ['hello', 'world']);
  s.frame();
  for (let i = 0; i < 10; i++) { s.typeChar('x'); s.frame(); }
  s.newline(); s.frame();
  s.backspace(); s.frame();
  s.deleteLine(); s.frame();
  const h2 = s.core.contentHash();
  const st = s.core.undoStacks[b];
  while (st.length) { s.undo(); s.frame(); }
  while (s.core.redoStacks[b].length) { s.redo(); s.frame(); }
  check('undo-all + redo-all returns to post-edit content', s.core.contentHash() === h2,
        `${s.core.contentHash()} vs ${h2}`);
}

// 2. replay determinism: same command log -> identical hash, fresh core
{
  const sinkLines = [];
  const s = new EditorSession({ readFile, writeFile });
  s.core.logSink = (line) => sinkLines.push(line);
  const b = s.open('r.txt', ['one', 'two', 'three']);
  s.frame();
  s.moveToRow(1, 0); s.frame();
  for (const ch of 'XX ') s.typeChar(ch), s.frame();
  s.newline(); s.frame();
  s.typeChar('Z'); s.frame();
  s.deleteLine(); s.frame();
  s.undo(); s.frame();
  const h = s.core.hash();
  // replay on a fresh core
  const cmds = sinkLines.map((l) => JSON.parse(l));
  const s2 = new EditorSession({ readFile, writeFile });
  for (const { cmd } of cmds) s2.core.apply(cmd);
  check('log replay reproduces hash exactly', s2.core.hash() === h, `${h} vs ${s2.core.hash()}`);
}

// 3. crash recovery: unsaved edits (after last save op) restored from log tail
{
  const sinkLines = [];
  const s = new EditorSession({ readFile, writeFile });
  s.core.logSink = (line) => sinkLines.push(line);
  const b = s.openFile('/proj/notes.md');
  files.set('/proj/notes.md', 'alpha\nbeta\n');
  const b2 = s.openFile('/proj/notes.md');
  s.frame();
  s.moveToRow(0, 5); s.frame();
  s.typeChar('!'); s.frame();          // unsaved edit
  // "crash": nobody saved
  const cmds = sinkLines.map((l) => JSON.parse(l));
  const s2 = new EditorSession({ readFile, writeFile });
  for (const { cmd } of cmds) s2.core.apply(cmd);
  const snap = s2.core.snapshot();
  const buf = snap.bufs.find((x) => x.path === '/proj/notes.md');
  check('crash recovery replays unsaved edits', buf?.lines[0] === 'alpha!', buf?.lines[0])
}

// 4. hot-path allocation-free: cursor moves + idle frames = 0 slot churn
{
  const s = new EditorSession({ readFile, writeFile });
  const b = s.open('big.txt', Array.from({ length: 5000 }, (_, i) => `line ${i}`));
  s.frames(3);
  const a0 = s.core.stats.slotAllocs, f0 = s.core.stats.slotFrees;
  for (let i = 0; i < 200; i++) { s.move('down'); s.move('up'); s.frame(); }
  const churn = (s.core.stats.slotAllocs - a0) + (s.core.stats.slotFrees - f0);
  check('hot path (400 cursor moves) = 0 slot churn', churn === 0, `churn=${churn}`);
}

// 5. M-5 bounded search: 65k lines finish within a bounded number of ticks
{
  const s = new EditorSession({ readFile, writeFile });
  const lines = Array.from({ length: 65000 }, (_, i) => `line ${i} ${i % 1000 === 77 ? 'NEEDLE' : 'noise'}`);
  const b = s.open('big.txt', lines);
  s.frames(2);
  const t0 = performance.now();
  s.search('needle');
  let ticks = 0;
  while (!s.core.searchJobDone && ticks < 1000) { s.frame(); ticks++; }
  const dt = performance.now() - t0;
  check('65k-line search completes', s.core.searchJobDone, `ticks=${ticks}`);
  check('65k-line search bounded (<= 20 ticks @4096/tick)', ticks <= 20, `ticks=${ticks}, ${dt.toFixed(1)}ms total`);
  check('hits found in ring', s.core.searchHits.length === 65, `hits=${s.core.searchHits.length}`);
  const latency = dt / (ticks + 1);
  check('per-frame search latency bounded', latency < 25, `${latency.toFixed(2)}ms/frame`);
}

// 6. M-10: multi-buffer LRU order + eviction
{
  const s = new EditorSession({ readFile, writeFile });
  for (let i = 0; i < 66; i++) s.open(`f${i}.txt`, [`content ${i}`]); // BUF_CAP=64
  const order = s.core.lruOrder().filter((b) => s.core.bufFlag[b] === 1);
  check('buffer pool capped at 64 (LRU eviction)', order.length <= 64, `n=${order.length}`);
  check('oldest evicted', s.core.snapshot().bufs.every((x) => x.name !== 'f0.txt' || false) || !s.core.snapshot().bufs.some((x) => x.name === 'f0.txt'));
}

// 7. save round-trip
{
  const s = new EditorSession({ readFile, writeFile });
  const b = s.openFile('/t/x.txt');
  files.set('/t/x.txt', 'one\ntwo\n');
  const b2 = s.openFile('/t/x.txt');
  s.frame();
  s.moveToRow(1, 3); s.frame();          // end of 'two'
  s.typeChar('!'); s.frame();
  s.save();
  check('save writes content', files.get('/t/x.txt') === 'one\ntwo!\n', JSON.stringify(files.get('/t/x.txt')));
  check('savedAt recorded', s.core.bufSavedAt[b2] >= 0, `savedAt=${s.core.bufSavedAt[b2]}, tick=${s.core.tick}`);
}

// 8. replay AFTER undo/redo mixed session (the hard one)
{
  const sinkLines = [];
  const s = new EditorSession({ readFile, writeFile });
  s.core.logSink = (line) => sinkLines.push(line);
  const b = s.open('m.txt', ['a', 'b']);
  s.frame();
  s.typeChar('1'); s.frame();
  s.undo(); s.frame();
  s.typeChar('2'); s.frame();
  s.redo(); s.frame();  // redo stack cleared by typeChar, so no-op
  s.undo(); s.frame();
  s.undo(); s.frame();
  s.redo(); s.frame();
  const h = s.core.hash();
  const cmds = sinkLines.map((l) => JSON.parse(l));
  const s2 = new EditorSession({ readFile, writeFile });
  for (const { cmd } of cmds) s2.core.apply(cmd);
  check('undo/redo-heavy session replays exactly', s2.core.hash() === h, `${h} vs ${s2.core.hash()}`);
}

console.log(fails === 0 ? '\nALL TESTS PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
