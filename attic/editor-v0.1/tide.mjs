#!/usr/bin/env node
// tide.mjs — TIDE entry point.
//   node tide.mjs                TUI (raw terminal)
//   node tide.mjs --recover LOG  resume a crashed/previous session from its log
//   node tide.mjs --script FILE  headless scripted session (for CI/demo)

import { runTUI } from './ui.mjs';
import { EditorSession } from './session.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--recover')) {
  const log = args[args.indexOf('--recover') + 1];
  if (!log || !fs.existsSync(log)) { console.error('no such log'); process.exit(1); }
  console.log(`recovery: replaying ${log} ...`);
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const writeFile = (p, s) => fs.writeFileSync(p, s);
  const s = new EditorSession({ readFile, writeFile });
  for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    s.core.apply(JSON.parse(line).cmd);
  }
  const snap = s.core.snapshot();
  for (const b of snap.bufs) {
    console.log(`  ${b.path}  ${b.lines.length} lines  ${b.savedAt >= 0 ? 'saved' : 'UNSAVED edits recovered'}`);
  }
  console.log(`state hash ${snap.hash} — edits after the last save are in memory; re-run the TUI with this log to continue.`);
  process.exit(0);
}

if (args.includes('--script')) {
  const file = args[args.indexOf('--script') + 1];
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const writeFile = (p, s) => fs.writeFileSync(p, s);
  const s = new EditorSession({ readFile, writeFile });
  const cmds = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  for (const c of cmds) {
    const [op, ...rest] = c.split(' ');
    if (op === 'open') s.openFile(rest[0]);
    else if (op === 'type') for (const ch of rest.join(' ')) { s.typeChar(ch); s.frame(); }
    else if (op === 'save') s.save();
    else if (op === 'undo') { s.undo(); s.frame(); }
    else if (op === 'redo') { s.redo(); s.frame(); }
    else if (op === 'find') { s.search(rest.join(' ')); while (!s.core.searchJobDone) s.frame(); }
    else if (op === 'report') console.log(JSON.stringify(s.core.snapshot(), null, 1));
  }
  console.log(`final hash ${s.core.snapshot().hash}`);
  process.exit(0);
}

const logIdx = args.indexOf('--log');
runTUI({ logFile: logIdx !== -1 ? args[logIdx + 1] : null });
