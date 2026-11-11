// tide/ui.mjs — TUI shell: raw-mode terminal, diff renderer, vi-ish keys.
// Keys only REQUEST; every frame applies pending requests at the boundary
// (M-3) and repaints changed rows only.

import { EditorSession } from './session.mjs';
import fs from 'node:fs';

const ESC = '\x1b';
const ALT_ON = ESC + '[?1049h' + ESC + '[2J' + ESC + '[?25l';
const ALT_OFF = ESC + '[?25h' + ESC + '[?1049l';
const CLEAR = ESC + '[2J' + ESC + '[H';
const HIDE = ESC + '[?25l', SHOW = ESC + '[?25h';

export function runTUI({ logFile = null } = {}) {
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const writeFile = (p, s) => fs.writeFileSync(p, s);
  const session = new EditorSession({ readFile, writeFile });
  const core = session.core;
  if (logFile) core.logSink = (line) => fs.appendFileSync(logFile, line + '\n');

  process.stdout.write(ALT_ON);
  let cols = process.stdout.columns ?? 80, rows = process.stdout.rows ?? 24;
  process.stdout.on('resize', () => { cols = process.stdout.columns; rows = process.stdout.rows; prevRows = -1; });

  let mode = 'normal';        // normal | insert | prompt-open | prompt-search
  let promptText = '';
  let ddPending = false;
  let searchQ = '';
  let running = true;
  const keybuf = [];

  // ---------- rendering ----------
  let prevRows = -1;
  const renderRow = [];
  function render() {
    const b = session.active;
    const h = Math.max(1, rows - 2);
    const out = [];
    if (b !== -1) {
      const c = core;
      const curRow = session.cursorRow(b);
      let scroll = curScroll(b, curRow, h);
      let slot = c.bufHead[b];
      for (let i = 0; i < scroll && slot !== -1; i++) slot = c.lineNext[slot];
      for (let r = 0; r < h; r++) {
        if (slot === -1) { out.push(ESC + '[2K' + ESC + '[90m~' + ESC + '[0m'); continue; }
        const t = (c.lineText[slot] ?? '').slice(0, cols - 8);
        const isCursor = slot === c.bufCursor[b];
        const hl = c.searchHits.includes(slot) && c.searchQuery ? ESC + '[43m' : '';
        out.push(`${ESC + '[2K'}${ESC + '[90m'}${String(i + scroll + 1).padStart(5)} ${ESC + '[0m'}${hl}${t}${ESC + '[0m'}`);
        slot = c.lineNext[slot];
      }
      curScrollSet(b, scroll);
    } else {
      out.push(ESC + '[2K' + ESC + '[90mTIDE — Ctrl-O to open a file, Ctrl-Q to quit' + ESC + '[0m');
      for (let r = 1; r < h; r++) out.push(ESC + '[2K');
    }
    // status bar
    const st = [];
    st.push(mode === 'insert' ? '-- INSERT --' : mode.startsWith('prompt') ? `:${promptText}` : 'NORMAL');
    if (b !== -1) st.push(core.bufName[b] ?? '?', `${session.cursorRow(b) + 1}:${core.bufCol[b] + 1}`,
      `${core.bufLines[b]}L`, core.bufSavedAt[b] >= 0 ? 'saved' : 'UNSAVED');
    if (!core.searchJobDone) st.push(`search ${(core.searchProgress() * 100).toFixed(0)}%`);
    st.push(`${core.stats.slotAllocs}a/${core.stats.slotFrees}f`,
      `${core.stats.frames}f`, `${core.requests.length}pend`);
    if (core.searchHits.length) st.push(`${core.searchHits.length} hits`);
    const status = `${ESC + '[7m'} ${st.join(' │ ')}${' '.repeat(Math.max(0, cols - st.join(' │ ').length - 1))}${ESC + '[0m'}`;
    // paint
    let s = ESC + '[H';
    for (let r = 0; r < h; r++) { s += ESC + `[${r + 1};1H` + (out[r] ?? ''); }
    s += ESC + `[${h + 1};1H` + status;
    s += ESC + `[${h + 2};1H` + ESC + '[2K' + (mode === 'prompt-open' ? 'open: ' : mode === 'prompt-search' ? 'find: ' : '') + promptText;
    process.stdout.write(s);
  }
  const scrolls = new Int32Array(64);
  function curScroll(b, curRow, h) {
    let sc = scrolls[b];
    if (curRow < sc) sc = curRow;
    if (curRow > sc + h - 1) sc = curRow - h + 1;
    return sc;
  }
  function curScrollSet(b, v) { scrolls[b] = v; }

  // ---------- keys -> requests ----------
  function move(d) { session.move(d); }
  function key(ch) {
    const b = session.active;
    if (mode.startsWith('prompt')) {
      if (ch === ESC) { mode = 'normal'; promptText = ''; return; }
      if (ch === '\r') {
        if (mode === 'prompt-open') { session.openFile(promptText); }
        else if (mode === 'prompt-search') { searchQ = promptText; session.search(searchQ); }
        mode = 'normal'; promptText = ''; return;
      }
      if (ch === '\x7f') { promptText = promptText.slice(0, -1); return; }
      if (ch.length === 1 && ch >= ' ') { promptText += ch; if (mode === 'prompt-search') session.search(promptText); }
      return;
    }
    if (mode === 'insert') {
      if (ch === ESC) { mode = 'normal'; return; }
      if (ch === '\r') { session.newline(); return; }
      if (ch === '\x7f') { session.backspace(); return; }
      if (ch.length === 1 && ch >= ' ') { session.typeChar(ch); return; }
      return;
    }
    // normal mode
    if (ch === '\x11') { running = false; return; }              // Ctrl-Q
    if (ch === '\x0f') { mode = 'prompt-open'; promptText = ''; return; } // Ctrl-O
    if (ch === '\x13') { session.save(); return; }               // Ctrl-S
    if (ch === '\x10' || ch === '\x0e') {                        // Ctrl-P/N buffer cycle
      const order = core.lruOrder().filter((x) => core.bufFlag[x] === 1);
      if (order.length) {
        const i = order.indexOf(b);
        const nb = order[(i + (ch === '\x10' ? -1 + order.length : 1)) % order.length];
        core.request({ op: 'activate', buf: nb });
      }
      return;
    }
    if (ch === 'i') { mode = 'insert'; return; }
    if (ch === 'a') { move('right'); mode = 'insert'; return; }
    if (ch === 'o') { session.newline(); mode = 'insert'; return; }
    if (ch === 'h') return move('left');
    if (ch === 'l') return move('right');
    if (ch === 'j') return move('down');
    if (ch === 'k') return move('up');
    if (ch === 'x') { /* delete char under cursor */ const c = core, slot = c.bufCursor[b], col = c.bufCol[b];
      const t = c.lineText[slot] ?? '';
      if (col < t.length) c.request({ op: 'set', buf: b, slot, text: t.slice(0, col) + t.slice(col + 1) });
      return; }
    if (ch === 'd') { if (ddPending) { session.deleteLine(); ddPending = false; } else { ddPending = true; } return; }
    if (ch === 'u') { session.undo(); return; }
    if (ch === '\x12') { session.redo(); return; }               // Ctrl-R
    if (ch === '/') { mode = 'prompt-search'; promptText = ''; session.search(''); return; }
    if (ch === 'n') { session.nextHit(); return; }
    if (ch === '0') { const slot = core.bufCursor[b]; core.request({ op: 'cursor', buf: b, slot, col: 0 }); return; }
    if (ch === '$') { const slot = core.bufCursor[b]; core.request({ op: 'cursor', buf: b, slot, col: (core.lineText[slot] ?? '').length }); return; }
    if (ch === 'g') { session.moveToRow(0, 0); return; }
    if (ch === 'G') { session.moveToRow(core.bufLines[b] - 1, 0); return; }
    if (ch === 'w') { session.save(); return; } // convenience
  }
  function decode(chunk) {
    const s = chunk.toString('utf8');
    for (let i = 0; i < s.length; i++) {
      if (s[i] === ESC) {
        if (s[i + 1] === '[') {
          const m = /^([A-DH FU])?/.exec(s.slice(i + 2));
          const seq = s.slice(i + 2, i + 4);
          if (seq === '[A') { key('up:'); i += 3; continue; }
          if (seq === '[B') { key('dn:'); i += 3; continue; }
          if (seq === '[C') { key('rt:'); i += 3; continue; }
          if (seq === '[D') { key('lf:'); i += 3; continue; }
          i += 2; continue; // skip unknown CSI
        }
        key(ESC); i++; continue;
      }
      key(s[i]);
    }
  }
  // arrow keys map to move()
  const _key = key;
  // eslint-disable-next-line no-func-assign
  key = function (ch) {
    if (ch === 'up:') return mode === 'insert' || mode === 'normal' ? move('up') : undefined;
    if (ch === 'dn:') return move('down');
    if (ch === 'rt:') return move('right');
    if (ch === 'lf:') return move('left');
    return _key(ch);
  };

  // ---------- frame loop (M-3: apply at boundary) ----------
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (c) => decode(c));
  const timer = setInterval(() => {
    session.frame();
    render();
    if (!running) { clearInterval(timer); process.stdin.setRawMode(false); process.stdout.write(ALT_OFF + SHOW); process.exit(0); }
  }, 16);
  process.on('exit', () => { process.stdout.write(ALT_OFF + SHOW); });
}
