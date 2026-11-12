/* bench glue: verbose Com_Printf, shared with qvm-bench.c (declares extern int benchVerbose) */
#include <stdio.h>
#include <stdarg.h>

int benchVerbose = 0;

void Com_Printf( const char *fmt, ... ) {
	if ( !benchVerbose ) return;
	va_list a;
	va_start( a, fmt );
	vfprintf( stderr, fmt, a );
	va_end( a );
}

/* DEBUG_VM's DEBUGSTR macro uses va() from common.c */
static char va_buf[4][8192];
static int va_idx = 0;

char *va( const char *format, ... ) {
	va_list a;
	char *p = va_buf[va_idx];
	va_idx = ( va_idx + 1 ) & 3;
	va_start( a, format );
	vsnprintf( p, sizeof( va_buf[0] ), format, a );
	va_end( a );
	return p;
}

/* dbg-copy instrumentation state */
unsigned long long dbgOpCount = 0;
int dbgDump = 1;
