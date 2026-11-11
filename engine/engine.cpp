// =============================================================================
//  FaceMap Studio - analysis engine
//  Freestanding C++17 (no STL, no libc, no heap) so it compiles to a tiny
//  WebAssembly module with plain clang OR with Emscripten.
//
//  JS hands in 478 MediaPipe face landmarks per frame; the engine
//    1. smooths them (One-Euro filter),
//    2. builds a head-pose-independent "canonical" coordinate frame,
//    3. measures face shape / bone structure / eyes / brows / symmetry,
//    4. designs a symmetric brow template + makeup zones in that frame,
//    5. projects everything back to screen space, so overlays follow the head
//       when it turns, tilts or nods.
//
//  Coordinate conventions
//    screen/px : x right, y down, z away from camera  (z scaled like x)
//    canonical : origin = midpoint of the eyes, unit = inter-eye distance,
//                x toward the subject's LEFT, y down, z away from camera.
//    (u, y)    : per-side 2D coords, u = distance OUTWARD from the facial
//                midline (u = sx * x, sx = -1 right side, +1 left side).
//    "Right"   : the subject's own right (appears on the image-left, i.e. the
//                lower MediaPipe indices 33/133/...).
// =============================================================================
#include <stdint.h>
#include <stddef.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten.h>
#define FM_API extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define FM_API extern "C" __attribute__((used, visibility("default")))
#endif

