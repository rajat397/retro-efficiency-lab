// Summarize VDBE profiles for the DELETE-vs-WAL experiment.
// Usage: node targets/sqlite/summarize-profiles.mjs
// Reads /tmp/opencode/prof-delete.out and /tmp/opencode/prof-wal.out,
// prints aggregate deltas only (never dumps raw profile lines).

import { readFileSync } from 'node:fs';
import { parseVdbeProfile, aggregate } from './parse-vdbe-profile.mjs';

const FILES = [
  ['delete', '/tmp/opencode/prof-delete.out'],
  ['wal', '/tmp/opencode/prof-wal.out'],
];

const TARGET_SQL_RE = /FROM t1 WHERE n=42/;

for (const [label, path] of FILES) {
  const text = readFileSync(path, 'utf8');
  const statements = parseVdbeProfile(text);
  const agg = aggregate(statements);

  const targetBlocks = statements.filter(
    (s) => s.executed && TARGET_SQL_RE.test(s.sql ?? ''),
  );
  const zeroDup = statements.filter(
    (s) => !s.executed && TARGET_SQL_RE.test(s.sql ?? ''),
  );

  const targetCycles = targetBlocks.reduce((a, s) => a + s.ops.reduce((x, o) => x + o.cycles, 0), 0);

  console.log(`=== ${label} (${path}) ===`);
  console.log(`blocks: total=${agg.totalStatements} executed=${agg.executedStatements}`);
  console.log(`target SQL blocks: executed=${targetBlocks.length} zero-exec-dupes=${zeroDup.length}`);
  console.log(`target cycles total=${targetCycles} avg=${targetBlocks.length ? (targetCycles / targetBlocks.length).toFixed(0) : 'n/a'}`);

  const focus = ['Transaction', 'Halt', 'SeekGE', 'IdxGE', 'Column', 'DeferredSeek', 'OpenRead', 'Next', 'ResultRow'];
  for (const op of focus) {
    const slot = agg.byOpcode[op];
    if (!slot) continue;
    const avg = slot.execs ? (slot.cycles / slot.execs).toFixed(1) : 'n/a';
    console.log(`  ${op.padEnd(13)} execs=${String(slot.execs).padStart(7)} cycles=${String(slot.cycles).padStart(10)} avg=${avg}`);
  }

  // byStatement stats over executed blocks
  const stmtCycles = agg.byStatement.map((s) => s.cycles);
  const sum = stmtCycles.reduce((a, b) => a + b, 0);
  console.log(`executed-statement cycles: sum=${sum} avg=${(sum / stmtCycles.length).toFixed(0)} n=${stmtCycles.length}`);

  // target-specific per-statement average (range scan)
  if (targetBlocks.length) {
    const tSums = targetBlocks.map((s) => s.ops.reduce((x, o) => x + o.cycles, 0));
    const tAvg = tSums.reduce((a, b) => a + b, 0) / tSums.length;
    console.log(`target per-statement cycles: avg=${tAvg.toFixed(0)} min=${Math.min(...tSums)} max=${Math.max(...tSums)} n=${tSums.length}`);
  }
  console.log('');
}
