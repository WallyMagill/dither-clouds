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
const float FIELD_GAIN = 4.0;

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

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < ${octaves}; i++) {
    sum += amp * snoise(p * freq);
    freq *= 2.0;   // lacunarity
    amp  *= 0.5;   // gain
  }
  return sum;
}

// Two-level domain warp (Inigo Quilez construction): fbm feeding the
// coordinates of fbm feeding the coordinates of fbm. This is what produces
// curling, folding contours rather than round blobs.
//
// The pointer is injected into the SECOND warp offset only, scaled by a
// radial falloff around the cursor. Adding it to the base coordinate would
// translate the whole image; adding it here with falloff bends the fold
// pattern locally around the cursor, which is the intended effect.
float warpedField(vec2 uv, float t) {
  vec3 p = vec3(uv * uNoiseScale, t);

  vec2 q = vec2(
    fbm(p),
    fbm(p + vec3(5.2, 1.3, 0.0))
  );

  // uPointer arrives in -1..1 element space; uv is aspect-corrected about the
  // center. Convert before comparing them, or the falloff centers on the wrong
  // place on any non-square viewport.
  vec2 pointerUv = uPointer * 0.5 * uResolution / max(uResolution.x, uResolution.y);
  float pointerFalloff = exp(-4.0 * length(uv - pointerUv));
  vec2 pointerBend = uPointer * uPointerStrength * pointerFalloff;

  vec2 r = vec2(
    fbm(p + vec3(uWarpStrength * q + vec2(1.7, 9.2), 0.15 * t)),
    fbm(p + vec3(uWarpStrength * q + vec2(8.3, 2.8) + pointerBend, 0.126 * t))
  );

  return fbm(p + vec3(uWarpDetail * r, 0.0));
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
  // Aspect-corrected, centered coordinates so the field does not stretch on
  // resize. Dividing both axes by the same scalar preserves circles.
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / max(uResolution.x, uResolution.y);

  float field = warpedField(uv, uTime);

  // fbm output is roughly -1..1; map to 0..1 then push contrast so the field
  // resolves into confident islands of light and dark rather than mush.
  float v = clamp(field * FIELD_GAIN * 0.5 + 0.5, 0.0, 1.0);
  v = smoothstep(uContrastLow, uContrastHigh, v);

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
  float grain = hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
  color += grain * uGrain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`
}