namespace {

typedef double f64;
const f64 PI  = 3.14159265358979323846;
const f64 DEG = 180.0 / PI;

// ----------------------------------------------------------------- math ----
inline f64 absd(f64 x) { return x < 0 ? -x : x; }
inline f64 sqrtd(f64 x) { return x > 0 ? __builtin_sqrt(x) : 0.0; }
inline f64 clampd(f64 x, f64 lo, f64 hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline f64 lerp(f64 a, f64 b, f64 t) { return a + (b - a) * t; }
inline f64 floord(f64 x) { long long i = (long long)x; f64 f = (f64)i; return f > x ? f - 1.0 : f; }

f64 sind(f64 x) {
    x -= 2 * PI * floord(x / (2 * PI) + 0.5);          // -> [-pi, pi]
    if (x > PI / 2) x = PI - x; else if (x < -PI / 2) x = -PI - x;
    f64 x2 = x * x;
    return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
}
inline f64 cosd(f64 x) { return sind(x + PI / 2); }

f64 atand(f64 x) {
    bool neg = x < 0; if (neg) x = -x;
    bool inv = x > 1; if (inv) x = 1 / x;
    f64 add = 0;
    if (x > 0.2679491924311227) { x = (x * 1.7320508075688772 - 1) / (1.7320508075688772 + x); add = PI / 6; }
    f64 x2 = x * x;
    f64 r = x * (1 - x2 * (1.0 / 3 - x2 * (1.0 / 5 - x2 * (1.0 / 7 - x2 * (1.0 / 9 - x2 * (1.0 / 11))))));
    r += add;
    if (inv) r = PI / 2 - r;
    return neg ? -r : r;
}
f64 atan2d(f64 y, f64 x) {
    if (x > 0) return atand(y / x);
    if (x < 0) return y >= 0 ? atand(y / x) + PI : atand(y / x) - PI;
    return y > 0 ? PI / 2 : (y < 0 ? -PI / 2 : 0);
}
inline f64 pow075(f64 x) { f64 r = sqrtd(x); return r * sqrtd(r); }   // x^0.75, x>=0
inline f64 acosd(f64 x) { x = clampd(x, -1, 1); return atan2d(sqrtd(1 - x * x), x); }
f64 expd(f64 x) {
    x = clampd(x, -60, 60);
    f64 k = floord(x * 1.4426950408889634 + 0.5);
    f64 r = x - k * 0.6931471805599453;
    f64 e = 1 + r * (1 + r / 2 * (1 + r / 3 * (1 + r / 4 * (1 + r / 5 * (1 + r / 6 * (1 + r / 7))))));
    union { f64 d; uint64_t u; } v; v.u = (uint64_t)((int)k + 1023) << 52;
    return e * v.d;
}

struct V3 { f64 x, y, z; };
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, f64 k) { return {a.x * k, a.y * k, a.z * k}; }
inline f64 dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline f64 vlen(V3 a) { return sqrtd(dot(a, a)); }
inline V3 vnorm(V3 a) { f64 l = vlen(a); return l > 1e-12 ? a * (1.0 / l) : V3{0, 0, 0}; }

struct Pt { f64 u, y; };
inline Pt operator+(Pt a, Pt b) { return {a.u + b.u, a.y + b.y}; }
inline Pt operator-(Pt a, Pt b) { return {a.u - b.u, a.y - b.y}; }
inline Pt operator*(Pt a, f64 k) { return {a.u * k, a.y * k}; }
inline Pt mid(Pt a, Pt b) { return {(a.u + b.u) * 0.5, (a.y + b.y) * 0.5}; }
inline Pt plerp(Pt a, Pt b, f64 t) { return {lerp(a.u, b.u, t), lerp(a.y, b.y, t)}; }
inline f64 plen(Pt a) { return sqrtd(a.u * a.u + a.y * a.y); }

// ------------------------------------------------------------ constants ----
const int NLM = 478;
const int OUT_CAP = 24000;
const int JSON_CAP = 28000;
const f64 SX[2] = {-1.0, 1.0};           // side 0 = subject's right, 1 = left
const f64 IPD_MM = 63.0;                 // average adult; used only for mm hints

struct SideIdx {
    int eOut, eIn, irisC, iris[4], lidTop, lidBot;
    int browUp[5], browLo[5];                  // tail -> head
    int alar, mouth, cheekEdge, gonial, jaw, chinSide, temple, foreh, hair, jawLow, earTop;
};
const SideIdx SI[2] = {
    {33, 133, 468, {469, 470, 471, 472}, 159, 145, {70, 63, 105, 66, 107}, {46, 53, 52, 65, 55},
     129, 61, 234, 58, 172, 176, 21, 54, 103, 150, 127},
    {263, 362, 473, {474, 475, 476, 477}, 386, 374, {300, 293, 334, 296, 336}, {276, 283, 282, 295, 285},
     358, 291, 454, 288, 397, 400, 251, 284, 332, 379, 356}};

const int IDX_TOP = 10, IDX_CHIN = 152, IDX_GLAB = 9, IDX_BRIDGE = 168, IDX_NOSETIP = 1,
          IDX_SUBNASAL = 2, IDX_LIPTOP = 0, IDX_LIPBOT = 17;

// pairs for the symmetry score (right idx, left idx)
const int SYM_PAIRS[][2] = {{33, 263}, {133, 362}, {159, 386}, {145, 374}, {107, 336}, {105, 334}, {70, 300},
                            {61, 291}, {129, 358}, {234, 454}, {172, 397}, {58, 288}, {54, 284}, {176, 400},
                            {205, 425}, {46, 276}};
const int NSYM = sizeof(SYM_PAIRS) / sizeof(SYM_PAIRS[0]);

// ----------------------------------------------------------- knowledge -----
// Tunable face-shape prototypes. Features: length/width, forehead/cheek,
// jaw/cheek, chin angle (deg), jaw-corner angle (deg), all measured on the
// MediaPipe mesh (so absolute values differ from tape-measure numbers).
// The defaults are centred on a MediaPipe-canonical-like "average" face; use
// the calibration sliders (engine_set_param 0/2/3) to nudge them for your camera.
struct Proto { const char* name; f64 len, fr, jr, chin, jaw; };
const Proto PROTO[6] = {
    {"Oval",    1.08, 0.64, 0.82, 140, 164},
    {"Round",   0.96, 0.64, 0.85, 150, 168},
    {"Square",  0.98, 0.66, 0.92, 146, 160},
    {"Heart",   1.07, 0.69, 0.70, 125, 156},
    {"Oblong",  1.22, 0.64, 0.82, 132, 165},
    {"Diamond", 1.08, 0.57, 0.70, 128, 159}};

struct Profile {
    const char* blurb;
    const char* browStyle;
    const char* browWhy;
    f64 archMult, minLift, maxLift, sharp, archShift, thick, tailLift;
    f64 blA, blB, blRiseDeg, blShift, blDrop;
    f64 ctB; bool ctJaw, ctTemple, ctHair, ctChin;
    bool brFore, brCheek, brJaw, brChin;
    bool hlCheek, hlBrow, hlNose, hlCupid, hlChin, hlFore;
    const char* tips[4][3];   // contour, bronzer, blush, highlight
};

const Profile PROF[6] = {
    // ---- Oval
    {"Balanced proportions - length about 1.5x width with a gently tapered jaw. Almost any placement works, so the goal is to enhance rather than correct.",
     "Soft, rounded arch", "A softly curved brow of natural thickness keeps an oval face balanced; avoid extremes.",
     1.0, 0.06, 0.12, 0.35, 0.0, 1.0, 0.010,
     0.30, 0.19, 28, 0.14, 0.0,
     0.09, false, false, false, false,
     true, true, true, false,
     true, true, true, true, false, false,
     {{"Define lightly in the hollow under the cheekbone, from ear toward the corner of the mouth, stopping under the outer edge of the eye.", "Keep the shade soft - oval faces need very little correction.", nullptr},
      {"Warm the temples, the cheekbones just above the contour, and the jaw edge in a loose '3' shape.", "Stay on the outer third of the face for a natural glow.", nullptr},
      {"Apply on the apples of the cheeks and sweep up toward the temples.", "A gentle diagonal keeps the proportions balanced.", nullptr},
      {"Tap highlighter on the top of the cheekbones, the brow bone, the nose bridge and the cupid's bow.", nullptr, nullptr}}},
    // ---- Round
    {"Soft curves with width and length nearly equal and a rounded jaw. The goal is definition and the illusion of length.",
     "High, defined arch", "An angled, lifted arch draws the eye up and adds the length and structure a round face lacks.",
     1.15, 0.075, 0.15, 0.80, 0.01, 0.95, 0.020,
     0.30, 0.17, 38, 0.20, 0.0,
     0.10, true, true, false, true,
     true, true, false, false,
     true, true, true, false, true, true,
     {{"Contour diagonally under the cheekbone, starting near the ear and angling toward the mouth corner, to carve a hollow.", "Shade the sides of the forehead and along the jaw to add structure, and add a touch under the chin.", nullptr},
      {"Place at the temples and just above the contour, angled up and back.", "Avoid the centre of the cheeks - it widens the face.", nullptr},
      {"Place slightly above the apples and blend diagonally toward the temples to lift and lengthen.", nullptr, nullptr},
      {"Highlight the centre of the forehead, top of the cheekbones, nose bridge and chin centre to add vertical length.", nullptr, nullptr}}},
    // ---- Square
    {"Strong jaw and forehead of similar width with fairly straight sides. The goal is to soften the corners.",
     "Soft angled arch, medium-full", "A subtle angle with slightly fuller body matches the strength of the jaw while softening it.",
     1.0, 0.06, 0.12, 0.55, 0.0, 1.12, 0.010,
     0.26, 0.20, 15, 0.04, 0.0,
     0.09, true, true, false, false,
     true, true, true, false,
     true, true, true, true, true, false,
     {{"Shade the jaw corners just below the ears to soften the angles.", "Contour the outer corners of the forehead at the temples; keep the cheek hollow blended.", nullptr},
      {"Warm the forehead corners and jaw edges with a light hand and blend into the neck.", nullptr, nullptr},
      {"Apply on the apples and blend in rounded circles instead of hard diagonal lines.", nullptr, nullptr},
      {"Highlight the cheekbones and the centre of the chin to add soft roundness in the middle of the face.", nullptr, nullptr}}},
    // ---- Heart
    {"Wider forehead and cheekbones tapering to a narrower chin. The goal is to balance the forehead with the lower face.",
     "Rounded, gently curved", "A rounded brow with a lower, softer arch avoids adding more width and lift at the top of the face.",
     0.90, 0.05, 0.11, 0.15, 0.0, 0.95, 0.008,
     0.30, 0.20, 10, 0.0, 0.05,
     0.08, false, true, false, true,
     true, true, false, true,
     true, true, true, true, true, false,
     {{"Shade the temples and outer forehead to reduce width at the top.", "Add a soft touch under the tip of the chin to round the point.", nullptr},
      {"Bronze the forehead edges and along the top of the cheekbones; add a little to the chin for warmth.", nullptr, nullptr},
      {"Apply on the lower apples and blend horizontally to add fullness to the mid-face.", nullptr, nullptr},
      {"Highlight the centre of the chin, the cheekbones and under the eyes; keep the forehead edges matte.", nullptr, nullptr}}},
    // ---- Oblong
    {"Longer than it is wide, with fairly straight cheek lines. The goal is to add width and visually shorten the length.",
     "Flat, straight brow", "Horizontal brows with only a hint of arch visually shorten the face and add width.",
     0.55, 0.015, 0.05, 0.0, 0.0, 1.12, 0.0,
     0.36, 0.15, 0, 0.02, 0.0,
     0.07, false, false, true, true,
     true, true, false, true,
     true, true, true, false, false, false,
     {{"Contour along the top of the forehead (hairline) and under the chin to shorten the face.", "Keep the cheek contour short and soft rather than long and diagonal.", nullptr},
      {"Sweep bronzer horizontally across the hairline and under the chin; keep the cheeks warm but not deep.", nullptr, nullptr},
      {"Apply horizontally across the cheeks, from beside the nose toward the temples, to widen the mid-face.", nullptr, nullptr},
      {"Highlight the cheekbones and brow bone outward; avoid the centre of the forehead and chin.", nullptr, nullptr}}},
    // ---- Diamond
    {"Widest at the cheekbones, with a narrower forehead and jaw. The goal is to soften the cheekbone width and add balance at the forehead and chin.",
     "Curved with a soft lift", "A curved brow with a softly lifted arch balances prominent cheekbones without adding width.",
     1.10, 0.07, 0.14, 0.50, 0.01, 0.95, 0.012,
     0.28, 0.19, 20, 0.10, 0.0,
     0.09, false, true, false, false,
     true, true, true, false,
     true, true, true, true, true, true,
     {{"Shade the outer cheekbones lightly and the temples to soften width.", "Keep the cheek contour short and blended.", nullptr},
      {"Add warmth at the forehead and jaw edges to balance the width at the cheekbones.", nullptr, nullptr},
      {"Place on the apples and blend softly upward and outward.", nullptr, nullptr},
      {"Highlight the centre of the forehead and chin for balance; keep the cheekbone highlight subtle.", nullptr, nullptr}}}};

// -------------------------------------------------------------- anchors ----
struct SideA {
    Pt eOut, eIn, iris, lidTop, lidBot, alar, mouth, cheekEdge, gonial, jaw, chinSide, temple, foreh, hair;
    Pt lowerBrow, bHead, bArch, bTail;
    Pt bu[5], bl[5];                        // natural brow upper/lower edge points, tail -> head
    f64 irisR, bThickHead, bThickArch, lidGap;
};
struct Anchors {
    SideA s[2];
    Pt top, glab, bridge, noseTip, subnasal, lipTop, lipBot, chin;
};

enum { F_LEN, F_FR, F_JR, F_CHIN, F_JAW, F_CHEEKP, F_FOREH, F_OPEN, F_TILT, F_SPACE, F_LIDSP, F_ASYM, NF };

// ---------------------------------------------------------------- state ----
float g_in[NLM * 3];
float g_out[OUT_CAP];
char  g_json[JSON_CAP];
int   g_outN = 0;

V3  P[NLM];             // filtered px landmarks
V3  C[NLM];             // canonical landmarks
V3  O_, EX, EY, EZ;     // frame
f64 S_ = 1;             // scale (px per canonical unit)

f64  g_fx[NLM * 3], g_fdx[NLM * 3], g_prev[NLM * 3];
bool g_fInit = false;
f64  g_lastT = 0;

f64  g_yaw = 0, g_pitch = 0, g_roll = 0;
bool g_valid = false, g_frontal = false, g_blink = false;

Anchors g_A; bool g_aInit = false;
f64  g_feat[NF]; int g_featN = 0; bool g_locked = false; int g_scanTarget = 45;
f64  g_lenBias = 0.0, g_foreBias = 0.0, g_jawBias = 0.0;
f64  g_prob[6]; int g_shape = 0;
f64  g_cur[NF];

struct Tpl { Pt H, A, T, alar; f64 wH, wA, wB, wT, sharp; Pt up[8], lo[8]; int n; Pt ch[5]; } g_tpl;
f64 g_fitY = 0, g_fitTop = 0, g_fitBot = 0, g_fitTail = 0;   // user fit sliders (+ = up / longer), in eye-distance units

// ------------------------------------------------------------ frame/pose ---
Pt upt(int sd, int i) { return {SX[sd] * C[i].x, C[i].y}; }
Pt cpt(int i) { return {C[i].x, C[i].y}; }
f64 cdist(int a, int b) { return vlen(C[a] - C[b]); }

f64 angleAt(int mid_, int a, int b) {
    V3 u = C[a] - C[mid_], v = C[b] - C[mid_];
    f64 d = vlen(u) * vlen(v);
    return d > 1e-12 ? acosd(dot(u, v) / d) * DEG : 0;
}

void updateFilter(int n, f64 w, f64 h, f64 dt) {
    const f64 mincut = 1.4, beta = 0.012, dcut = 1.0;
    f64 vs = 640.0 / w;
    for (int i = 0; i < NLM; ++i) {
        f64 raw[3] = {g_in[i * 3] * w, g_in[i * 3 + 1] * h, g_in[i * 3 + 2] * w};
        for (int k = 0; k < 3; ++k) {
            int j = i * 3 + k;
            if (!g_fInit) { g_fx[j] = raw[k]; g_fdx[j] = 0; }
            else {
                f64 dxr = (raw[k] - g_prev[j]) / dt * vs;
                f64 tau = 1.0 / (2 * PI * dcut);
                f64 ad = 1.0 / (1.0 + tau / dt);
                g_fdx[j] += ad * (dxr - g_fdx[j]);
                f64 cutoff = mincut + beta * absd(g_fdx[j]);
                f64 a = 1.0 / (1.0 + (1.0 / (2 * PI * cutoff)) / dt);
                g_fx[j] += a * (raw[k] - g_fx[j]);
            }
            g_prev[j] = raw[k];
        }
        P[i] = {g_fx[i * 3], g_fx[i * 3 + 1], g_fx[i * 3 + 2]};
    }
    g_fInit = true;
    (void)n;
}

bool buildFrame() {
    V3 eR = (P[33] + P[133]) * 0.5, eL = (P[263] + P[362]) * 0.5;
    O_ = (eR + eL) * 0.5;
    S_ = vlen(eL - eR);
    if (S_ < 4) return false;
    EX = vnorm(eL - eR);
    V3 down = P[IDX_CHIN] - P[IDX_TOP];
    EY = vnorm(down - EX * dot(down, EX));
    EZ = cross(EX, EY);
    for (int i = 0; i < NLM; ++i) {
        V3 d = P[i] - O_;
        C[i] = {dot(d, EX) / S_, dot(d, EY) / S_, dot(d, EZ) / S_};
    }
    g_yaw = atan2d(EX.z, EX.x) * DEG;
    g_roll = atan2d(EX.y, EX.x) * DEG;
    g_pitch = atan2d(EY.z, EY.y) * DEG;
    g_frontal = absd(g_yaw) < 12 && absd(g_roll) < 15 && absd(g_pitch) < 25;
    return true;
}

// canonical (x,y) -> estimated surface depth (inverse-distance on 4 nearest landmarks)
f64 surfZ(f64 cx, f64 cy) {
    f64 bd[4] = {1e9, 1e9, 1e9, 1e9}, bz[4] = {0, 0, 0, 0};
    for (int i = 0; i < NLM; ++i) {
        f64 dx = C[i].x - cx, dy = C[i].y - cy, d = dx * dx + dy * dy;
        if (d < bd[3]) {
            int k = 3;
            while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; bz[k] = bz[k - 1]; --k; }
            bd[k] = d; bz[k] = C[i].z;
        }
    }
    f64 ws = 0, zs = 0;
    for (int k = 0; k < 4; ++k) { f64 w = 1.0 / (bd[k] + 1e-4); ws += w; zs += w * bz[k]; }
    return zs / ws;
}

