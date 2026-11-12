// TDD test for targets/sqlite/parse-vdbe-profile.mjs
// Run: node targets/sqlite/parse-vdbe-profile.test.mjs
// Exits 0 on pass, 1 on failure. No test framework (repo convention: standalone .mjs).
import assert from 'node:assert/strict';
import { parseVdbeProfile, aggregate } from './parse-vdbe-profile.mjs';

const FIXTURE = [
  '---- 08be71235f365f5f5f5f552747024a09',
  '      1          182      182    0 Init             1   12    0               00 Start at 12',
  '      1          572      572    1 OpenRead         0    2    0 3             00 root=2 iDb=0; t1',
  '      1        18902    18902    2 SeekGE           1   11    1 1             00 key=r[1]',
  '     93       740168     7958    3 Column           0    1    3               00 r[3]= cursor 0 column 1',
  '      2         4472     2236    4 Eq               2   12    1 BINARY-8      52 if r[1]==r[2] goto 12',
  '      1        50154    50154    5 Transaction      0    0    2 0             01 usesStmtJournal=0',
  '      1          104      104    6 Goto             0    1    0               00 ',
  '---- 0871714817482d8f5f5527470209',
  '-- SELECT val FROM t1 WHERE n=42 AND id<9000;',
  '      0            0        0    0 Init             1   12    0               00 Start at 12',
  '      0            0        0    1 OpenRead         0    2    0 3             00 root=2 iDb=0; t1',
  '---- aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '-- SELECT count(*) FROM sqlite_schema;',
  '      1          442      442   12 Transaction      0    0    2 0             00 usesStmtJournal=0',
].join('\n');

// --- parseVdbeProfile ---
const statements = parseVdbeProfile(FIXTURE);
assert.equal(statements.length, 3, 'expected 3 blocks');

// Block 1: no SQL label, ops with p4 omitted and present, non-00 flags
const b1 = statements[0];
assert.equal(b1.hash, '08be71235f365f5f5f5f552747024a09');
assert.equal(b1.sql, null);
assert.equal(b1.ops.length, 7);
assert.equal(b1.executed, true);
const init = b1.ops[0];
assert.equal(init.opcode, 'Init');
assert.equal(init.cnt, 1);
assert.equal(init.cycles, 182);
assert.equal(init.self, 182);
assert.equal(init.addr, 0);
assert.equal(init.p1, 1);
assert.equal(init.p2, 12);
assert.equal(init.p3, 0);
assert.equal(init.p4, null);
assert.equal(init.comment, 'Start at 12');
const openread = b1.ops[1];
assert.equal(openread.p4, '3');
assert.equal(openread.comment, 'root=2 iDb=0; t1');
const eq = b1.ops[4];
assert.equal(eq.opcode, 'Eq');
assert.equal(eq.p4, 'BINARY-8');
assert.equal(eq.comment, 'if r[1]==r[2] goto 12');
const tx = b1.ops[5];
assert.equal(tx.opcode, 'Transaction');
assert.equal(tx.p4, '0');
assert.equal(tx.comment, 'usesStmtJournal=0');
// empty comment stays empty, not undefined
assert.equal(b1.ops[6].comment, '');

// Block 2: SQL label + zero-execution duplicate
const b2 = statements[1];
assert.equal(b2.hash, '0871714817482d8f5f5527470209');
assert.equal(b2.sql, 'SELECT val FROM t1 WHERE n=42 AND id<9000;');
assert.equal(b2.executed, false, 'zero-count block must be marked not executed');

// Block 3: multi-line? single -- line label
const b3 = statements[2];
assert.equal(b3.sql, 'SELECT count(*) FROM sqlite_schema;');
assert.equal(b3.ops.length, 1);
assert.equal(b3.ops[0].opcode, 'Transaction');

// --- aggregate: only executed blocks, per-opcode totals ---
const agg = aggregate(statements);
// Init appears only in executed block b1
assert.equal(agg.byOpcode.Init.execs, 1);
assert.equal(agg.byOpcode.Init.cycles, 182);
// Column only in b1
assert.equal(agg.byOpcode.Column.execs, 93);
assert.equal(agg.byOpcode.Column.cycles, 740168);
// Transaction appears in b1 + b3 (b2 filtered out)
assert.equal(agg.byOpcode.Transaction.execs, 2);
assert.equal(agg.byOpcode.Transaction.cycles, 50154 + 442);
// per-statement stats over executed blocks only
assert.equal(agg.executedStatements, 2);
assert.equal(agg.totalStatements, 3);
// b1 statement cycles = sum of its op cycles
const b1Sum = 182 + 572 + 18902 + 740168 + 4472 + 50154 + 104;
assert.ok(agg.byStatement.some(s => s.hash === b1.hash && s.cycles === b1Sum));

// --- target selection helper ---
assert.equal(
  statements.filter(s => s.executed && /FROM t1 WHERE n=42/.test(s.sql ?? '')).length,
  0,
  'fixture zero-exec target block must be excluded',
);

console.log('parse-vdbe-profile.test.mjs: all assertions passed');
