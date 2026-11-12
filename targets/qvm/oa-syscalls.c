/* oa-syscalls.c — a real syscall layer for OpenArena gamecode running in the
 * qvm bench harness. Implements the cgame/qagame/ui traps needed to survive
 * INIT and a repeated DRAW_ACTIVE_FRAME loop, with plausible stub values.
 * Arg semantics copied from the engine reference (ioq3 cl_cgame.c):
 *   VMA(x) = vm->dataBase + (args[x] & dataMask), NULL if 0
 *   VMF(x) = *(float *)&args[x]
 *   FloatAsInt = union pun
 * Deterministic: no wall-clock reads, so both engine modes see identical
 * syscall counts. Unimplemented trap ids are logged once and answered 0. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <math.h>
#include <strings.h>

#include "q_shared.h"
#include "qcommon/qcommon.h"
#include "qcommon/vm_local.h"

extern vm_t *benchVM;
void oaSyscallReport( void );	/* set by qvm-bench after VM_Create */

/* ---- observability: per-trap histogram, unknown-trap log ---------------- */

#define MAXTRAP 256
volatile int oaCurrentTrap = -1;
long long oaTrapCount[MAXTRAP];
long long oaUnknownCount[MAXTRAP];


/* bounded, masked VM-string access: strings live inside dataBase, and an
 * unmasked walk (Q_strncpyz/strcmp) can run past the image end */
static const char *oaVMStr( intptr_t idx, char *buf, int bufSize ) {
	const char *base = (const char *)benchVM->dataBase;
	int off = (int)idx & benchVM->dataMask;
	int i;
	for ( i = 0; i < bufSize - 1; i++ ) {
		char c = base[ ( off + i ) & benchVM->dataMask ];
		buf[i] = c;
		if ( !c ) break;
	}
	buf[i < bufSize ? i : bufSize - 1] = 0;
	return buf;
}

static void oaVMCopy( intptr_t dstIdx, intptr_t srcIdx, int size ) {
	if ( !dstIdx || !srcIdx || size <= 0 ) return;
	char *dst = (char *)benchVM->dataBase + ( (int)dstIdx & benchVM->dataMask );
	const char *base = (const char *)benchVM->dataBase;
	int off = (int)srcIdx & benchVM->dataMask;
	for ( int i = 0; i < size; i++ ) {
		char c = base[ ( off + i ) & benchVM->dataMask ];
		dst[i] = c;
		if ( !c ) { dst[i] = 0; break; }
	}
}

static int oaVMEq( intptr_t idx, const char *name ) {
	char b[256];
	return strcmp( oaVMStr( idx, b, sizeof( b ) ), name ) == 0;
}

static void oaNCopy( char *dst, const char *src, int n );

/* canned model animation config: MAX_ANIMATIONS(47) x "firstFrame numFrames
 * loopingFrames fps" — enough for CG_ParseAnimationFile to succeed */
static const char oaAnimCfg[] =
#define A "0 1 0 10\n"
	A A A A A A A A A A A A A A A A A A A A A A A A
	A A A A A A A A A A A A A A A A A A A A A A A A;

/* ---- server configstrings the game expects (CS_* ids from OA bg_public.h) */
static const char *oaConfigStrings[64] = {
	[0] = "\\mapname\\oasw\\g_gametype\\0\\sv_maxclients\\16\\timelimit\\0\\fraglimit\\0"
		  "\\capturelimit\\0\\dmflags\\0\\videoflags\\0\\elimflags\\0\\teamflags\\0"
		  "\\elimination_roundtime\\0\\g_rockets\\0\\g_instantgib\\0\\g_elimination\\0"
		  "\\g_lms_mode\\0\\g_altExcellent\\0\\g_delagHitscan\\0\\voteflags\\63",
	[1] = "\\sv_cheats\\0\\sv_pure\\0\\g_syncronousClients\\0",
	[2] = "",	/* CS_MUSIC */
	[3] = "",	/* CS_MESSAGE */
	[20] = "baseoa-1",	/* CS_GAME_VERSION */
	[21] = "0",			/* CS_LEVEL_START_TIME */
};