// canonical -> screen px
void toPx(f64 cx, f64 cy, f64& ox, f64& oy) {
    f64 cz = surfZ(cx, cy);
    V3 p = O_ + (EX * cx + EY * cy + EZ * cz) * S_;
    ox = p.x; oy = p.y;
}

// --------------------------------------------------------- anchors/feats ---
void computeAnchors(Anchors& A) {
    for (int sd = 0; sd < 2; ++sd) {
        const SideIdx& I = SI[sd]; SideA& a = A.s[sd];
        a.eOut = upt(sd, I.eOut); a.eIn = upt(sd, I.eIn); a.iris = upt(sd, I.irisC);
        f64 r = 0; for (int k = 0; k < 4; ++k) r += vlen(C[I.iris[k]] - C[I.irisC]);
        a.irisR = r / 4;
        a.lidTop = upt(sd, I.lidTop); a.lidBot = upt(sd, I.lidBot);
        a.alar = upt(sd, I.alar); a.mouth = upt(sd, I.mouth);
        a.cheekEdge = upt(sd, I.cheekEdge); a.gonial = upt(sd, I.gonial); a.jaw = upt(sd, I.jaw);
        a.chinSide = upt(sd, I.chinSide); a.temple = upt(sd, I.temple); a.foreh = upt(sd, I.foreh);
        a.hair = upt(sd, I.hair);
        a.lowerBrow = (upt(sd, I.browLo[1]) + upt(sd, I.browLo[2]) + upt(sd, I.browLo[3])) * (1.0 / 3);
        for (int k = 0; k < 5; ++k) { a.bu[k] = upt(sd, I.browUp[k]); a.bl[k] = upt(sd, I.browLo[k]); }
        a.bHead = mid(upt(sd, I.browUp[4]), upt(sd, I.browLo[4]));
        a.bArch = mid(upt(sd, I.browUp[2]), upt(sd, I.browLo[2]));
        a.bTail = mid(upt(sd, I.browUp[0]), upt(sd, I.browLo[0]));
        a.bThickHead = absd(upt(sd, I.browLo[4]).y - upt(sd, I.browUp[4]).y);
        a.bThickArch = absd(upt(sd, I.browLo[2]).y - upt(sd, I.browUp[2]).y);
        a.lidGap = a.lidTop.y - a.lowerBrow.y;
    }
    A.top = cpt(IDX_TOP); A.glab = cpt(IDX_GLAB); A.bridge = cpt(IDX_BRIDGE);
    A.noseTip = cpt(IDX_NOSETIP); A.subnasal = cpt(IDX_SUBNASAL);
    A.lipTop = cpt(IDX_LIPTOP); A.lipBot = cpt(IDX_LIPBOT); A.chin = cpt(IDX_CHIN);
}

void blendAnchors(f64 alpha) {
    Anchors cur; computeAnchors(cur);
    if (!g_aInit) { g_A = cur; g_aInit = true; return; }
    f64* a = reinterpret_cast<f64*>(&g_A);
    const f64* c = reinterpret_cast<const f64*>(&cur);
    const int n = sizeof(Anchors) / sizeof(f64);
    for (int i = 0; i < n; ++i) a[i] += alpha * (c[i] - a[i]);
}

