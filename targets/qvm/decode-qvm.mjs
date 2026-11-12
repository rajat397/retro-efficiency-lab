// Static decoder for real .qvm files (VER1 and VER2 headers).
// Usage: node targets/qvm/decode-qvm.mjs <file.qvm> [file2.qvm ...]
// Prints header fields, segment sizes, and the opcode histogram.

import { readFileSync } from 'node:fs';

const VM_MAGIC = 0x12721445;
const VM_MAGIC_VER2 = 0x12721472;

// opcode names, exact order of the ioq3 vm_local.h enum (0..59)
const OPNAMES = [
  'UNDEF', 'IGNORE', 'BREAK', 'ENTER', 'LEAVE', 'CALL', 'PUSH', 'POP',
  'CONST', 'LOCAL', 'JUMP', 'EQ', 'NE', 'LTI', 'LEI', 'GTI', 'GEI',
  'LTU', 'LEU', 'GTU', 'GEU', 'EQF', 'NEF', 'LTF', 'LEF', 'GTF', 'GEF',
  'LOAD1', 'LOAD2', 'LOAD4', 'STORE1', 'STORE2', 'STORE4', 'ARG',
  'BLOCK_COPY', 'SEX8', 'SEX16', 'NEGI', 'ADD', 'SUB', 'DIVI', 'DIVU',
  'MODI', 'MODU', 'MULI', 'MULU', 'BAND', 'BOR', 'BXOR', 'BCOM', 'LSH',
  'RSHI', 'RSHU', 'NEGF', 'ADDF', 'SUBF', 'DIVF', 'MULF', 'CVIF', 'CVFI',
];

// 4-byte-operand opcodes, exactly the VM_PrepareInterpreter switch.
// NOT JUMP (target comes off the stack: CONST $label; JUMPV) and NOT 40
// (that is DIVI — the old hand-numbered table had BLOCK_COPY there).
const FOURBYTE_OPS = [
  3, 4, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 34,
];

function opSize(op) {
  if (FOURBYTE_OPS.includes(op)) return 5;
  if (op === 33) return 2; // ARG
  return 1;
}

function decode(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  let h;
  if (magic === VM_MAGIC_VER2) {
    h = {
      version: 'VER2',
      instructionCount: buf.readUInt32LE(4),
      codeOffset: buf.readUInt32LE(8),
      codeLength: buf.readUInt32LE(12),
      dataOffset: buf.readUInt32LE(16),
      dataLength: buf.readUInt32LE(20),
      litOffset: buf.readUInt32LE(24),
      litLength: buf.readUInt32LE(28),
      bssLength: buf.readUInt32LE(32),
      jumpTableOffset: buf.readUInt32LE(36),
      jumpTableTargetsCount: buf.readUInt32LE(40),
    };
  } else if (magic === VM_MAGIC) {
    h = {
      version: 'VER1',
      instructionCount: buf.readUInt32LE(4),
      codeOffset: buf.readUInt32LE(8),
      codeLength: buf.readUInt32LE(12),
      dataOffset: buf.readUInt32LE(16),
      dataLength: buf.readUInt32LE(20),
      litOffset: buf.readUInt32LE(24),
      litLength: buf.readUInt32LE(28),
      bssLength: buf.readUInt32LE(32),
    };
  } else {
    throw new Error(`${path}: bad magic 0x${magic.toString(16)}`);
  }

  console.log(`=== ${path} (${h.version}, ${buf.length} bytes) ===`);
  for (const [k, v] of Object.entries(h)) {
    if (k === 'version') continue;
    console.log(`  ${k.padEnd(22)} ${v}`);
  }
  const segTotal = h.dataLength + h.litLength + h.bssLength;
  console.log(`  data+lit+bss          ${segTotal} (loader rounds to ${2 ** Math.ceil(Math.log2(Math.max(segTotal, 1)))})`);
  console.log(`  header check: code ${h.codeOffset}+${h.codeLength}=${h.codeOffset + h.codeLength} vs dataOffset=${h.dataOffset}`);

  // opcode histogram by walking the code segment
  const hist = new Array(256).fill(0);
  let pc = 0;
  while (pc < h.codeLength) {
    const remaining = h.codeLength - pc;
    // q3asm pads the code segment to 4 bytes with 0x00 — a tail of <5
    // all-zero bytes can't be an instruction (even LEAVE 0 = 04 00 00 00 00)
    if (remaining < 5 && buf[h.codeOffset + pc] === 0) break;
    const op = buf[h.codeOffset + pc];
    hist[op]++;
    pc += opSize(op);
  }
  let pad = h.codeLength - pc;
  console.log(`  trailing 0x00 pad: ${pad} byte(s)`);
  console.log(`  code walk: ${pc}/${h.codeLength} bytes covered`);
  const total = hist.reduce((a, b) => a + b, 0);
  console.log(`  instructions (decoded): ${total} vs header instructionCount=${h.instructionCount} ${total === h.instructionCount ? 'MATCH' : 'MISMATCH'}`);
  const ranked = hist
    .map((n, op) => [n, op])
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 20);
  for (const [n, op] of ranked) {
    console.log(`    ${String(op).padStart(3)} ${OPNAMES[op] ?? `OP${op}`.padEnd(7)} ${String(n).padStart(8)}  ${(100 * n / total).toFixed(1)}%`);
  }
  console.log(`  distinct opcodes: ${hist.filter((n) => n > 0).length}/61`);
  console.log('');
}

for (const p of process.argv.slice(2)) decode(p);