/* ---- fake cvar storage --------------------------------------------------- */

#define MAXC 512
static char cvName[MAXC][64];
static char cvStr[MAXC][256];
static intptr_t cvPtr[MAXC];
static int cvN = 0;

static int cvFind( const char *name ) {
	for ( int i = 0; i < cvN; i++ ) if ( !strcmp( cvName[i], name ) ) return i;
	return -1;
}

static void oaVMWrite( intptr_t idx, const void *buf, int n );

static void fillVmCvar( intptr_t idx, const char *value ) {
	vmCvar_t c;
	memset( &c, 0, sizeof( c ) );
	oaNCopy( c.string, value, sizeof( c.string ) );
	c.value = (float)atof( c.string );
	c.integer = atoi( c.string );
	c.modificationCount = 1;
	oaVMWrite( idx, &c, sizeof( c ) );
}

/* glconfig_t copied verbatim from OpenArena gamecode renderer/tr_types.h
 * (the ABI the .qvm was built against; ioq3's moved elsewhere) */
typedef enum { GLDRV_ICD, GLDRV_STANDALONE, GLDRV_MINIDRIVER } glDriverType_t;
typedef enum { GLHW_GENERIC, GLHW_PERMEDIA2, GLHW_RIVA128, GLHW_RIVATNT,
	GLHW_VOODOO3, GLHW_G400, GLHW_ATI_RAGE128, GLHW_ATI_RADEON } glHardwareType_t;
typedef enum { TC_NONE, TC_S3TC } textureCompression_t;

typedef struct {
	char					renderer_string[MAX_STRING_CHARS];
	char					vendor_string[MAX_STRING_CHARS];
	char					version_string[MAX_STRING_CHARS];
	char					extensions_string[BIG_INFO_STRING];

	int						maxTextureSize;
	int						numTextureUnits;

	int						colorBits, depthBits, stencilBits;

	glDriverType_t			driverType;
	glHardwareType_t		hardwareType;

	qboolean				deviceSupportsGamma;
	textureCompression_t	textureCompression;
	qboolean				textureEnvAddAvailable;

	int						vidWidth, vidHeight;
	float					windowAspect;
	int						displayFrequency;
	qboolean				isFullscreen;
	qboolean				stereoEnabled;
	qboolean				smpActive;
} glconfig_t;

/* gameState_t, OpenArena bg_public.h layout */
#define MAX_CONFIGSTRINGS	1024
#define MAX_GAMESTATE_CHARS	16000
typedef struct {
	int		stringOffsets[MAX_CONFIGSTRINGS];
	char	stringData[MAX_GAMESTATE_CHARS];
	int		dataCount;
} oaGameState_t;

/* ---- pointer translation (engine-identical) ------------------------------ */

static void *OAVMA( intptr_t idx ) {
	if ( !idx ) return NULL;
	return (void *)( benchVM->dataBase + ( (int)idx & benchVM->dataMask ) );
}
static float OAVMF( intptr_t idx ) {
	float f;
	memcpy( &f, &idx, 4 );
	return f;
}
/* wrapping VM write: emulates VM addressing (a region can wrap past the
 * dataMask boundary); raw pointer writes would overrun the image */
static void oaVMWrite( intptr_t idx, const void *buf, int n ) {
	if ( !idx || !buf || n <= 0 || !benchVM ) return;
	char *base = (char *)benchVM->dataBase;
	int off = (int)idx & benchVM->dataMask;
	const char *b = (const char *)buf;
	for ( int i = 0; i < n; i++ ) base[ ( off + i ) & benchVM->dataMask ] = b[i];
}

/* validated copy used by all stub internals: reports bad src/size instead of
 * trusting them (a size<=0 in Q_strncpyz becomes strncpy(dst,src,SIZE_MAX)) */