// per-eye openness (height/width), averaged over three lid columns
f64 eyeOpen(int sd) {
    static const int col[2][3][2] = {{{159, 145}, {158, 153}, {160, 144}}, {{386, 374}, {385, 380}, {387, 373}}};
    const SideIdx& I = SI[sd];
    f64 w = cdist(I.eOut, I.eIn); if (w < 1e-6) return 0;
    f64 h = 0; for (int k = 0; k < 3; ++k) h += cdist(col[sd][k][0], col[sd][k][1]);
    return (h / 3) / w;
}

void computeFeatures(f64* f) {
    if (g_featN > 0) for (int i = 0; i < NF; ++i) f[i] = g_feat[i];
    else {
        const f64 d[NF] = {1.12, 0.80, 0.85, 120, 135, 1.15, 0.5, 0.30, 5, 1.0, 0.55, 0.0};
        for (int i = 0; i < NF; ++i) f[i] = d[i];
    }
    f64 cw = cdist(234, 454), fl = cdist(IDX_TOP, IDX_CHIN), fw = cdist(54, 284), jw = cdist(58, 288);
    if (cw < 1e-6) return;
    f[F_LEN] = fl / cw;
    f[F_FR] = fw / cw;
    f[F_JR] = jw / cw;
    f[F_CHIN] = angleAt(IDX_CHIN, 150, 379);
    f[F_JAW] = 0.5 * (angleAt(172, 150, 132) + angleAt(397, 379, 361));
    f[F_CHEEKP] = cw / (0.5 * (fw + jw));
    f[F_FOREH] = absd(C[IDX_BRIDGE].y - C[IDX_TOP].y) / fl;
    if (!g_blink) {
        f64 o = 0.5 * (eyeOpen(0) + eyeOpen(1));
        f64 tilt = 0, lid = 0, w = 0;
        for (int sd = 0; sd < 2; ++sd) {
            Pt in = upt(sd, SI[sd].eIn), out = upt(sd, SI[sd].eOut);
            tilt += atan2d(-(out.y - in.y), out.u - in.u) * DEG * 0.5;
            f64 ew = plen(out - in); w += ew * 0.5;
            Pt lb = (upt(sd, SI[sd].browLo[1]) + upt(sd, SI[sd].browLo[2]) + upt(sd, SI[sd].browLo[3])) * (1.0 / 3);
            lid += (C[SI[sd].lidTop].y - lb.y) / ew * 0.5;
        }
        f[F_OPEN] = o; f[F_TILT] = tilt; f[F_LIDSP] = lid;
        f[F_SPACE] = cdist(133, 362) / w;
    }
    // facial symmetry (mirror-pair distances in canonical space)
    f64 acc = 0;
    for (int i = 0; i < NSYM; ++i) {
        Pt r = upt(0, SYM_PAIRS[i][0]), l = upt(1, SYM_PAIRS[i][1]);
        acc += 0.5 * (absd(r.u - l.u) + absd(r.y - l.y));
    }
    f[F_ASYM] = acc / NSYM;
}

void classifyShape(const f64* f) {
    f64 sc[6], mx = -1e9;
    for (int k = 0; k < 6; ++k) {
        const Proto& p = PROTO[k];
        f64 a = (f[F_LEN] + g_lenBias - p.len) / 0.07, b = (f[F_FR] + g_foreBias - p.fr) / 0.035,
            c = (f[F_JR] + g_jawBias - p.jr) / 0.04, d = (f[F_CHIN] - p.chin) / 14.0, e = (f[F_JAW] - p.jaw) / 14.0;
        sc[k] = -0.5 * (a * a + b * b + c * c + 0.35 * d * d + 0.35 * e * e);
        if (sc[k] > mx) mx = sc[k];
    }
    f64 sum = 0;
    for (int k = 0; k < 6; ++k) { g_prob[k] = expd(sc[k] - mx); sum += g_prob[k]; }
    int best = 0;
    for (int k = 0; k < 6; ++k) { g_prob[k] /= sum; if (g_prob[k] > g_prob[best]) best = k; }
    if (best != g_shape && g_prob[best] > g_prob[g_shape] + 0.08) g_shape = best;   // hysteresis
}

// eye category helpers (shared by drawing and report)
int eyeShapeC(f64 open) { return open < 0.24 ? 0 : (open > 0.34 ? 2 : 1); }   // narrow/almond/round
int eyeTiltC(f64 t)     { return t < 2.0 ? 0 : (t > 8.0 ? 2 : 1); }           // down/neutral/up
int eyeSpaceC(f64 s)    { return s < 0.92 ? 0 : (s > 1.12 ? 2 : 1); }         // close/balanced/wide
int eyeLidC(f64 l)      { return l < 0.40 ? 0 : (l > 0.75 ? 2 : 1); }         // hooded/standard/open

// -------------------------------------------------------- output writers ---
bool primBegin(int kind, int side, int sub, int n) {
    if (g_outN + 4 + 2 * n > OUT_CAP) return false;
    g_out[g_outN++] = (float)kind; g_out[g_outN++] = (float)side;
    g_out[g_outN++] = (float)sub;  g_out[g_outN++] = (float)n;
    return true;
}
// push a point given (u,y) in side space (sd 0/1) or (x,y) for centre (sd 2)
void pushUY(int sd, f64 u, f64 y) {
    f64 x = sd == 2 ? u : SX[sd] * u, px, py;
    toPx(x, y, px, py);
    g_out[g_outN++] = (float)px; g_out[g_outN++] = (float)py;
}
void addEllipse(int kind, int sub, int sd, Pt c, f64 a, f64 b, f64 rot) {
    const int N = 28;
    if (!primBegin(kind, sd, sub, N)) return;
    f64 cr = cosd(rot), sr = sind(rot);
    for (int k = 0; k < N; ++k) {
        f64 ang = 2 * PI * k / N, du = a * cosd(ang), dy = b * sind(ang);
        pushUY(sd, c.u + du * cr - dy * sr, c.y + du * sr + dy * cr);
    }
}

