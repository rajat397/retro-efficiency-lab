// tide/core.mjs — TIDE editor core: headless, deterministic, mechanism-backed.
//
// Mechanisms applied where they earn their keep:
//   M-2  fixed slot pools      buffers, lines, search-hit ring, undo rings
//   M-10 index-linked lists    line tables = next/prev index chains in the
//                              line slots; iteration walks subsets only
//   M-3  deferred application  ALL mutations are requests, applied at the
//                              frame boundary (tickFrame)
//   M-4  replay determinism    every mutation is a logged command (allocator
//                              decisions included); log replay => identical
//                              hash. Undo/redo are replay of inverse/re-apply.
//   M-5  measured slowdown     search budgeted per tick; latency bounded

const F_FREE = 0, F_ALIVE = 1;
const LINE_CAP = 65536, BUF_CAP = 64, HIT_CAP = 256, UNDO_CAP = 4096;
const SEARCH_BUDGET_LINES = 4096;

export function fnv1a(bytes) {
  let h = 0x811c9dc5 >>> 0;
  for (const b of bytes) { h ^= b & 0xff; h = Math.imul(h, 0x01000193); h ^= b >>> 8; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const strHash = (s) => fnv1a(Buffer.from(s, 'utf8'));

export class EditorCore {
  constructor() {
    this.tick = 0;
    this.requests = [];          // M-3 pending
    this.log = [];               // M-4 command log
    this.logSink = null;

    // ---- M-2 pools ----
    this.lineFlag = new Int32Array(LINE_CAP);
    this.lineNext = new Int32Array(LINE_CAP);
    this.linePrev = new Int32Array(LINE_CAP);
    this.lineText = new Array(LINE_CAP).fill(null);
    this.freeLines = new Int32Array(LINE_CAP);
    for (let i = 0; i < LINE_CAP; i++) this.freeLines[i] = LINE_CAP - 1 - i;
    this.freeLineTop = LINE_CAP;

    this.bufFlag = new Int32Array(BUF_CAP);
    this.bufName = new Array(BUF_CAP).fill(null);
    this.bufPath = new Array(BUF_CAP).fill(null);
    this.bufHead = new Int32Array(BUF_CAP).fill(-1);
    this.bufTail = new Int32Array(BUF_CAP).fill(-1);
    this.bufLines = new Int32Array(BUF_CAP);
    this.bufCursor = new Int32Array(BUF_CAP).fill(-1);
    this.bufCol = new Int32Array(BUF_CAP);
    this.bufSavedAt = new Int32Array(BUF_CAP).fill(-1);
    this.freeBufs = new Int32Array(BUF_CAP);
    for (let i = 0; i < BUF_CAP; i++) this.freeBufs[i] = BUF_CAP - 1 - i;
    this.freeBufTop = BUF_CAP;

    // M-10: buffer LRU list over the buffer pool
    this.lruNext = new Int32Array(BUF_CAP).fill(-1);
    this.lruPrev = new Int32Array(BUF_CAP).fill(-1);
    this.lruHead = -1; this.lruTail = -1;

    this.activeBuf = -1;
    this.undoStacks = Array.from({ length: BUF_CAP }, () => []);
    this.redoStacks = Array.from({ length: BUF_CAP }, () => []);

    // M-5 search job
    this.searchQuery = null; this.searchBuf = -1; this.searchSlot = -1;
    this.searchHits = []; this.searchJobDone = true;
    this.searchLinesDone = 0; this.searchTotal = 0;

    this.stats = { frames: 0, slotAllocs: 0, slotFrees: 0, cmdApplies: 0,
                   searchTicks: 0, hitsDropped: 0 };
    this._mode = null; // 'undo' | 'redo' while applying inverse/replay cmds
  }

  // ---------- M-3 frame boundary ----------
  request(cmd) { this.requests.push(cmd); }
  tickFrame() {
    for (const cmd of this.requests) this.apply(cmd, true);
    this.requests.length = 0;
    this.tick++; this.stats.frames++;
    this.tickSearch();
  }

  // ---------- M-4: the only mutation entrypoint ----------
  apply(cmd, toLog = false) {
    this.cmdApply(cmd);
    if (toLog) {
      this.log.push({ t: this.tick, cmd });
      this.logSink?.(JSON.stringify({ t: this.tick, cmd }));
    }
    this.stats.cmdApplies++;
  }
  cmdApply(cmd) {
    switch (cmd.op) {
      case 'open':     return this.doOpen(cmd);
      case 'close':    return this.doClose(cmd);
      case 'ins':      return this.doIns(cmd);
      case 'set':      return this.doSet(cmd);
      case 'del':      return this.doDel(cmd);
      case 'cursor':   return this.doCursor(cmd);
      case 'save':     return this.doSave(cmd);
      case 'activate': return this.doActivate(cmd);
      case 'undo':     return this.doUndo(cmd);
      case 'redo':     return this.doRedo(cmd);
      // inverse commands — only ever produced by undo/redo, but logged as-is
      case 'unins':    return this.unins(cmd);
      case 'unset':    return this.unset(cmd);
      case 'undel':    return this.undel(cmd);
      default: throw new Error(`unknown op ${cmd.op}`);
    }
  }

  // ---------- M-2 pool ops ----------
  allocSlot() {
    if (this.freeLineTop === 0) throw new Error('line pool exhausted');
    const s = this.freeLines[--this.freeLineTop];
    this.lineFlag[s] = F_ALIVE; this.stats.slotAllocs++;
    return s;
  }
  allocSpecific(slot) { // undo path: reuse the exact slot the log recorded
    for (let i = this.freeLineTop - 1; i >= 0; i--) {
      if (this.freeLines[i] === slot) {
        this.freeLines[i] = this.freeLines[this.freeLineTop - 1];
        this.freeLineTop--; break;
      }
    }
    this.lineFlag[slot] = F_ALIVE; this.stats.slotAllocs++;
    return slot;
  }
  freeSlot(s) {
    this.lineFlag[s] = F_FREE; this.lineText[s] = null;
    this.freeLines[this.freeLineTop++] = s; this.stats.slotFrees++;
  }

  // ---------- M-10: index-linked line list ----------
  link(buf, slot, after) {
    const n = this.lineNext, p = this.linePrev;
    if (after === -1) {
      n[slot] = this.bufHead[buf]; p[slot] = -1;
      if (this.bufHead[buf] !== -1) p[this.bufHead[buf]] = slot;
      this.bufHead[buf] = slot;
      if (this.bufTail[buf] === -1) this.bufTail[buf] = slot;
    } else {
      n[slot] = n[after]; p[slot] = after;
      if (n[after] !== -1) p[n[after]] = slot; else this.bufTail[buf] = slot;
      n[after] = slot;
    }
    this.bufLines[buf]++;
  }
  unlink(buf, slot) {
    const n = this.lineNext, p = this.linePrev;
    if (p[slot] !== -1) n[p[slot]] = n[slot]; else this.bufHead[buf] = n[slot];
    if (n[slot] !== -1) p[n[slot]] = p[slot]; else this.bufTail[buf] = p[slot];
    n[slot] = p[slot] = -1;
    this.bufLines[buf]--;
  }
  lruTouch(buf) {
    if (this.lruTail === buf) return;
    if (this.lruHead === -1) { this.lruHead = this.lruTail = buf; return; }
    if (this.lruPrev[buf] !== -1) this.lruNext[this.lruPrev[buf]] = this.lruNext[buf];
    if (this.lruNext[buf] !== -1) this.lruPrev[this.lruNext[buf]] = this.lruPrev[buf];
    if (this.lruHead === buf) this.lruHead = this.lruNext[buf];
    this.lruNext[buf] = -1; this.lruPrev[buf] = this.lruTail;
    if (this.lruTail !== -1) this.lruNext[this.lruTail] = buf;
    this.lruTail = buf;
    if (this.lruHead === -1) this.lruHead = buf;
  }
  lruOrder() { const out = []; for (let b = this.lruHead; b !== -1; b = this.lruNext[b]) out.push(b); return out; }

  // ---------- commands (all carry their own undo/redo bookkeeping, so the
  // stacks are re-derivable purely from a log replay) ----------
  doOpen({ buf, name, path, lines }) {
    this.bufFlag[buf] = F_ALIVE;
    this.bufName[buf] = name; this.bufPath[buf] = path ?? name;
    this.bufHead[buf] = this.bufTail[buf] = -1; this.bufLines[buf] = 0;
    this.bufCursor[buf] = -1; this.bufCol[buf] = 0; this.bufSavedAt[buf] = -1;
    let after = -1;
    for (const text of lines) {
      const s = this.allocSlot();
      this.lineText[s] = text;
      this.link(buf, s, after);
      after = s;
    }
    this.bufCursor[buf] = this.bufHead[buf];
    this.lruTouch(buf);
    if (this.activeBuf === -1) this.activeBuf = buf;
  }
  doClose({ buf }) {
    for (let s = this.bufHead[buf]; s !== -1; ) {
      const nx = this.lineNext[s];
      this.unlink(buf, s); this.freeSlot(s); s = nx;
    }
    this.bufFlag[buf] = F_FREE; this.bufName[buf] = this.bufPath[buf] = null;
    this.undoStacks[buf].length = 0; this.redoStacks[buf].length = 0;
    if (this.activeBuf === buf) {
      this.activeBuf = -1;
      for (const b of this.lruOrder()) if (this.bufFlag[b] === F_ALIVE) { this.activeBuf = b; break; }
    }
  }
  doIns(cmd) { // slot chosen by the (logged) allocator; never allocates here
    this.lineText[cmd.slot] = cmd.text;
    this.link(cmd.buf, cmd.slot, cmd.after);
    const c = this.bufCursor[cmd.buf];
    if (cmd.after === c) this.bufCursor[cmd.buf] = cmd.slot; // 'o' semantics
    this.pushUndo(cmd.buf, { op: 'unins', buf: cmd.buf, slot: cmd.slot }, { ...cmd });
  }
  doSet(cmd) {
    this.pushUndo(cmd.buf, { op: 'unset', buf: cmd.buf, slot: cmd.slot, prevText: this.lineText[cmd.slot] }, { ...cmd });
    this.lineText[cmd.slot] = cmd.text;
  }
  doDel(cmd) {
    const c = this.bufCursor[cmd.buf];
    if (c === cmd.slot) {
      const nx = this.lineNext[cmd.slot], pv = this.linePrev[cmd.slot];
      this.bufCursor[cmd.buf] = nx !== -1 ? nx : pv; // implicit move INSIDE logged cmd
    }
    this.pushUndo(cmd.buf, { op: 'undel', buf: cmd.buf, slot: cmd.slot,
                             after: this.linePrev[cmd.slot], text: this.lineText[cmd.slot] }, { ...cmd });
    this.unlink(cmd.buf, cmd.slot); this.freeSlot(cmd.slot);
  }
  doCursor({ buf, slot, col }) { this.bufCursor[buf] = slot; this.bufCol[buf] = col; }
  doSave({ buf }) { this.bufSavedAt[buf] = this.tick; }
  doActivate({ buf }) { this.activeBuf = buf; this.lruTouch(buf); }

  pushUndo(buf, undoCmd, redoCmd) {
    if (this._mode === 'redo') return; // doRedo owns stack movement
    const st = this.undoStacks[buf];
    st.push({ undoCmd, redoCmd });
    if (st.length > UNDO_CAP) st.shift(); // bounded (M-2)
    this.redoStacks[buf].length = 0;
  }
  doUndo({ buf }) {
    const e = this.undoStacks[buf].pop();
    if (!e) return;
    this._mode = 'undo';
    this.cmdApply(e.undoCmd);
    this._mode = null;
    this.redoStacks[buf].push({ undoCmd: e.undoCmd, redoCmd: e.redoCmd });
  }
  doRedo({ buf }) {
    const e = this.redoStacks[buf].pop();
    if (!e) return;
    this._mode = 'redo';   // pushUndo must NOT clear the redo stack mid-redo
    this.cmdApply(e.redoCmd);
    this._mode = null;
    this.undoStacks[buf].push({ undoCmd: e.undoCmd, redoCmd: e.redoCmd });
  }
  unins({ buf, slot }) {
    const c = this.bufCursor[buf];
    if (c === slot) {
      const nx = this.lineNext[slot], pv = this.linePrev[slot];
      this.bufCursor[buf] = nx !== -1 ? nx : pv;
    }
    this.unlink(buf, slot); this.freeSlot(slot);
  }
  unset({ buf, slot, prevText }) { this.lineText[slot] = prevText; }
  undel({ buf, slot, after, text }) {
    this.allocSpecific(slot);
    this.lineText[slot] = text; this.link(buf, slot, after);
    this.bufCursor[buf] = slot;
  }
}

// ---------- M-5 search: budgeted per tick, ring-buffered hits ----------
EditorCore.prototype.startSearch = function (buf, q) {
  this.searchBuf = buf; this.searchQuery = q;
  this.searchSlot = this.bufHead[buf];
  this.searchHits.length = 0;
  this.searchJobDone = this.searchSlot === -1;
  this.searchLinesDone = 0; this.searchTotal = Math.max(this.bufLines[buf], 1);
};
EditorCore.prototype.tickSearch = function () {
  if (this.searchJobDone || this.searchQuery === null) return;
  this.stats.searchTicks++;
  let budget = SEARCH_BUDGET_LINES;
  const q = this.searchQuery.toLowerCase();
  let s = this.searchSlot;
  for (; s !== -1 && budget > 0; s = this.lineNext[s], budget--) {
    const t = this.lineText[s];
    if (t && t.toLowerCase().includes(q)) {
      if (this.searchHits.length < HIT_CAP) this.searchHits.push(s);
      else this.stats.hitsDropped++;
    }
  }
  this.searchSlot = s;
  this.searchLinesDone = Math.min(this.searchTotal, this.searchLinesDone + SEARCH_BUDGET_LINES);
  if (this.searchSlot === -1) this.searchJobDone = true;
};
EditorCore.prototype.searchProgress = function () {
  return this.searchTotal ? this.searchLinesDone / this.searchTotal : 1;
};

// ---------- M-4 verification ----------
// content-only hash (undo/redo verification: cursor commands are logged and
// replayed but deliberately NOT undone — undo restores content, not position)
EditorCore.prototype.contentHash = function () {
  const parts = [];
  for (let b = 0; b < BUF_CAP; b++) {
    if (this.bufFlag[b] !== F_ALIVE) continue;
    parts.push(`${b}:${this.bufLines[b]}`);
    for (let s = this.bufHead[b]; s !== -1; s = this.lineNext[s])
      parts.push(`${s}:${strHash(this.lineText[s] ?? '')}`);
  }
  return fnv1a(Buffer.from(parts.join('|'), 'utf8')).toString(16);
};
EditorCore.prototype.hash = function () {
  const parts = [];
  for (let b = 0; b < BUF_CAP; b++) {
    if (this.bufFlag[b] !== F_ALIVE) continue;
    parts.push(`${b}:${this.bufName[b]}:${this.bufLines[b]}:${this.bufCursor[b]}:${this.bufCol[b]}`);
    for (let s = this.bufHead[b]; s !== -1; s = this.lineNext[s])
      parts.push(`${s}:${strHash(this.lineText[s] ?? '')}`);
  }
  return fnv1a(Buffer.from(parts.join('|'), 'utf8')).toString(16);
};
EditorCore.prototype.snapshot = function () {
  const bufs = [];
  for (let b = 0; b < BUF_CAP; b++) {
    if (this.bufFlag[b] !== F_ALIVE) continue;
    const lines = [];
    for (let s = this.bufHead[b]; s !== -1; s = this.lineNext[s]) lines.push(this.lineText[s]);
    bufs.push({ name: this.bufName[b], path: this.bufPath[b], lines,
                cursorRow: rowOf(this, b, this.bufCursor[b]), col: this.bufCol[b],
                savedAt: this.bufSavedAt[b] });
  }
  return { active: this.activeBuf, bufs, hash: this.hash() };
};
function rowOf(core, buf, slot) {
  let i = 0;
  for (let s = core.bufHead[buf]; s !== -1; s = core.lineNext[s], i++) if (s === slot) return i;
  return -1;
}

export { F_FREE, F_ALIVE, LINE_CAP, BUF_CAP, HIT_CAP, SEARCH_BUDGET_LINES };
