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

/* ---- snapshot / renderer front-end state --------------------------------- */
/* structs copied verbatim from OpenArena headers (tr_types.h, q_shared.h) */

typedef struct {
	trType_t	trType;
	int			trTime;
	int			trDuration;
	vec3_t		trBase;
	vec3_t		trDelta;
} oaTrajectory_t;

#define OA_MAX_SNAP_ENTITIES	256
#define OA_SNAP_ENTITIES		16						/* entities per snapshot (small skirmish) */
typedef struct {
	int				snapFlags;
	int				ping;
	int				serverTime;
	byte			areamask[MAX_MAP_AREA_BYTES];
	playerState_t	ps;
	int				numEntities;
	entityState_t	entities[OA_MAX_SNAP_ENTITIES];
	int				numServerCommands;
	int				serverCommandSequence;
} oaSnapshot_t;

typedef struct {
	vec3_t		xyz;
	float		st[2];
	byte		modulate[4];
} oaPolyVert_t;

typedef enum {
	OA_RT_MODEL, OA_RT_POLY, OA_RT_SPRITE, OA_RT_BEAM, OA_RT_RAIL_CORE,
	OA_RT_RAIL_RINGS, OA_RT_LIGHTNING, OA_RT_PORTALSURFACE,
	OA_RT_MAX
} oaRefEntityType_t;

typedef struct {
	oaRefEntityType_t	reType;
	int			renderfx;
	qhandle_t	hModel;
	vec3_t		lightingOrigin;
	float		shadowPlane;
	vec3_t		axis[3];
	qboolean	nonNormalizedAxes;
	float		origin[3];
	int			frame;
	float		oldorigin[3];
	int			oldframe;
	float		backlerp;
	int			skinNum;
	qhandle_t	customSkin;
	qhandle_t	customShader;
	byte		shaderRGBA[4];
	float		shaderTexCoord[2];
	float		shaderTime;
	float		radius;
	float		rotation;
	vec3_t		eyepos[2];
	vec3_t		eyelook;
	int			glow;
	int			glowcol;
} oaRefEntity_t;

typedef struct {
	int			x, y, width, height;
	float		fov_x, fov_y;
	vec3_t		vieworg;
	vec3_t		viewaxis[3];
	int			time;
	int			rdflags;
	byte		areamask[MAX_MAP_AREA_BYTES];
	char		text[8][32];
} oaRefdef_t;

#define OA_MAX_SCENE_ENTS	256

static int oaSnapNum = 0;
static int oaSceneCount = 0;
static int oaSceneLights = 0;
static int oaScenePolys = 0;
static int oaDraws = 0;
static int oaSceneEntTotal = 0;		/* running entity-add count (work metric) */
static double oaSceneWork = 0.0;	/* keeps front-end emulation from optimizing away */

static oaRefEntity_t oaScene[OA_MAX_SCENE_ENTS];

static void oaVMRead( void *dst, intptr_t idx, int n ) {
	if ( !idx || !benchVM || n <= 0 ) return;
	const char *base = (const char *)benchVM->dataBase;
	int off = (int)idx & benchVM->dataMask;
	char *d = (char *)dst;
	for ( int i = 0; i < n; i++ ) d[i] = base[ ( off + i ) & benchVM->dataMask ];
}