// ----------------------------------------------------------------- brows ---
// The template is built from the user's OWN brows by REMOVAL ONLY, so little or no filling is needed:
// for every point along the brow it takes the region that lies inside BOTH the left and the right brow
// (mirrored), shrunk a hair inward. Hair outside it is what to remove to make the pair match.
// Only the front (moved to the bridge of the nose) can ask for a little fill.
void buildTemplate() {
    const Profile& pr = PROF[g_shape];
    const SideA &r = g_A.s[0], &l = g_A.s[1];
    Pt alar = mid(r.alar, l.alar), eIn = mid(r.eIn, l.eIn);
    f64 uStart = clampd(0.68 * eIn.u, 0.10, eIn.u);       // brows begin at the bridge of the nose
    const f64 margin = 0.010;                              // keep the template just inside the natural edge

    Pt UP[8], LO[8]; int n = 5;                            // index 0 = tail ... n-1 = head
    for (int k = 0; k < 5; ++k) {
        f64 u = 0.5 * (r.bu[k].u + l.bu[k].u + r.bl[k].u + l.bl[k].u) * 0.5;
        if (k == 0) { f64 m = r.bu[0].u < l.bu[0].u ? r.bu[0].u : l.bu[0].u; f64 m2 = r.bl[0].u < l.bl[0].u ? r.bl[0].u : l.bl[0].u; u = (m < m2 ? m : m2) - 0.01; }   // shorter tail
        f64 up = (r.bu[k].y > l.bu[k].y ? r.bu[k].y : l.bu[k].y) + margin;    // lower of the two top edges
        f64 lo = (r.bl[k].y < l.bl[k].y ? r.bl[k].y : l.bl[k].y) - margin;    // higher of the two bottom edges
        if (lo < up + 0.03) { f64 m = 0.5 * (lo + up); up = m - 0.015; lo = m + 0.015; }
        UP[k] = {u, up}; LO[k] = {u, lo};
    }
    // front: move to the nose-bridge start (small extension), or trim if the natural front is further in
    if (UP[4].u > uStart + 0.01) {
        f64 s1 = (UP[4].y - UP[3].y) / (UP[4].u - UP[3].u + 1e-6), s2 = (LO[4].y - LO[3].y) / (LO[4].u - LO[3].u + 1e-6);
        f64 d = uStart - UP[4].u;
        UP[5] = {uStart, UP[4].y + clampd(0.5 * s1 * d, -0.03, 0.03)};
        LO[5] = {uStart, LO[4].y + clampd(0.5 * s2 * d, -0.03, 0.03)};
        n = 6;
    } else { UP[4].u = uStart; LO[4].u = uStart; }
    int hd = n - 1;

    // bottom line: underside of head and tail on one level line, reached by removing (raising) only
    f64 yb = LO[hd].y < LO[0].y ? LO[hd].y : LO[0].y;
    if (LO[hd].y - yb > 0.05) yb = LO[hd].y - 0.05;        // never ask for more than ~3 mm at the front
    for (int q = 0; q < 2; ++q) { int k = q ? hd : 0; if (LO[k].y > yb) LO[k].y = yb; if (UP[k].y > LO[k].y - 0.03) UP[k].y = LO[k].y - 0.03; }
    // user fit (sliders): shift whole brow / top line / bottom line, lengthen or shorten the tail
    for (int k = 0; k < n; ++k) { UP[k].y -= g_fitY + g_fitTop; LO[k].y -= g_fitY + g_fitBot; }
    UP[0].u += g_fitTail; LO[0].u += g_fitTail;
    for (int k = 0; k < n; ++k) if (LO[k].y < UP[k].y + 0.02) { f64 m = 0.5 * (LO[k].y + UP[k].y); UP[k].y = m - 0.01; LO[k].y = m + 0.01; }
    int ap = 1; for (int k = 1; k < hd; ++k) if (UP[k].y < UP[ap].y) ap = k;

    // straight "chart" lines: head-top -> apex-top -> tail tip, and head-bottom -> arch-low -> tail tip
    g_tpl.ch[0] = UP[hd]; g_tpl.ch[1] = UP[ap]; g_tpl.ch[2] = mid(UP[0], LO[0]);
    g_tpl.ch[3] = {LO[ap].u - 0.02, LO[ap].y}; g_tpl.ch[4] = LO[hd];

    g_tpl.n = n;
    for (int k = 0; k < n; ++k) { g_tpl.up[k] = UP[k]; g_tpl.lo[k] = LO[k]; }
    g_tpl.alar = alar;
    g_tpl.H = mid(UP[hd], LO[hd]); g_tpl.A = mid(UP[ap], LO[ap]); g_tpl.T = mid(UP[0], LO[0]);
    g_tpl.wH = LO[hd].y - UP[hd].y; g_tpl.wA = LO[ap].y - UP[ap].y; g_tpl.wB = g_tpl.wA; g_tpl.wT = LO[0].y - UP[0].y;
    g_tpl.sharp = pr.sharp;
}

const int BNS = 33;
Pt catmull(const Pt* P, int n, f64 pos) {                 // uniform Catmull-Rom through P[0..n-1], pos in [0, n-1]
    int i = (int)pos; if (i > n - 2) i = n - 2; if (i < 0) i = 0;
    f64 t = pos - i;
    Pt p0 = P[i > 0 ? i - 1 : 0], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2 < n ? i + 2 : n - 1];
    f64 t2 = t * t, t3 = t2 * t;
    auto f = [&](f64 a, f64 b, f64 c, f64 d) { return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
    return {f(p0.u, p1.u, p2.u, p3.u), f(p0.y, p1.y, p2.y, p3.y)};
}
// Smooth upper/lower edges (head -> tail) through the adjusted natural control points.
int browEdges(Pt* up, Pt* lo) {
    int n = g_tpl.n;
    for (int i = 0; i < BNS; ++i) {
        f64 pos = (n - 1) * (1.0 - (f64)i / (BNS - 1));       // index n-1 is the head
        up[i] = catmull(g_tpl.up, n, pos); lo[i] = catmull(g_tpl.lo, n, pos);
    }
    return BNS;
}
void emitOutline(int kind, int sd) {
    Pt up[BNS], lo[BNS]; int n = browEdges(up, lo);
    if (!primBegin(kind, sd, 0, 2 * n)) return;
    for (int i = 0; i < n; ++i) pushUY(sd, up[i].u, up[i].y);
    for (int i = n - 1; i >= 0; --i) pushUY(sd, lo[i].u, lo[i].y);
}
void emitBrowTarget(int sd) { emitOutline(1, sd); }

// Angular "mapped" brow: head-top -> arch-top -> tail -> arch-low -> head-low (closed)
void tplCorners(Pt* c) { for (int i = 0; i < 5; ++i) c[i] = g_tpl.ch[i]; }
void emitBrowAngular(int sd) {
    Pt c[5]; tplCorners(c);
    if (!primBegin(6, sd, 0, 5)) return;
    for (int i = 0; i < 5; ++i) pushUY(sd, c[i].u, c[i].y);
}
void line2(int step, int sd, Pt a, Pt b) {
    if (!primBegin(3, sd, step, 2)) return;
    pushUY(sd, a.u, a.y); pushUY(sd, b.u, b.y);
}
// Classic brow-mapping lines (numbered like a brow-mapping chart).
//  1 midline, 2 level line at the arch top, 3 nostril->eye-corner->tail, 4 inner V,
//  5 start vertical (bridge of the nose), 6 arch vertical, 7 tail vertical, 8/9 upper/lower brow lines,
//  10 nostril->pupil->arch, 11 diamond frame from the forehead apex
void emitBrowMapSide(int sd) {
    Pt c[5]; tplCorners(c);
    const SideA& a = g_A.s[sd];
    Pt al = g_tpl.alar, H = g_tpl.H, A = g_tpl.A, T = g_tpl.T;
    f64 yLevel = c[1].y;
    line2(3, sd, al, al + (T - al) * 1.16);
    line2(5, sd, {H.u, yLevel}, {H.u, al.y});
    line2(6, sd, {A.u, yLevel}, {A.u, a.lidBot.y + 0.30});
    line2(7, sd, {T.u, yLevel}, {T.u, T.y});
    if (primBegin(3, sd, 8, 3)) { for (int i = 0; i < 3; ++i) pushUY(sd, c[i].u, c[i].y); }
    if (primBegin(3, sd, 9, 3)) { pushUY(sd, c[2].u, c[2].y); pushUY(sd, c[3].u, c[3].y); pushUY(sd, c[4].u, c[4].y); }
    line2(10, sd, al, al + (A - al) * 1.12);
    line2(11, sd, {0, yLevel - 0.52}, {T.u, yLevel});
    Pt kp[3] = {H, A, T};
    for (int k = 0; k < 3; ++k) { if (!primBegin(4, sd, k, 1)) return; pushUY(sd, kp[k].u, kp[k].y); }
}
void emitBrowMapCenter() {
    Pt c[5]; tplCorners(c);
    f64 yLevel = c[1].y, Hu = g_tpl.H.u, Tu = g_tpl.T.u;
    if (primBegin(3, 2, 1, 2)) { pushUY(2, 0, yLevel - 0.12); pushUY(2, 0, g_A.noseTip.y); }
    if (primBegin(3, 2, 2, 2)) { pushUY(2, -(Tu + 0.14), yLevel); pushUY(2, Tu + 0.14, yLevel); }
    if (primBegin(3, 2, 4, 3)) {
        pushUY(2, -Hu, g_tpl.H.y); pushUY(2, 0, g_tpl.H.y + 0.09); pushUY(2, Hu, g_tpl.H.y);
    }
    if (primBegin(3, 2, 12, 2)) { pushUY(2, -Hu, g_tpl.H.y); pushUY(2, Hu, g_tpl.H.y); }
    // bottom line: one level line along the underside of both brows (head bottom = tail level)
    if (primBegin(3, 2, 13, 2)) { f64 yb = g_tpl.H.y + 0.5 * g_tpl.wH; pushUY(2, -(Tu + 0.10), yb); pushUY(2, Tu + 0.10, yb); }
}

