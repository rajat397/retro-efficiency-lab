// tide-gate.mjs — per-task quality gate. Runs in the agent's worktree.
// Reads what changed vs master; asserts the lab's evidence standards:
// findings files must exist, carry file:line anchors, no placeholders,
// and agents may touch ONLY targets/rct/* (analysis discipline).
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const changed = execSync('git diff master...HEAD --name-only', { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);

const bad = changed.filter((f) => !f.startsWith('targets/rct/'));
if (bad.length) { console.error(`gate FAIL: agents may only touch targets/rct/* — touched: ${bad.join(', ')}`); process.exit(1); }

if (!changed.length) { console.error('gate FAIL: no changes at all'); process.exit(1); }

let ok = true;
for (const f of changed) {
  const src = fs.readFileSync(f, 'utf8');
  const bytes = src.length;
  const anchors = (src.match(/(src\/openrct2|RCT2\.h|RCT12\.h|Limits\.h|Park\.cpp|Peep\.cpp)[^\s)]*:?(\d+)?|:[0-9]{2,5}\b/g) || []).length;
  const todos = (src.match(/TODO|FIXME|<insert|TBD\b|lorem/i) || []).length;
  console.log(`gate: ${f} bytes=${bytes} anchors=${anchors} todos=${todos}`);
  if (f.endsWith('smoke-T0.md')) { if (!/smoke ok/.test(src)) { ok = false; console.error('gate FAIL: smoke file wrong'); } continue; }
  if (bytes < 800 || anchors < 3 || todos > 0) { ok = false; console.error(`gate FAIL: ${f} below evidence bar`); }
}
process.exit(ok ? 0 : 1);
