import { BAYER_8, BAYER_SIZE } from './bayer'
import { MAX_PALETTE_STOPS } from './config'

export const UNIFORM_NAMES = [
  'uResolution',
  'uTime',
  'uPointer',
  'uPalette',
  'uBandCount',
  'uCellSize',
  'uDitherStrength',
  'uNoiseScale',
  'uWarpStrength',
  'uWarpDetail',
  'uPointerStrength',
  'uContrastLow',
  'uContrastHigh',
  'uGrain',
] as const

/**
 * Fullscreen triangle with no vertex buffer. Three vertices covering NDC
 * (-1,-1), (3,-1), (-1,3) — cheaper than a quad and avoids the diagonal seam
 * where two triangles meet.
 */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

// Octave count applies to both the smooth fbm and the billow detail. Four is a
// deliberate balance: the earlier "camouflage" reading came from a high
// noiseScale, not from octave depth, and cutting octaves to fight it also
// removed the fractal detail that makes a cloud edge look like cauliflower
// rather than like a smooth fluid front. Big masses come from a LOW noiseScale;
// bumpy edges come from octave depth. They are separate controls.
export function buildFragmentShader(octaves = 4): string {
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 8) {
    throw new Error(`Octave count must be an integer in 1..8, received ${octaves}`)
  }

  const bayerLiteral = BAYER_8.map((v) => v.toFixed(6)).join(', ')

  return `#version 300 es
precision highp float;
// GLSL ES 3.00 fragment shaders default int to mediump. The Bayer index only
// needs 0..63, but declaring it removes a source of driver variance.
precision highp int;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform vec2  uPointer;
uniform vec3  uPalette[${MAX_PALETTE_STOPS}];
uniform int   uBandCount;
uniform float uCellSize;
uniform float uDitherStrength;
uniform float uNoiseScale;
uniform float uWarpStrength;
uniform float uWarpDetail;
uniform float uPointerStrength;
uniform float uContrastLow;
uniform float uContrastHigh;
uniform float uGrain;

const float BAYER[${BAYER_8.length}] = float[${BAYER_8.length}](${bayerLiteral});

// fbm output is statistically much narrower than its theoretical range: 4 octaves
// at gain 0.5 give an RMS around 0.11, so the raw field maps to v = 0.5 +/- 0.06 and
// the palette bands never separate. This gain expands the field to span roughly
// 0..1 before the contrast window shapes it, which is what gives uContrastLow/High
// meaningful travel instead of crowding all the useful range into a few slider steps.
const float FIELD_GAIN = 1.0;

// How far the tonal range is inset from pure 0 and 1. See the use site in
// main() — this is what keeps a minimum dot density in the lightest and darkest
// regions instead of letting them go flat.
const float TONE_HEADROOM = 0.07;


// ---------------------------------------------------------------------------
// Simplex noise (Ashima Arts / Stefan Gustavson, MIT). 3D so that time can be
// the z axis: drifting through z reads as clouds forming and dissolving, where
// scrolling a 2D field reads as sliding wallpaper.
// ---------------------------------------------------------------------------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Billow noise. Taking the absolute value folds the field at every zero
// crossing, so smooth waves become rounded, outward-bulging lobes. That fold is
// the whole difference between a cumulus puff and a fluid swirl: plain fbm
// curves inward and outward equally, which reads as flow, while |noise| is
// convex almost everywhere, which reads as billowing mass. Normalised by the
// amplitude sum so the result is a predictable 0..1 density.
float billow(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  float norm = 0.0;
  for (int i = 0; i < ${octaves}; i++) {
    sum += amp * abs(snoise(p * freq));
    norm += amp;
    freq *= 2.0;   // lacunarity
    amp  *= 0.5;   // gain
  }
  return sum / norm;
}

// One cloud bank: a deck that fills downward from a scalloped top silhouette.
//
// Two things here are the whole difference between a sky and a noise field.
//
// First, the bank TRANSLATES. Its x coordinate is offset by drift * t and no
// time term is ever fed into the noise itself. Time on the noise z axis morphs the
// field in place, which is exactly what reads as flowing liquid — the shapes
// churn instead of travelling. Sampling a fixed field at a moving offset makes
// each bank a rigid body that crosses the frame and keeps its shape.
//
// Second, the silhouette is billow (|noise|), whose lobes are convex, so the
// top edge scallops into cauliflower bumps the way a cumulus crown does.
float cloudBank(vec2 uv, float baseline, float thick, float scale, float lift,
                float seed, float drift, float t, out float shade) {
  // Rigid horizontal translation. Nothing below depends on t.
  float x = (uv.x - drift * t) * scale + seed;

  // 1D domain warp travelling WITH the bank, so lobe spacing is irregular
  // rather than evenly periodic. It has to ride along; a screen-fixed warp
  // would distort each cloud as it passed through, like wavy glass.
  float wobble = snoise(vec3(x * 0.6, seed, 0.0)) * uWarpStrength * 0.35;

  float top = baseline + lift * billow(vec3(x + wobble, seed * 1.7, 0.0));

  // A band of finite depth, NOT an infinite fill below the silhouette. Filling
  // downward forever means only the topmost bank's edge is ever visible and
  // every bank behind it is hidden, so the whole stack collapses into a single
  // horizon line. The bottom follows the scalloped top and fades out.
  float bottom = top - thick;
  float cov = smoothstep(top, top - 0.085, uv.y)
            * smoothstep(bottom, bottom + 0.16, uv.y);

  // Break the band into discrete puffs so sky, and the banks behind, show
  // through the gaps instead of it reading as a continuous stripe. This has to
  // bite hard: a gentle threshold leaves the nearest bank an unbroken sheet
  // that hides every bank behind it, and the lower half of the frame goes flat.
  float holes = snoise(vec3(x * 1.3, uv.y * scale * 1.3, seed * 3.0));
  cov *= smoothstep(-0.62, 0.24, holes);

  // Self-shadowing. Cumulus are bright along their sunlit crowns and fall into
  // their own shadow underneath; without the gradient the banks read as flat
  // paper cutouts stacked on each other.
  float depthIn = clamp((top - uv.y) * 4.0, 0.0, 1.0);

  // Internal puff structure, from billow so the lobes inside a bank are convex
  // too — this is what keeps a filled region from reading as flat paper. It
  // needs real contrast: a subtle version leaves the foreground a blank sheet
  // no matter how good the silhouette above it is.
  // Frequency matters more than amplitude here. At the near bank's scale a 1.4x
  // multiplier works out to under three features across the whole frame — near
  // enough to constant that the foreground renders as a blank sheet no matter
  // how strong the contrast is.
  float tex = billow(vec3(x * 4.5, uv.y * scale * 4.5, seed * 5.0));
  shade = mix(1.0, 0.44, depthIn) * (0.66 + 0.70 * tex);

  return clamp(cov, 0.0, 1.0);
}

// Cloud density in 0..1, high where cloud is.
//
// The pointer is injected into the warp offset rather than the base coordinate,
// scaled by a radial falloff around the cursor. Adding it to the base would
// translate the whole sky; adding it here bends the cloud edges locally.
float cloudDensity(vec2 uv, float t) {
  // uPointer arrives in -1..1 element space; uv is aspect-corrected about the
  // center. Convert before comparing them, or the falloff centers on the wrong
  // place on any non-square viewport.
  vec2 pointerUv = uPointer * 0.5 * uResolution / max(uResolution.x, uResolution.y);
  float pointerFalloff = exp(-4.0 * length(uv - pointerUv));
  vec2 p = uv + uPointer * uPointerStrength * 0.06 * pointerFalloff;

  // Open sky behind everything. It must stay DARK across the whole frame: sky
  // is the palette's navy end and cloud is its cream end, so the contrast
  // between them is the entire image. Giving this the brighten-toward-the-
  // horizon gradient of a real daytime photo puts bright sky behind bright
  // cloud in the lower frame, and both saturate to cream — the flat foreground.
  float lum = mix(0.20, 0.05, smoothstep(-0.28, 0.42, p.y));

  float n = uNoiseScale;
  float d = uWarpDetail * 2.0;
  float shade;
  float cov;

  // Painter's algorithm, FAR to NEAR. This is a picture with depth, not a
  // single field: each bank is composited over what is already behind it, so
  // nearer clouds genuinely occlude farther ones.
  //
  // Every cue moves together with depth. Farther banks sit HIGHER on screen,
  // have SMALLER features (larger scale multiplier), drift SLOWER (parallax),
  // and blend further toward the sky colour (aerial haze). Break any one of
  // those and the stack flattens back into a texture.
  // Baselines are tuned to the visible uv.y range, which is only about +/-0.27
  // on a landscape viewport because uv is aspect-corrected by the LONG axis.
  // Spacing them wider than that pushes the far bank off the top and lets the
  // near bank fill the whole lower frame as one flat slab.
  cov = cloudBank(p,  0.19, 0.20, 7.30 * n, 0.09 * d, 11.3, 0.025, t, shade);
  lum = mix(lum, mix(lum, shade, 0.42), cov);

  cov = cloudBank(p,  0.11, 0.22, 5.10 * n, 0.11 * d, 27.9, 0.045, t, shade);
  lum = mix(lum, mix(lum, shade, 0.56), cov);

  cov = cloudBank(p,  0.03, 0.24, 3.70 * n, 0.13 * d, 41.2, 0.070, t, shade);
  lum = mix(lum, mix(lum, shade, 0.70), cov);

  cov = cloudBank(p, -0.05, 0.26, 2.60 * n, 0.15 * d, 58.6, 0.100, t, shade);
  lum = mix(lum, mix(lum, shade, 0.82), cov);

  cov = cloudBank(p, -0.13, 0.28, 1.90 * n, 0.17 * d, 73.1, 0.135, t, shade);
  lum = mix(lum, mix(lum, shade, 0.92), cov);

  cov = cloudBank(p, -0.22, 0.34, 1.35 * n, 0.20 * d, 92.4, 0.175, t, shade);
  lum = mix(lum, shade, cov);

  return clamp(lum, 0.0, 1.0);
}

// The Bayer threshold is sampled in DEVICE PIXELS from gl_FragCoord and is
// deliberately independent of uv. That keeps the dot grid nailed to the glass
// while the field moves behind it, which is the entire printed-paper illusion.
// Sampling this in uv space makes the dots swim with the noise and it reads as
// a video filter instead.
float bayer(vec2 fragCoord, float cell) {
  vec2 c = floor(mod(fragCoord / cell, ${BAYER_SIZE}.0));
  int idx = int(c.y) * ${BAYER_SIZE} + int(c.x);
  return BAYER[idx];
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // Snap to the centre of the halftone cell before sampling the field, so the
  // field is evaluated once per cell rather than once per pixel. Both the field
  // and the Bayer threshold are then constant across a cell, which makes every
  // cell a single flat dot — a real halftone. Sampling per pixel instead lets
  // the band comparison flip inside a cell, which produces sub-cell detail and
  // reads as a dithered photograph: shape edges come out smooth instead of
  // stepping along the dot grid the way printed halftone does.
  vec2 cellCoord = (floor(gl_FragCoord.xy / uCellSize) + 0.5) * uCellSize;

  // Aspect-corrected, centered coordinates so the field does not stretch on
  // resize. Dividing both axes by the same scalar preserves circles.
  vec2 uv = (cellCoord - 0.5 * uResolution) / max(uResolution.x, uResolution.y);

  float density = cloudDensity(uv, uTime);

  // Invert: dense cloud is LIGHT (the palette's cream end) and open sky is DARK
  // (its navy end). Then expand around the midpoint — billow output clusters in
  // a narrow band, so without the gain the palette stops never separate.
  float v = clamp((1.0 - density - 0.5) * FIELD_GAIN + 0.5, 0.0, 1.0);
  v = smoothstep(uContrastLow, uContrastHigh, v);

  // smoothstep saturates to exactly 0.0 and 1.0, and a value sitting exactly on
  // a palette stop has no fractional part left for the dither threshold to act
  // on — so the extremes come out perfectly flat. Real halftone print never does
  // that: its lightest areas are paper plus sparse ink, and its darkest are ink
  // plus sparse gaps. Insetting the range keeps a minimum dot density at both
  // ends, which is what makes the whole field read as printed rather than as a
  // posterized photo with clean edges.
  v = mix(TONE_HEADROOM, 1.0 - TONE_HEADROOM, v);

  // Fused ordered dither + palette quantization. Regions well inside a band
  // come out solid; regions near a boundary become a checkerboard of the two
  // neighbouring stops whose dot density tracks how close the value sits to
  // the next stop. This single expression is the whole halftone effect — no
  // separate posterize pass is required.
  float scaled = v * float(uBandCount - 1);
  float lower = floor(scaled);
  float frac = scaled - lower;

  float threshold = 0.5 + (bayer(gl_FragCoord.xy, uCellSize) - 0.5) * uDitherStrength;

  int idx = int(lower) + (frac < threshold ? 0 : 1);
  idx = clamp(idx, 0, min(uBandCount, ${MAX_PALETTE_STOPS}) - 1);

  vec3 color = uPalette[idx];

  // Low-amplitude grain: sells the risograph feel and suppresses banding in
  // flat regions. Offset by time so it shimmers rather than sitting static.
  // Per cell, not per pixel — per-pixel grain would speckle the inside of every
  // dot and undo the flat-cell halftone above.
  float grain = hash12(cellCoord + fract(uTime) * 137.0) - 0.5;
  color += grain * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`
}