// ------------------------------------------------------------------ eyes ---
Pt quad(Pt p0, Pt pc, Pt p2, f64 t) {
    f64 m = 1 - t;
    return {m * m * p0.u + 2 * m * t * pc.u + t * t * p2.u, m * m * p0.y + 2 * m * t * pc.y + t * t * p2.y};
}

void emitEye(int sd, const f64* F) {
    const SideA& a = g_A.s[sd];
    Pt pc = a.lidTop * 2.0 - (a.eOut + a.eIn) * 0.5;               // passes through lidTop at t=.5
    Pt bc = a.lidBot * 2.0 - (a.eOut + a.eIn) * 0.5;
    f64 g = clampd(a.lidGap, 0.10, 0.45);
    int lidC = eyeLidC(F[F_LIDSP]), tiltC = eyeTiltC(F[F_TILT]), spC = eyeSpaceC(F[F_SPACE]), shC = eyeShapeC(F[F_OPEN]);
    f64 kCrease = clampd(0.5 * g, 0.07, 0.15) * (lidC == 0 ? 1.25 : 1.0);   // crease sits ~0.7-1 cm above the lash line

    // lid wash (between lash line and crease)
    const int M = 12;
    if (primBegin(14, sd, 0, 2 * (M + 1))) {
        for (int i = 0; i <= M; ++i) { f64 t = (f64)i / M; Pt q = quad(a.eOut, pc, a.eIn, t); pushUY(sd, q.u, q.y); }
        for (int i = M; i >= 0; --i) {
            f64 t = (f64)i / M; Pt q = quad(a.eOut, pc, a.eIn, t);
            f64 c = kCrease * 0.92 * pow075(sind(PI * t));
            pushUY(sd, q.u, q.y - c);
        }
    }
    // crease guide (polyline)
    if (primBegin(16, sd, 0, M + 1)) {
        for (int i = 0; i <= M; ++i) {
            f64 t = (f64)i / M; Pt q = quad(a.eOut, pc, a.eIn, t);
            pushUY(sd, q.u, q.y - kCrease * pow075(sind(PI * t)));
        }
    }
    // outer-V
    {
        Pt q1 = quad(a.eOut, pc, a.eIn, 0.20), q2 = quad(a.eOut, pc, a.eIn, 0.55);
        q1.y -= kCrease * 0.6; q2.y -= kCrease * 0.95;
        Pt c = {q1.u + 0.015, q1.y + 0.01};
        f64 rot = atan2d(q2.y - q1.y, q2.u - q1.u);
        addEllipse(15, 0, sd, c, 0.12, 0.055, rot);
    }
    // inner-corner highlight
    addEllipse(17, 0, sd, {a.eIn.u - 0.005, a.eIn.y - 0.012}, 0.05, 0.03, 0);

    // wing (triangle: outer corner -> tip -> back to lid)
    {
        Pt lp = quad(a.eOut, bc, a.eIn, 0.30);
        Pt d = a.eOut - lp; f64 l = plen(d); if (l < 1e-9) { d = {1, 0}; l = 1; }
        f64 th = atan2d(d.y, d.u);
        f64 riseDeg = tiltC == 0 ? 14 : (tiltC == 1 ? 6 : 0);
        th -= riseDeg / DEG;
        f64 len = 0.17 * (shC == 2 ? 1.2 : 1.0) * (spC == 0 ? 1.25 : (spC == 2 ? 0.85 : 1.0)) * (lidC == 0 ? 0.9 : 1.0);
        Pt tip = {a.eOut.u + len * cosd(th), a.eOut.y + len * sind(th)};
        Pt back = quad(a.eOut, pc, a.eIn, 0.42);
        if (primBegin(18, sd, 0, 3)) {
            pushUY(sd, a.eOut.u, a.eOut.y); pushUY(sd, tip.u, tip.y); pushUY(sd, back.u, back.y);
        }
    }
}

// ----------------------------------------------------------------- zones ---
void emitZones(const f64* F) {
    const Profile& pr = PROF[g_shape];
    (void)F;
    for (int sd = 0; sd < 2; ++sd) {
        const SideA& a = g_A.s[sd];
        // cheek hollow contour (+ bronzer sweep sitting just above)
        Pt A0 = {a.cheekEdge.u - 0.10, a.cheekEdge.y};
        f64 Bu = a.iris.u + a.irisR, dm = a.mouth.u - A0.u;
        Pt Bp = absd(dm) > 1e-3 ? plerp(A0, a.mouth, (Bu - A0.u) / dm) : A0;
        Pt cc = mid(A0, Bp); f64 len = plen(Bp - A0) * 0.5, rot = atan2d(Bp.y - A0.y, Bp.u - A0.u);
        addEllipse(10, 0, sd, cc, len, pr.ctB, rot);
        if (pr.brCheek) addEllipse(11, 1, sd, {cc.u, cc.y - 0.11}, len * 0.95, 0.12, rot);

        Pt tdir = a.hair - a.temple; f64 trot = atan2d(tdir.y, tdir.u);
        if (pr.ctJaw) {
            Pt c = mid(a.gonial, a.chinSide); c.u -= 0.09; c.y -= 0.02;
            addEllipse(10, 1, sd, c, plen(a.chinSide - a.gonial) * 0.48, 0.065, atan2d(a.chinSide.y - a.gonial.y, a.chinSide.u - a.gonial.u));
        }
        if (pr.ctTemple) {
            Pt c = plerp(a.foreh, a.temple, 0.5); c.u -= 0.10; c.y += 0.03;
            addEllipse(10, 2, sd, c, 0.24, 0.08, trot);
        }
        if (pr.brFore) {
            Pt c = plerp(a.hair, a.foreh, 0.4); c.u -= 0.09; c.y += 0.07;
            addEllipse(11, 0, sd, c, 0.22, 0.085, trot);
        }
        if (pr.brJaw) {
            Pt c = plerp(a.gonial, a.jaw, 0.55); c.u -= 0.09; c.y -= 0.02;
            addEllipse(11, 2, sd, c, 0.18, 0.065, atan2d(a.chinSide.y - a.gonial.y, a.chinSide.u - a.gonial.u));
        }
        // blush
        Pt apple = {a.iris.u + 0.05, lerp(a.lidBot.y, a.mouth.y, 0.42)};
        f64 rise = pr.blRiseDeg / DEG;
        Pt bc = {apple.u + pr.blShift * cosd(rise), apple.y - pr.blShift * sind(rise) + pr.blDrop};
        addEllipse(12, 0, sd, bc, pr.blA, pr.blB, -rise);
        // highlights
        if (pr.hlCheek) {
            Pt c = {lerp(a.cheekEdge.u - 0.05, a.eOut.u, 0.45), a.eOut.y + 0.21};
            addEllipse(13, 0, sd, c, 0.20, 0.05, -0.26);
        }
        if (pr.hlBrow) {
            f64 yb = g_tpl.A.y + 0.5 * g_tpl.wA + 0.055;
            if (yb > a.lidTop.y - 0.10) yb = a.lidTop.y - 0.10;
            addEllipse(13, 1, sd, {g_tpl.A.u - 0.03, yb}, 0.15, 0.028, 0);
        }
        // eye makeup
        emitEye(sd, F);
    }
    // centre zones
    const Anchors& A = g_A;
    if (pr.ctHair)  addEllipse(10, 3, 2, {0, A.top.y + 0.10}, 0.50, 0.07, 0);
    if (pr.ctChin)  addEllipse(10, 4, 2, {0, A.chin.y - 0.03}, 0.38, 0.06, 0);
    if (pr.brChin)  addEllipse(11, 3, 2, {0, lerp(A.lipBot.y, A.chin.y, 0.8)}, 0.13, 0.05, 0);
    if (pr.hlNose)  addEllipse(13, 2, 2, {0, lerp(A.bridge.y, A.noseTip.y, 0.5)}, (A.noseTip.y - A.bridge.y) * 0.38, 0.022, PI / 2);
    if (pr.hlCupid) addEllipse(13, 3, 2, {0, A.lipTop.y - 0.035}, 0.075, 0.028, 0);
    if (pr.hlChin)  addEllipse(13, 4, 2, {0, lerp(A.lipBot.y, A.chin.y, 0.45)}, 0.07, 0.05, 0);
    if (pr.hlFore)  addEllipse(13, 5, 2, {0, lerp(A.top.y, A.glab.y, 0.55)}, 0.20, 0.08, 0);
}

