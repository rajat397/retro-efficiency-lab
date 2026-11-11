// tide/session.mjs — high-level editing ops on EditorCore, I/O injected.
// The session is the deterministic surface the TUI and tests both drive.

import { EditorCore, BUF_CAP } from './core.mjs';

export class EditorSession {
  constructor({ readFile, writeFile } = {}) {
    this.core = new EditorCore();
    this.readFile = readFile ?? (() => null);
    this.writeFile = writeFile ?? (() => {});
    this.freeBufPtr = BUF_CAP - 1;   // simple allocator for open()
  }

  // ---- frame discipline: session methods only *request* (M-3) ----
  frame() { this.core.tickFrame(); }
  frames(n) { for (let i = 0; i < n; i++) this.core.tickFrame(); }

  open(name, lines, path = name) {
    const buf = this.nextFreeBuf();
    this.core.request({ op: 'open', buf, name, path, lines });
    this.frame();
    return buf;
  }
  openFile(path) {
    const content = this.readFile(path);
    if (content == null) return -1;
    const body = content.endsWith('\n') ? content.slice(0, -1) : content;  // no artifact line
    return this.open(path.split('/').pop(), body.split('\n'), path);
  }
  nextFreeBuf() {
    for (let b = BUF_CAP - 1; b >= 0; b--) if (this.core.bufFlag[b] === 0) return b;
    // M-10/eviction: close the LRU buffer (first in lruOrder)
    const lru = this.core.lruOrder()[0];
    if (lru !== undefined) { this.core.request({ op: 'close', buf: lru }); this.frame(); return lru; }
    throw new Error('no buffers');
  }
  get active() { return this.core.activeBuf; }
  buf(b = this.active) { return b; }

  // ---- cursor movement (requests) ----
  move(dir, b = this.active) {
    const c = this.core, cur = c.bufCursor[b], col = c.bufCol[b];
    let target = cur;
    if (dir === 'left') {
      if (col > 0) return this.cursor(cur, col - 1, b);
      target = c.linePrev[cur];
      if (target === -1) return;
      return this.cursor(target, Math.max(0, (c.lineText[target] ?? '').length), b);
    }
    if (dir === 'right') {
      const len = (c.lineText[cur] ?? '').length;
      if (col < len) return this.cursor(cur, col + 1, b);
      target = c.lineNext[cur];
      if (target === -1) return;
      return this.cursor(target, 0, b);
    }
    if (dir === 'up' || dir === 'down') {
      let n = cur;
      for (let i = 0; i < (dir === 'up' ? 1 : 1); i++) {
        const step = dir === 'up' ? c.linePrev : c.lineNext;
        if (step[n] === -1) break;
        n = step[n];
      }
      if (n === cur) return;
      const len = (c.lineText[n] ?? '').length;
      return this.cursor(n, Math.min(col, len), b);
    }
  }
  cursor(slot, col, b = this.active) { this.core.request({ op: 'cursor', buf: b, slot, col }); }
  moveToRow(row, col, b = this.active) { // O(row) — viewport offsets are small
    let s = this.core.bufHead[b];
    for (let i = 0; i < row && s !== -1; i++) s = this.core.lineNext[s];
    if (s !== -1) this.cursor(s, col, b);
  }
  cursorRow(b = this.active) {
    const c = this.core; let i = 0;
    for (let s = c.bufHead[b]; s !== -1; s = c.lineNext[s], i++) if (s === c.bufCursor[b]) return i;
    return -1;
  }

  // ---- editing ----
  typeChar(ch, b = this.active) {
    const c = this.core, slot = c.bufCursor[b], col = c.bufCol[b];
    const t = c.lineText[slot] ?? '';
    c.request({ op: 'set', buf: b, slot, text: t.slice(0, col) + ch + t.slice(col) });
    this.cursor(slot, col + 1, b);
  }
  backspace(b = this.active) {
    const c = this.core, slot = c.bufCursor[b], col = c.bufCol[b];
    const t = c.lineText[slot] ?? '';
    if (col > 0) {
      c.request({ op: 'set', buf: b, slot, text: t.slice(0, col - 1) + t.slice(col) });
      this.cursor(slot, col - 1, b);
    } else {
      const prev = c.linePrev[slot];
      if (prev === -1) return;
      const pl = c.lineText[prev] ?? '';
      c.request({ op: 'set', buf: b, slot: prev, text: pl + t });
      c.request({ op: 'del', buf: b, slot });
      this.cursor(prev, pl.length, b);
    }
  }
  newline(b = this.active) {
    const c = this.core, slot = c.bufCursor[b], col = c.bufCol[b];
    const t = c.lineText[slot] ?? '';
    c.request({ op: 'set', buf: b, slot, text: t.slice(0, col) });
    const ns = c.allocSlot();                 // deterministic; logged via ins cmd
    c.request({ op: 'ins', buf: b, slot: ns, after: slot, text: t.slice(col) });
    this.cursor(ns, 0, b);
  }
  deleteLine(b = this.active) {
    const c = this.core, slot = c.bufCursor[b];
    if (slot !== -1) c.request({ op: 'del', buf: b, slot });
  }
  undo(b = this.active) { this.core.request({ op: 'undo', buf: b }); }
  redo(b = this.active) { this.core.request({ op: 'redo', buf: b }); }

  // ---- search (M-5) ----
  search(q, b = this.active) {
    if (q !== this.core.searchQuery || q === '') this.core.startSearch(b, q === '' ? null : q);
    // runs progressively across ticks; poll core.searchHits
  }
  nextHit(b = this.active) {
    const c = this.core;
    if (!c.searchHits.length) return;
    const hits = c.searchHits;
    const cur = c.bufCursor[b];
    let idx = hits.indexOf(cur);
    const next = hits[(idx + 1) % hits.length] ?? hits[0];
    this.cursor(next, 0, b);
  }

  // ---- persistence ----
  save(b = this.active) {
    const c = this.core;
    const lines = [];
    for (let s = c.bufHead[b]; s !== -1; s = c.lineNext[s]) lines.push(c.lineText[s]);
    this.writeFile(c.bufPath[b], lines.join('\n') + (lines.length ? '\n' : ''));
    c.request({ op: 'save', buf: b });
    this.frame();
  }
}