/* masked VM string read is already oaVMStr */
static void oaBuildSnapshot( int k, oaSnapshot_t *snap ) {
	memset( snap, 0, sizeof( *snap ) );
	snap->snapFlags = 0;				/* active, not delayed */
	snap->ping = 10;
	snap->serverTime = k * 50 + 1000;
	snap->numServerCommands = 0;
	snap->serverCommandSequence = 0;
	playerState_t *ps = &snap->ps;
	ps->commandTime = snap->serverTime;
	ps->pm_type = 0;					/* PM_NORMAL */
	ps->bobCycle = ( k * 11 ) & 255;
	ps->clientNum = 0;
	ps->weapon = 2;						/* machinegun */
	ps->stats[0] = 100;					/* STAT_HEALTH */
	ps->stats[2] = 100;					/* STAT_ARMOR */
	ps->stats[12] = 100;				/* STAT_MAX_HEALTH */
	ps->groundEntityNum = 1022;			/* ENTITYNUM_WORLD */
	ps->origin[0] = 0.0f; ps->origin[1] = 300.0f; ps->origin[2] = 16.0f;
	ps->viewangles[0] = 0.0f; ps->viewangles[1] = ( k * 5.7f ); ps->viewangles[2] = 0.0f;
	ps->speed = 200;

	snap->numEntities = OA_SNAP_ENTITIES;
	for ( int i = 0; i < OA_SNAP_ENTITIES; i++ ) {
		entityState_t *es = &snap->entities[i];
		es->number = i;
		es->eType = ( i == 0 ) ? 1 : 2;	/* ET_PLAYER / ET_ITEM */
		es->clientNum = i % 16;
		es->modelindex = i;				/* items: bg_itemlist[1..] */
		es->solid = 2;
		es->pos.trType = 0;				/* TR_STATIONARY */
		es->pos.trBase[0] = ( i * 40.0f ) - 300.0f;
		es->pos.trBase[1] = ( ( i * 73 ) % 600 ) - 300.0f;
		es->pos.trBase[2] = 16.0f;
		if ( i > 0 ) es->pos.trBase[2] += (float)( ( k * 7 + i * 13 ) % 40 );
		es->apos.trType = 0;
	}
}

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
	case 27: return 0;							/* MARKFRAGMENTS */
	case 28: case 29: case 30: case 31: case 32:
	case 33: case 34: case 35: case 69: case 80: case 81: return 0;	/* S_* */
	case 36: return 0;						/* R_LOADWORLDMAP */
	case 37: case 38: case 39: case 57: case 59: {
		return ++rHandles;
	}
	case 40: oaSceneCount = 0; oaSceneLights = 0; oaScenePolys = 0; return 0;	/* R_CLEARSCENE */
	case 41: {								/* R_ADDREFENTITYTOSCENE: copy into the scene list */
		oaRefEntity_t re;
		oaVMRead( &re, parms[1], sizeof( re ) );
		if ( re.reType < 0 || re.reType >= OA_RT_MAX ) return 0;
		if ( oaSceneCount < OA_MAX_SCENE_ENTS ) {
			oaScene[oaSceneCount++] = re;
			oaSceneEntTotal++;
		}
		return 0;
	}
	case 42: {								/* R_ADDPOLYTOSCENE: read verts, count */
		int numVerts = (int)parms[2];
		if ( numVerts > 0 && numVerts <= 40 && parms[3] ) {
			oaPolyVert_t verts[40];
			oaVMRead( verts, parms[3], numVerts * sizeof( oaPolyVert_t ) );
			for ( int v = 0; v < numVerts; v++ ) if ( isfinite( verts[v].xyz[0] ) ) oaSceneWork += verts[v].xyz[0] * 0.001;
			oaScenePolys++;
		}
		return 0;
	}
	case 43: case 85: oaSceneLights++; return 0;	/* lights */
	case 44: {								/* R_RENDERSCENE: front-end emulation */
		oaRefdef_t rd;
		oaVMRead( &rd, parms[1], sizeof( rd ) );
		float depth[OA_MAX_SCENE_ENTS];
		for ( int i = 0; i < oaSceneCount; i++ ) {
			float dx = oaScene[i].origin[0] - rd.vieworg[0];
			float dy = oaScene[i].origin[1] - rd.vieworg[1];
			float dz = oaScene[i].origin[2] - rd.vieworg[2];
			depth[i] = dx * dx + dy * dy + dz * dz;
			if ( isfinite( depth[i] ) ) oaSceneWork += depth[i] * 1e-9;
		}
		int idx[OA_MAX_SCENE_ENTS];
		for ( int i = 0; i < oaSceneCount; i++ ) idx[i] = i;
		for ( int i = 1; i < oaSceneCount; i++ ) {	/* depth sort, back to front */
			int v = idx[i], j = i - 1;
			while ( j >= 0 && depth[idx[j]] < depth[v] ) { idx[j + 1] = idx[j]; j--; }
			idx[j + 1] = v;
		}
		oaDraws += oaSceneCount;
		oaSceneCount = 0;
		return 0;
	}
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
		for ( int i = 0; i < MAX_CONFIGSTRINGS; i++ ) {
			const char *str = NULL;
			if ( i < 64 ) str = oaConfigStrings[i];
			else if ( i >= 544 && i < 544 + 16 ) {	/* CS_PLAYERS */
				static char playerStr[16][160];
				int c = i - 544;
				if ( !playerStr[c][0] ) {
					snprintf( playerStr[c], sizeof( playerStr[0] ),
							  "\\name\\Player%d\\model\\sarge\\headmodel\\sarge\\team\\default\\skin\\default", c );
				}
				str = playerStr[c];
			}
			if ( !str || !str[0] ) continue;
			int n = strlen( str );
			if ( n > 1023 ) n = 1023;
			gs.stringOffsets[i] = gs.dataCount;
			memcpy( gs.stringData + gs.dataCount, str, n + 1 );
			gs.dataCount += n + 1;
		}
		oaVMWrite( parms[1], &gs, sizeof( gs ) );
		return 0;
	}
	case 51: {								/* GETCURRENTSNAPSHOTNUMBER: advances 1/frame */
		oaSnapNum++;
		oaVMWrite( parms[1], &oaSnapNum, 4 );
		int t = oaSnapNum * 50 + 1000;
		oaVMWrite( parms[2], &t, 4 );
		return 0;
	}
	case 52: {								/* GETSNAPSHOT: build snapshot k */
		oaSnapshot_t snap;
		int k = (int)parms[1];
		if ( k < 1 || k > oaSnapNum ) return 0;
		oaBuildSnapshot( k, &snap );
		oaVMWrite( parms[2], &snap, sizeof( snap ) );
		return 1;
	}
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
	fprintf( stderr, "oa-syscalls: total=%lld unknown=%lld sceneEnts=%d lights=%d polys=%d draws=%d work=%.1f\n",
			 total, unknown, oaSceneEntTotal, oaSceneLights, oaScenePolys, oaDraws, oaSceneWork );
	for ( int i = 0; i < MAXTRAP; i++ ) {
		if ( oaTrapCount[i] > 0 ) fprintf( stderr, "  trap %d: %lld\n", i, oaTrapCount[i] );
	}
	for ( int i = 0; i < MAXTRAP; i++ ) {
		if ( oaUnknownCount[i] > 0 ) fprintf( stderr, "  UNKNOWN trap %d: %lld\n", i, oaUnknownCount[i] );
	}
}