// ---------------------------------------------------------------- report ---
struct Json {
    char* b; int n, cap; bool comma[24]; int d;
    void init(char* buf, int c) { b = buf; n = 0; cap = c; d = 0; comma[0] = false; }
    void raw(char c) { if (n < cap - 1) b[n++] = c; }
    void sep() { if (comma[d]) raw(','); comma[d] = true; }
    void str_(const char* s) {
        raw('"');
        while (*s) { char c = *s++; if (c == '"' || c == '\\') raw('\\'); if (c == '\n') { raw('\\'); raw('n'); continue; } raw(c); }
        raw('"');
    }
    void num_(f64 v, int dec) {
        if (v != v) v = 0;
        if (v < 0) { raw('-'); v = -v; }
        f64 p = 1; for (int i = 0; i < dec; ++i) p *= 10;
        long long iv = (long long)(v * p + 0.5);
        long long ip = iv / (long long)p, fp = iv % (long long)p;
        char tmp[24]; int t = 0; if (ip == 0) tmp[t++] = '0';
        while (ip > 0) { tmp[t++] = (char)('0' + ip % 10); ip /= 10; }
        while (t > 0) raw(tmp[--t]);
        if (dec > 0) {
            raw('.'); char fr[8];
            for (int i = dec - 1; i >= 0; --i) { fr[i] = (char)('0' + fp % 10); fp /= 10; }
            for (int i = 0; i < dec; ++i) raw(fr[i]);
        }
    }
    void key(const char* k) { sep(); str_(k); raw(':'); comma[d] = false; }
    void open(char c) { sep(); raw(c); ++d; comma[d] = false; }
    void close(char c) { raw(c); --d; comma[d] = true; }
    void obj() { open('{'); }  void endObj() { close('}'); }
    void arr() { open('['); }  void endArr() { close(']'); }
    void s(const char* v) { sep(); str_(v); }
    void n_(f64 v, int dec = 2) { sep(); num_(v, dec); }
    void b_(bool v) { sep(); const char* t = v ? "true" : "false"; while (*t) raw(*t++); }
    void kS(const char* k, const char* v) { key(k); s(v); }
    void kN(const char* k, f64 v, int dec = 2) { key(k); n_(v, dec); }
    void kB(const char* k, bool v) { key(k); b_(v); }
};

struct Txt {   // tiny string builder for dynamic sentences
    char t[160]; int n;
    void clear() { n = 0; t[0] = 0; }
    Txt& a(const char* s) { while (*s && n < 158) t[n++] = *s++; t[n] = 0; return *this; }
    Txt& i(int v) {
        if (v < 0) { a("-"); v = -v; }
        char tmp[12]; int k = 0; if (v == 0) tmp[k++] = '0';
        while (v > 0) { tmp[k++] = (char)('0' + v % 10); v /= 10; }
        while (k > 0 && n < 158) t[n++] = tmp[--k];
        t[n] = 0; return *this;
    }
};
inline int mm(f64 d) { return (int)(absd(d) * IPD_MM + 0.5); }

void eyeTips(Json& j, const f64* F) {
    int sh = eyeShapeC(F[F_OPEN]), tl = eyeTiltC(F[F_TILT]), sp = eyeSpaceC(F[F_SPACE]), ld = eyeLidC(F[F_LIDSP]);
    j.arr();
    static const char* shT[3] = {
        "Narrow eyes: brighten the centre of the lid with a light shimmer, keep deeper shades to the outer corner, and keep liner thin.",
        "Almond eyes suit most techniques - blend a medium transition shade into the crease and add depth to the outer third.",
        "Round eyes: elongate by concentrating depth on the outer third and pulling it outward in a soft wing; keep the lower lash line light."};
    static const char* tlT[3] = {
        "Downturned outer corners: angle the liner and outer-V upward toward the tail of the brow to lift; keep the lower outer lash line light.",
        "Neutral tilt: a straight wing angled slightly upward keeps things balanced.",
        "Upturned outer corners: follow the natural lift - extend the lower lash line outward into a wing for a clean, balanced flick."};
    static const char* spT[3] = {
        "Close-set eyes: brighten the inner corners and put the depth on the outer half; extend the wing a little to create space.",
        "Balanced eye spacing: you can place colour evenly across the lid.",
        "Wide-set eyes: add a touch of depth to the inner corners and keep the wing shorter; start liner from the inner corner."};
    static const char* ldT[3] = {
        "Limited lid space (hooded/deep-set look): set crease colour a little higher so it shows with the eyes open; use matte shades and a thin, upward-angled liner.",
        "Standard lid space: a visible crease line and a lid colour both work well.",
        "Generous lid space: you have room for a defined crease and a visible lid colour; bold colour and shimmer both work."};
    j.s(shT[sh]); j.s(tlT[tl]); j.s(spT[sp]); j.s(ldT[ld]);
    j.endArr();
}

void tipArr(Json& j, int cat) {
    const Profile& pr = PROF[g_shape];
    j.arr();
    for (int i = 0; i < 3; ++i) if (pr.tips[cat][i]) j.s(pr.tips[cat][i]);
    j.endArr();
}

const char* boneJaw(const f64* F) {
    f64 jr = F[F_JR] + g_jawBias;
    if (jr > 0.88) return "Strong, wide jaw";
    if (jr < 0.75) return "Narrow, tapered jaw";
    return "Balanced, softly defined jaw";
}
const char* boneChin(const f64* F) {
    if (F[F_CHIN] < 130) return "Pointed chin";
    if (F[F_CHIN] > 146) return "Broad, rounded chin";
    return "Softly rounded chin";
}
const char* boneCheek(const f64* F) {
    f64 cp = F[F_CHEEKP];
    if (cp > 1.50) return "High, prominent cheekbones";
    if (cp < 1.30) return "Soft, understated cheekbones";
    return "Moderate cheekbones";
}
const char* boneFore(const f64* F) {
    f64 fr = F[F_FR] + g_foreBias;
    if (fr > 0.68) return "Broad forehead";
    if (fr < 0.59) return "Narrow forehead";
    return "Medium forehead";
}

