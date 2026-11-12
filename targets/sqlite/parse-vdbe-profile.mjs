// Parser for SQLite VDBE profiling output (PRAGMA vdbe_profile / -DVDBE_PROFILE builds).
//
// Grammar (pinned from /tmp/opencode/prof-delete.out and prof-wal.out):
//   ---- <hex block hash>          variable length (28 and 32 hex chars observed)
//   [-- <SQL statement label>]     zero or more, immediately after the boundary
//   <cnt> <cycles> <self> <addr> <opcode> <p1> <p2> <p3> [<p4>] <flags> [comment]
//
// After p3, a token matching /^[0-9A-Fa-f]{2}$/ means p4 is absent (that token
// is the flags column). Otherwise the token is p4 and the next token is flags.
// Single-char p4 ('0', '3') is valid p4, not flags. Flags observed: 00, 01, 52.
// p4 observed: '0', '3', 'k(2,,)', 'BINARY-8'.
//
// Zero-execution duplicate blocks (same SQL re-prepared, all counts 0) are kept
// in the statement list but flagged with executed=false; aggregate() filters
// them out of per-opcode and per-statement totals.
//
// Pure functions: no input mutation, no shared state. Throws TypeError on bad
// input types. ESM, Node >= 18.

const BOUNDARY_RE = /^----\s+([0-9a-fA-F]+)\s*$/;
const SQL_LABEL_RE = /^--\s?(.*)$/;
const OP_ROW_RE =
  /^\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z][A-Za-z0-9]*)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*(.*)$/;

/**
 * Parse VDBE profiling text into statement blocks.
 * @param {string} text raw profiling output (e.g. vdbe_profile.out contents)
 */
export function parseVdbeProfile(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`parseVdbeProfile: expected string, got ${typeof text}`);
  }

  const statements = [];
  let current = null; // { hash, sqlLabels[], ops[] }

  const flush = () => {
    if (!current) return;
    const executed = current.ops.some((op) => op.cnt > 0);
    statements.push({
      hash: current.hash,
      sql: current.sqlLabels.length > 0 ? current.sqlLabels.join('\n') : null,
      ops: current.ops,
      executed,
    });
    current = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    const boundary = line.match(BOUNDARY_RE);
    if (boundary) {
      flush();
      current = { hash: boundary[1], sqlLabels: [], ops: [] };
      continue;
    }

    if (!current) continue; // preamble lines before the first boundary

    const label = line.match(SQL_LABEL_RE);
    if (label) {
      current.sqlLabels.push(label[1]);
      continue;
    }

    if (line.trim() === '') continue; // blank line inside a block

    const op = line.match(OP_ROW_RE);
    if (op) {
      // groups: 1=cnt 2=cycles 3=self 4=addr 5=opcode 6=p1 7=p2 8=p3 9=tail
      current.ops.push(parseOpRow(op[1], op[2], op[3], op[4], op[5], op[6], op[7], op[8], op[9]));
      continue;
    }
    // Unknown line inside a block: ignore (tolerant parsing; producer output
    // variants must not crash the whole parse).
  }

  flush();
  return statements;
}

/**
 * Build one op record from the raw fields and the post-p3 tail.
 * p1/p2/p3 come through as strings; convert to Numbers here.
 */
function parseOpRow(cnt, cycles, self, addr, opcode, p1, p2, p3, tail) {
  const tokens = tail.trim().split(/\s+/).filter((t) => t !== '');
  let p4 = null;
  let flags = '';
  let comment = '';

  if (tokens.length > 0 && /^[0-9A-Fa-f]{2}$/.test(tokens[0])) {
    // p4 absent; first token is the flags column
    flags = tokens[0];
    comment = tokens.slice(1).join(' ');
  } else if (tokens.length > 0) {
    p4 = tokens[0];
    if (tokens.length > 1) {
      flags = tokens[1];
      comment = tokens.slice(2).join(' ');
    }
  }

  return {
    cnt: Number(cnt),
    cycles: Number(cycles),
    self: Number(self),
    addr: Number(addr),
    opcode,
    p1: Number(p1),
    p2: Number(p2),
    p3: Number(p3),
    p4,
    comment,
  };
}

/**
 * Aggregate executed statement blocks.
 * @param {Array} statements output of parseVdbeProfile
 * @returns {{byOpcode: Record<string, {execs: number, cycles: number}>,
 *            executedStatements: number, totalStatements: number,
 *            byStatement: Array<{hash: string, sql: string|null, cycles: number}>}}
 */
export function aggregate(statements) {
  if (!Array.isArray(statements)) {
    throw new TypeError(`aggregate: expected array, got ${typeof statements}`);
  }

  const byOpcode = {};
  const byStatement = [];
  let executedStatements = 0;

  for (const stmt of statements) {
    if (stmt.executed !== true) continue; // zero-execution duplicates filtered
    executedStatements += 1;

    let totalCycles = 0;
    for (const op of stmt.ops) {
      totalCycles += op.cycles;
      const slot = byOpcode[op.opcode] ?? { execs: 0, cycles: 0 };
      slot.execs += op.cnt;
      slot.cycles += op.cycles;
      byOpcode[op.opcode] = slot;
    }
    byStatement.push({ hash: stmt.hash, sql: stmt.sql, cycles: totalCycles });
  }

  return { byOpcode, executedStatements, totalStatements: statements.length, byStatement };
}
