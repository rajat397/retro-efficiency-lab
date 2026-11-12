// QVM floor harness — runs the REAL ioquake3 interpreter/compiler against
// toolchain-assembled .qvm programs and reports cycles per call and per op.
//
// Build (interp):    gcc -O2 -I<code> qvm-bench.c vm.c vm_interpreted.c -o qvm-bench-interp
// Build (compiled):  gcc -O2 -DHAVE_VM_COMPILED -I<code> qvm-bench.c vm.c vm_interpreted.c vm_x86.c -o qvm-bench-compiled
//
// Usage: qvm-bench <module> <iterations> [opsPerIteration]
//   Loads vm/<module>.qvm from CWD, calls VM_Call(vm, 0) <iterations> times
//   (100 warmup first), prints avg/min/max cycles/call and cycles/op.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <stdint.h>

#include "q_shared.h"
#include "qcommon/qcommon.h"
#include "qcommon/vm_local.h"

/* ---------------- engine stubs (real engine functions are NOT linked) --- */

extern int benchVerbose;
void Com_Printf( const char *fmt, ... );	/* real one lives in bench-glue.c */

void Com_Error( int code, const char *fmt, ... ) {
	va_list ap;
	va_start( ap, fmt );
	vfprintf( stderr, fmt, ap );
	va_end( ap );
	fprintf( stderr, " [Com_Error code=%d]\n", code );
	exit( 2 );
}

int Com_sprintf( char *dest, int size, const char *fmt, ... ) {
	va_list ap;
	va_start( ap, fmt );
	int n = vsnprintf( dest, size, fmt, ap );
	va_end( ap );
	return n;
}

typedef struct fakeCvar_s {
	char	*string;
	char	*resetString;
	char	*latchedString;
	float	value;
	int		integer;
	int		flags;
	qboolean	modified;
	int		modificationCount;
} fakeCvar_t;

static fakeCvar_t fakeCvar = { "0", "0", "0", 0.0f, 0, 0, qfalse, 0 };

cvar_t *Cvar_Get( const char *name, const char *value, int flags ) {
	(void)name; (void)value; (void)flags;
	return (cvar_t *)&fakeCvar;
}

void Cmd_AddCommand( const char *name, void (*fn)( void ) ) { (void)name; (void)fn; }

static long fakeHunkRemaining = 512 << 20;

void *Hunk_Alloc( int size, ha_pref preference ) {
	(void)preference;
	void *p = calloc( 1, (size + 15) & ~15 );
	if ( !p ) { fprintf( stderr, "Hunk_Alloc OOM\n" ); exit( 2 ); }
	fakeHunkRemaining -= size;
	return p;
}

int Hunk_MemoryRemaining( void ) { return (int)fakeHunkRemaining; }

void *Hunk_AllocateTempMemory( int size ) { return malloc( size ); }
void Hunk_FreeTempMemory( void *buf ) { free( buf ); }

int FS_FindVM( void **startSearch, char *found, int foundlen, const char *name, int enableDll ) {
	(void)startSearch; (void)enableDll;
	snprintf( found, foundlen, "vm/%s.qvm", name );
	return VMI_COMPILED;
}

static long readWholeFile( const char *path, void **buffer ) {
	FILE *f = fopen( path, "rb" );
	if ( !f ) { *buffer = NULL; return -1; }
	fseek( f, 0, SEEK_END );
	long len = ftell( f );
	fseek( f, 0, SEEK_SET );
	char *p = malloc( len + 1 );
	if ( fread( p, 1, len, f ) != (size_t)len ) { fclose( f ); free( p ); *buffer = NULL; return -1; }
	fclose( f );
	p[len] = 0;
	*buffer = p;
	return len;
}

long FS_ReadFileDir( const char *qpath, void *searchPath, qboolean unpure, void **buffer ) {
	(void)searchPath; (void)unpure;
	return readWholeFile( qpath, buffer );
}

long FS_ReadFile( const char *qpath, void **buffer ) {
	return readWholeFile( qpath, buffer );
}

void FS_FreeFile( void *buffer ) { if ( buffer ) free( buffer ); }

qboolean FS_Which( const char *filename, void *searchPath ) {
	(void)filename; (void)searchPath;
	return qfalse;
}

void Q_strncpyz( char *dest, const char *src, int destsize ) {
	if ( !dest || !src || destsize < 1 ) return;
	strncpy( dest, src, destsize - 1 );
	dest[destsize - 1] = 0;
}

int Q_stricmp( const char *s1, const char *s2 ) {
	while ( *s1 && *s2 ) {
		int c1 = (unsigned char)tolower( (unsigned char)*s1++ );
		int c2 = (unsigned char)tolower( (unsigned char)*s2++ );
		if ( c1 != c2 ) return c1 - c2;
	}
	return (unsigned char)*s1 - (unsigned char)*s2;
}

void *QDECL Sys_LoadGameDll( const char *name, vmMainProc *entryPoint,
							 intptr_t (QDECL *systemcalls)( intptr_t, ... ) ) {
	(void)name; (void)entryPoint; (void)systemcalls;
	return NULL;
}