int buildReport() {
    Json j; j.init(g_json, JSON_CAP);
    const f64* F = g_featN > 0 ? g_feat : g_cur;
    const Profile& pr = PROF[g_shape];
    j.obj();
    j.kB("ok", g_valid);
    if (!g_valid) { j.endObj(); g_json[j.n] = 0; return j.n; }
    j.kB("frontal", g_frontal);
    j.kN("yaw", g_yaw, 1); j.kN("pitch", g_pitch, 1); j.kN("roll", g_roll, 1);
    j.key("scan"); j.obj();
    j.kN("progress", clampd((f64)g_featN / g_scanTarget, 0, 1), 2);
    j.kN("samples", g_featN, 0); j.kB("locked", g_locked);
    j.endObj();

    j.key("face"); j.obj();
    j.kS("shape", PROTO[g_shape].name); j.kN("confidence", g_prob[g_shape], 2); j.kS("blurb", pr.blurb);
    j.key("ranking"); j.arr();
    bool used[6] = {false, false, false, false, false, false};
    for (int r = 0; r < 6; ++r) {
        int b = -1; for (int k = 0; k < 6; ++k) if (!used[k] && (b < 0 || g_prob[k] > g_prob[b])) b = k;
        used[b] = true; j.obj(); j.kS("name", PROTO[b].name); j.kN("p", g_prob[b], 3); j.endObj();
    }
    j.endArr();
    j.key("bone"); j.obj();
    j.kS("cheekbones", boneCheek(F)); j.kS("jaw", boneJaw(F)); j.kS("chin", boneChin(F)); j.kS("forehead", boneFore(F));
    j.endObj();
    j.endObj();

    j.key("measure"); j.obj();
    j.kN("lengthToWidth", F[F_LEN] + g_lenBias, 3); j.kN("foreheadToCheek", F[F_FR] + g_foreBias, 3); j.kN("jawToCheek", F[F_JR] + g_jawBias, 3);
    j.kN("chinAngle", F[F_CHIN], 1); j.kN("jawAngle", F[F_JAW], 1); j.kN("cheekProminence", F[F_CHEEKP], 3);
    j.kN("eyeOpenness", F[F_OPEN], 3); j.kN("eyeTilt", F[F_TILT], 1); j.kN("eyeSpacing", F[F_SPACE], 3);
    j.kN("lidSpace", F[F_LIDSP], 3);
    j.endObj();

    static const char* shN[3] = {"Narrow almond", "Almond", "Round"};
    static const char* tlN[3] = {"Downturned", "Neutral", "Upturned"};
    static const char* spN[3] = {"Close-set", "Balanced", "Wide-set"};
    static const char* ldN[3] = {"Limited (hooded look)", "Standard", "Generous"};
    j.key("eyes"); j.obj();
    j.kS("shape", shN[eyeShapeC(F[F_OPEN])]); j.kS("tilt", tlN[eyeTiltC(F[F_TILT])]);
    j.kS("spacing", spN[eyeSpaceC(F[F_SPACE])]); j.kS("lidSpace", ldN[eyeLidC(F[F_LIDSP])]);
    j.key("tips"); eyeTips(j, F);
    j.endObj();

    j.key("brows"); j.obj();
    j.kS("style", pr.browStyle); j.kS("why", pr.browWhy);
    // natural-brow asymmetry
    j.key("asymmetry"); j.arr();
    {
        Txt t; const SideA &r = g_A.s[0], &l = g_A.s[1]; int c = 0;
        f64 d = r.bArch.y - l.bArch.y;
        if (absd(d) * IPD_MM >= 1.5) { t.clear(); t.a(d < 0 ? "Right" : "Left").a(" brow arch sits about ").i(mm(d)).a(" mm higher than the ").a(d < 0 ? "left" : "right").a("."); j.s(t.t); ++c; }
        d = r.bHead.y - l.bHead.y;
        if (absd(d) * IPD_MM >= 1.5) { t.clear(); t.a(d < 0 ? "Right" : "Left").a(" brow starts about ").i(mm(d)).a(" mm higher at the inner end."); j.s(t.t); ++c; }
        d = r.bTail.y - l.bTail.y;
        if (absd(d) * IPD_MM >= 1.5) { t.clear(); t.a(d < 0 ? "Right" : "Left").a(" brow tail ends about ").i(mm(d)).a(" mm higher."); j.s(t.t); ++c; }
        d = r.bTail.u - l.bTail.u;
        if (absd(d) * IPD_MM >= 2.0) { t.clear(); t.a(d > 0 ? "Right" : "Left").a(" brow tail extends about ").i(mm(d)).a(" mm further out."); j.s(t.t); ++c; }
        if (c == 0) j.s("Your natural brows are already closely matched.");
    }
    j.endArr();
    j.endObj();

    j.key("symmetry"); j.obj();
    j.kN("score", clampd(100.0 - 100.0 * F[F_ASYM] / 0.12, 0, 100), 0);
    j.kN("meanOffsetMm", F[F_ASYM] * IPD_MM, 1);
    j.endObj();

    j.key("tips"); j.obj();
    j.key("contour"); tipArr(j, 0); j.key("bronzer"); tipArr(j, 1);
    j.key("blush"); tipArr(j, 2);   j.key("highlight"); tipArr(j, 3);
    j.endObj();
    j.endObj();
    g_json[j.n] = 0;
    return j.n;
}

}  // namespace

// =============================================================================
//  Exported C API (see README for the contract)
// =============================================================================
FM_API float* engine_input_ptr()  { return g_in; }
FM_API float* engine_output_ptr() { return g_out; }
FM_API char*  engine_json_ptr()   { return g_json; }
FM_API int    engine_landmark_count() { return NLM; }
FM_API int    engine_version() { return 102; }

// Start a new scan (forget learned measurements, keep smoothing state).
FM_API void engine_reset() {
    g_featN = 0; g_locked = false; g_shape = 0; g_aInit = false;
}
// 0/2/3 = length / forehead / jaw calibration offsets, 1 = frontal frames per scan
FM_API void engine_set_param(int id, double v) {
    if (id == 0) g_lenBias = clampd(v, -0.4, 0.4);
    else if (id == 1) g_scanTarget = (int)clampd(v, 10, 200);
    else if (id == 2) g_foreBias = clampd(v, -0.2, 0.2);
    else if (id == 3) g_jawBias = clampd(v, -0.2, 0.2);
    else if (id == 4) g_fitY = clampd(v, -0.3, 0.3);
    else if (id == 5) g_fitTop = clampd(v, -0.3, 0.3);
    else if (id == 6) g_fitBot = clampd(v, -0.3, 0.3);
    else if (id == 7) g_fitTail = clampd(v, -0.3, 0.3);
}

// Returns number of floats written to the output buffer, or -1 if no face.
// Output = repeated primitives: [kind, side, sub, n, x0, y0, ... x(n-1), y(n-1)]
FM_API int engine_process(int n, double w, double h, double tMs) {
    if (n < NLM || w <= 0 || h <= 0) { g_valid = false; g_fInit = false; g_outN = 0; return -1; }
    f64 dt = (tMs - g_lastT) / 1000.0;
    if (!g_fInit || dt <= 0 || dt > 0.5) { g_fInit = false; dt = 1.0 / 30.0; }
    g_lastT = tMs;
    updateFilter(n, w, h, dt);
    if (!buildFrame()) { g_valid = false; g_outN = 0; return -1; }

    g_blink = (0.5 * (eyeOpen(0) + eyeOpen(1))) < 0.12;
    blendAnchors(absd(g_yaw) < 30 && !g_blink ? 0.12 : 0.0);

    computeFeatures(g_cur);
    if (!g_locked && (g_frontal || g_featN == 0) && !g_blink) {
        f64 al = g_featN < 20 ? 1.0 / (g_featN + 1) : 0.05;
        if (g_featN == 0) for (int i = 0; i < NF; ++i) g_feat[i] = g_cur[i];
        else for (int i = 0; i < NF; ++i) g_feat[i] += al * (g_cur[i] - g_feat[i]);
        if (g_frontal) { ++g_featN; if (g_featN >= g_scanTarget) g_locked = true; }
    }
    const f64* F = g_featN > 0 ? g_feat : g_cur;
    classifyShape(F);

    g_valid = true;
    g_outN = 0;
    buildTemplate();
    for (int sd = 0; sd < 2; ++sd) { emitBrowTarget(sd); emitBrowAngular(sd); emitBrowMapSide(sd); }
    emitBrowMapCenter();
    emitZones(F);
    return g_outN;
}

// Builds the JSON analysis report; returns its length.
FM_API int engine_report() { return buildReport(); }