static void oaNCopy( char *dst, const char *src, int n ) {
	if ( n <= 0 || (uintptr_t)src < 4096 || !dst ) {
		fprintf( stderr, "oaNCopy REJECT dst=%p src=%p n=%d (trap %d)\n",
				 (void *)dst, (const void *)src, n, oaCurrentTrap );
		return;
	}
	int i;
	for ( i = 0; i < n - 1 && src[i]; i++ ) dst[i] = src[i];
	dst[i] = 0;
}

static int FloatAsInt( float f ) {
	floatint_t fi;
	fi.f = f;
	return fi.i;
}

/* ---- state the stub engine pretends to have ------------------------------ */

static unsigned int msClock = 100000;	/* deterministic, advances per call */
static unsigned int rHandles = 1000;
static unsigned int fsHandles = 100;

#define COUNT(x) ( (x) >= 0 && (x) < MAXTRAP ? oaTrapCount[(x)]++ : 0 )

intptr_t oaSyscall( intptr_t *parms ) {
	/* parms[0] = positive enum id from cg_public.h (VM writes -1 - r0) */
	int id = (int)parms[0];
	oaCurrentTrap = id;
	if ( id < 0 || id >= MAXTRAP ) { return 0; }
	COUNT( id );
	

	switch ( id ) {
	case 0: return 0;						/* PRINT */
	case 1: {								/* ERROR — fatal, show it */
		char eb[256]; oaVMStr( parms[1], eb, sizeof( eb ) );
		fprintf( stderr, "trap_Error: %s\n", eb );
		oaSyscallReport();
		exit( 3 );
	}
	case 2: return (int)( msClock += 8 );	/* MILLISECONDS, deterministic */
	case 3: {								/* CVAR_REGISTER */
		char nameB[64], defB[256];
		oaVMStr( parms[2], nameB, sizeof( nameB ) );
		oaVMStr( parms[3], defB, sizeof( defB ) );
		int i = cvFind( nameB );
		if ( i < 0 && cvN < MAXC ) { i = cvN++; oaNCopy( cvName[i], nameB, sizeof( cvName[0] ) ); }
		if ( i >= 0 ) { cvPtr[i] = parms[1]; oaNCopy( cvStr[i], defB, sizeof( cvStr[0] ) ); }
		if ( parms[1] ) fillVmCvar( parms[1], defB );
		return 0;
	}
	case 4: {								/* CVAR_UPDATE — find by vmCvar pointer */
		vmCvar_t *c = (vmCvar_t *)OAVMA( parms[1] );
		const char *v = NULL;
		for ( int i = 0; i < cvN; i++ ) if ( cvPtr[i] == parms[1] ) { v = cvStr[i]; break; }
		fillVmCvar( parms[1], v ? v : "" );
		return 0;
	}
	case 5: {								/* CVAR_SET */
		char nameB[64], valB[256];
		oaVMStr( parms[1], nameB, sizeof( nameB ) );
		oaVMStr( parms[2], valB, sizeof( valB ) );
		int i = cvFind( nameB );
		if ( i < 0 && cvN < MAXC ) { i = cvN++; oaNCopy( cvName[i], nameB, sizeof( cvName[0] ) ); }
		if ( i >= 0 ) {
			oaNCopy( cvStr[i], valB, sizeof( cvStr[0] ) );
			if ( cvPtr[i] ) fillVmCvar( cvPtr[i], valB );
		}
		return 0;
	}
	case 6: {								/* CVAR_VARIABLESTRINGBUFFER */
		char nameB[64];
		oaVMStr( parms[1], nameB, sizeof( nameB ) );
		int i = cvFind( nameB );
		const char *v = ( i >= 0 ) ? cvStr[i] : "";
		{
			char tmp[256];
			oaNCopy( tmp, v, sizeof( tmp ) );
			oaVMWrite( parms[2], tmp, (int)parms[3] > 256 ? 256 : (int)parms[3] );
		}
		return 0;
	}
	case 7: return 0;						/* ARGC */
	case 8: case 9:						/* ARGV / ARGS: empty */
		if ( OAVMA( parms[2] ) ) *(char *)OAVMA( parms[2] ) = 0;
		return 0;
	case 10: {								/* FS_FOPENFILE: fake "file exists" */
		char nb[128];
		oaVMStr( parms[1], nb, sizeof( nb ) );
		int len = strstr( nb, "animation" ) && strstr( nb, ".cfg" )
				  ? (int)strlen( oaAnimCfg ) : 1;
		if ( parms[2] ) { int fh = ++fsHandles; oaVMWrite( parms[2], &fh, 4 ); }
		return len;
	}
	case 11: {								/* FS_READ - canned cfg content */
		int n = (int)parms[2];
		if ( n > (int)sizeof( oaAnimCfg ) ) n = sizeof( oaAnimCfg );
		oaVMWrite( parms[1], oaAnimCfg, n );
		return n;
	}
	case 12: return 0;						/* FS_WRITE */
	case 13: return 0;						/* FS_FCLOSEFILE */
	case 14: case 15: case 16: return 0;	/* console/client commands */
	case 17: return 0;						/* UPDATESCREEN */
	case 18: return 0;						/* CM_LOADMAP (checksum 0) */
	case 19: return 0;						/* CM_NUMINLINEMODELS */
	case 20: case 21: case 22: case 82: return ++rHandles;	/* model handles */
	case 23: case 24: case 86: return 0;	/* POINTCONTENTS / entity token */
	case 25: case 26: case 83: case 84: {	/* BOXTRACE family: no hit */
		/* trace_t: allsolid, startsolid, fraction, endpos[3], plane[4],
		 * surfaceFlags, contents, entityNum */
		int t[12];
		memset( t, 0, sizeof( t ) );
		float fraction = 1.0f;
		memcpy( &t[2], &fraction, 4 );
		t[11] = 1023;					/* ENTITYNUM_NONE */
		oaVMWrite( parms[1], t, sizeof( t ) );
		return 0;
	}
	case 27: case 87: return 0;				/* MARKFRAGMENTS / ADDPOLYS */
	case 28: case 29: case 30: case 31: case 32:
	case 33: case 34: case 35: case 69: case 80: case 81: return 0;	/* S_* */
	case 36: return 0;						/* R_LOADWORLDMAP */
	case 37: case 38: case 39: case 57: case 59: {
		return ++rHandles;
	}
	case 40: return 0;						/* R_CLEARSCENE */
	case 41: case 42: case 43: case 85: return 0;					/* add ents/lights */
	case 44: return 0;						/* R_RENDERSCENE */
	case 45: case 46: return 0;				/* SetColor / DrawStretchPic */
	case 47:								/* R_MODELBOUNDS: zeros */
		static const int zeros3[3];
		oaVMWrite( parms[2], zeros3, sizeof( zeros3 ) );
		oaVMWrite( parms[3], zeros3, sizeof( zeros3 ) );
		return 0;
	case 48: return 0;						/* R_LERPTAG */
	case 49: {								/* GETGLCONFIG */
		glconfig_t g;
		memset( &g, 0, sizeof( g ) );
		g.vidWidth = 640; g.vidHeight = 480;
		g.maxTextureSize = 2048;
		g.windowAspect = 4.0f / 3.0f;
		g.displayFrequency = 60;
		oaVMWrite( parms[1], &g, sizeof( g ) );
		return 0;
	}
	case 50: {								/* GETGAMESTATE: built configstrings */
		oaGameState_t gs;
		memset( &gs, 0, sizeof( gs ) );
		for ( int i = 0; i < 64 && i < MAX_CONFIGSTRINGS; i++ ) {
			if ( !oaConfigStrings[i] || !oaConfigStrings[i][0] ) continue;
			int n = strlen( oaConfigStrings[i] );
			if ( n > 1023 ) n = 1023;
			gs.stringOffsets[i] = gs.dataCount;
			memcpy( gs.stringData + gs.dataCount, oaConfigStrings[i], n + 1 );
			gs.dataCount += n + 1;
		}
		oaVMWrite( parms[1], &gs, sizeof( gs ) );
		return 0;
	}
	case 51: {								/* GETCURRENTSNAPSHOTNUMBER: zero */
		int *n = (int *)OAVMA( parms[1] );
		int *t = (int *)OAVMA( parms[2] );
		if ( n ) *n = 0;
		if ( t ) *t = 0;
		return 0;
	}
	case 52: return 0;						/* GETSNAPSHOT: none */
	case 53: return 0;						/* GETSERVERCOMMAND: none */
	case 54: return 0;						/* GETCURRENTCMDNUMBER */
	case 55: return 0;						/* GETUSERCMD: none */
	case 56: case 61: case 71: return 0;	/* SETUSERCMDVALUE / catcher / snap */
	case 58: return 8 << 20;				/* MEMORY_REMAINING */
	case 60: case 62: case 63: return 0;	/* KEY_* */
	case 64: case 65: case 66: case 68: return 0;					/* PC_* */
	case 67: return 0;						/* PC_READTOKEN: no token */
	case 70: return 0;						/* REAL_TIME */
	case 73: return 0;						/* R_LIGHTFORPOINT */
	case 74: case 75: case 76: case 77: case 78: return 0;			/* CIN_* */
	case 88: return 0;						/* R_inPVS */
	case 100: {								/* MEMSET — wrap-safe */
		char *base = (char *)benchVM->dataBase;
		int off = (int)parms[1] & benchVM->dataMask;
		int n = (int)parms[3];
		for ( int i = 0; i < n; i++ ) base[ ( off + i ) & benchVM->dataMask ] = (char)(int)parms[2];
		return 0;
	}
	case 101: {								/* MEMCPY — wrap-safe */
		char *base = (char *)benchVM->dataBase;
		int o1 = (int)parms[1] & benchVM->dataMask;
		int o2 = (int)parms[2] & benchVM->dataMask;
		int n = (int)parms[3];
		for ( int i = 0; i < n; i++ ) base[ ( o1 + i ) & benchVM->dataMask ] = base[ ( o2 + i ) & benchVM->dataMask ];
		return 0;
	}
	case 102:								/* STRNCPY */
		oaVMCopy( parms[1], parms[2], (int)parms[3] );
		return (int)parms[1];
	case 103: return FloatAsInt( sinf( OAVMF( parms[1] ) ) );
	case 104: return FloatAsInt( cosf( OAVMF( parms[1] ) ) );
	case 105: return FloatAsInt( atan2f( OAVMF( parms[1] ), OAVMF( parms[2] ) ) );
	case 106: return FloatAsInt( sqrtf( OAVMF( parms[1] ) ) );
	case 107: return FloatAsInt( floorf( OAVMF( parms[1] ) ) );
	case 108: return FloatAsInt( ceilf( OAVMF( parms[1] ) ) );
	case 109: case 110: case 111: return 0;	/* testPrint/acos */
	default:
		oaUnknownCount[id < MAXTRAP ? id : 0]++;
		return 0;
	}
}

void oaSyscallReport( void ) {
	long long total = 0, unknown = 0;
	for ( int i = 0; i < MAXTRAP; i++ ) total += oaTrapCount[i];
	for ( int i = 0; i < MAXTRAP; i++ ) unknown += oaUnknownCount[i];
	fprintf( stderr, "oa-syscalls: total=%lld unknown=%lld\n", total, unknown );
	for ( int i = 0; i < MAXTRAP; i++ ) {
		if ( oaTrapCount[i] > 0 ) fprintf( stderr, "  trap %d: %lld\n", i, oaTrapCount[i] );
	}
	for ( int i = 0; i < MAXTRAP; i++ ) {
		if ( oaUnknownCount[i] > 0 ) fprintf( stderr, "  UNKNOWN trap %d: %lld\n", i, oaUnknownCount[i] );
	}
}
