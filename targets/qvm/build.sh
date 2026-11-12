#!/bin/sh
# Rebuild the QVM floor harness and test programs from scratch.
# Requires: gcc, the ioq3 source tree at /mnt/data/opt/ioq3 (HEAD 52088b9e).
set -e
cd "$(dirname "$0")"

IOQ3=/mnt/data/opt/ioq3
INC="-I$IOQ3/code -I$IOQ3/code/qcommon"
CFLAGS="-O2 -DNDEBUG -no-pie"

# 1. toolchain assembler (built once into ioq3/bld)
[ -x "$IOQ3/bld/q3asm" ] || gcc -O2 -o "$IOQ3/bld/q3asm" \
	"$IOQ3/code/tools/asm/q3asm.c" "$IOQ3/code/tools/asm/cmdlib.c"

# 2. assemble the test .qvm programs (q3asm reserves 64K bss for the stack)
for p in loop mul syscall; do
	"$IOQ3/bld/q3asm" -o "$p" programs/$p.as
	mv -f "$p.qvm" vm/
done

# 3. harness, interpreter mode and JIT mode
gcc $CFLAGS $INC qvm-bench.c bench-glue.c \
	"$IOQ3/code/qcommon/vm.c" "$IOQ3/code/qcommon/vm_interpreted.c" \
	-o qvm-bench-interp

gcc $CFLAGS -DQVM_BENCH_COMPILED $INC qvm-bench.c bench-glue.c \
	"$IOQ3/code/qcommon/vm.c" "$IOQ3/code/qcommon/vm_interpreted.c" \
	"$IOQ3/code/qcommon/vm_x86.c" -o qvm-bench-compiled

# 4. debug trace build (throwaway diagnosis; NOT for measurements)
gcc $CFLAGS -DDEBUG_VM $INC qvm-bench.c bench-glue.c \
	"$IOQ3/code/qcommon/vm.c" "$IOQ3/code/qcommon/vm_interpreted.c" \
	-o qvm-trace

echo "built: qvm-bench-interp qvm-bench-compiled qvm-trace + vm/{loop,mul,syscall}.qvm"