void Sys_UnloadDll( void *dllHandle ) { (void)dllHandle; }

/* float->int truncation; on x86-64 SSE2 this compiles to cvttss2si,
 * bit-identical to the engine's qftolsse asm */
long qftolsse( float f ) { return (long)f; }

/* vm_x86.c emits a call through this pointer into JIT'd code; our bench
 * programs are integer-only, so the body is irrelevant */
int qvmftolsse( void ) { return 0; }
int ( *Q_VMftol )( void ) = qvmftolsse;

/* common.c stand-ins (only used on paths we don't take) */
cvar_t com_developerDummy;
cvar_t *com_developer = &com_developerDummy;

void *Z_Malloc( int size ) { return calloc( 1, size ); }
void Z_Free( void *p ) { free( p ); }

void COM_StripExtension( const char *in, char *out, int destsize ) {
	int i;
	for ( i = 0; in[i] && i < destsize - 1; i++ ) {
		if ( in[i] == '.' ) break;
		out[i] = in[i];
	}
	out[i] = 0;
}

char *COM_Parse( char **data_p ) {
	(void)data_p;
	return NULL;
}

#ifndef QVM_BENCH_COMPILED
/* interpreter-only bench build: never called (we pass VMI_BYTECODE), but the
 * symbols are referenced from vm.c which was compiled with HAVE_VM_COMPILED */
void VM_Compile( vm_t *vm, vmHeader_t *header ) {
	(void)vm; (void)header;
	Com_Error( ERR_FATAL, "VM_Compile in interpreter-only build" );
}

int VM_CallCompiled( vm_t *vm, int *args ) {
	(void)vm; (void)args;
	Com_Error( ERR_FATAL, "VM_CallCompiled in interpreter-only build" );
	return 0;
}
#endif

/* ---------------- timing ------------------------------------------------ */

static inline unsigned long long rdtsc( void ) {
	unsigned int lo, hi;
	__asm__ __volatile__ ( "rdtsc" : "=a" (lo), "=d" (hi) );
	return ( (unsigned long long)hi << 32 ) | lo;
}

/* syscall side: counts traps, returns a fixed value */
static long long syscallCount = 0;

static intptr_t QDECL syscalls( intptr_t *parms ) {
	(void)parms;
	syscallCount++;
	return 42;
}

/* ---------------- main -------------------------------------------------- */

int main( int argc, char **argv ) {
	if ( argc < 3 ) {
		fprintf( stderr, "usage: %s <module> <iterations> [opsPerIteration] [callsPerIteration]\n", argv[0] );
		return 1;
	}
	const char *module;
	long iterations;
	if ( argc > 3 && argv[1][0] == '-' ) {	/* -v <module> <iterations> ... */
		benchVerbose = 1;
		module = argv[2];
		iterations = atol( argv[3] );
	} else {
		module = argv[1];
		iterations = atol( argv[2] );
	}
	double opsPerIteration = 0.0;

#ifdef QVM_BENCH_COMPILED
	vm_t *vm = VM_Create( module, syscalls, VMI_COMPILED );	/* vm_x86 JIT */
#else
	vm_t *vm = VM_Create( module, syscalls, VMI_BYTECODE );	/* interpreter */
#endif
	if ( !vm ) { fprintf( stderr, "VM_Create(%s) failed\n", module ); return 2; }

#ifdef HAVE_VM_COMPILED
	fprintf( stderr, "mode: compiled (vm_x86 JIT) compiled=%d\n", vm->compiled );
#else
	fprintf( stderr, "mode: interpreted, compiled=%d\n", vm->compiled );
#endif

	/* warmup */
	for ( long i = 0; i < 100; i++ ) {
		VM_Call( vm, 0, 0, 0, 0, 0 );
	}

	unsigned long long *samples = malloc( sizeof( unsigned long long ) * iterations );
	for ( long i = 0; i < iterations; i++ ) {
		unsigned long long t0 = rdtsc();
		VM_Call( vm, 0, 0, 0, 0, 0 );
		unsigned long long t1 = rdtsc();
		samples[i] = t1 - t0;
	}

	unsigned long long sum = 0, min = ~0ULL, max = 0;
	for ( long i = 0; i < iterations; i++ ) {
		sum += samples[i];
		if ( samples[i] < min ) min = samples[i];
		if ( samples[i] > max ) max = samples[i];
	}
	double avg = (double)sum / iterations;

	printf( "module=%s iterations=%ld avg=%.0f min=%llu max=%llu cycles/call",
			module, iterations, avg, (unsigned long long)min, (unsigned long long)max );
	if ( argc > 4 ) opsPerIteration = atof( argv[4] );
	if ( opsPerIteration > 0.0 ) {
		printf( " avg=%.2f min=%.2f cycles/op", avg / opsPerIteration, (double)min / opsPerIteration );
	}
	printf( "\n" );
	if ( syscallCount > 0 ) {
		printf( "syscalls=%lld\n", syscallCount );
	}
	free( samples );
	VM_Free( vm );
	return 0;
}
