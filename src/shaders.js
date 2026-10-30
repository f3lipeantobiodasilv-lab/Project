const GLOBALS = /* glsl */ `
layout(std140) uniform Globals {
  vec4 uResolutionTime; // full width, full height, time, frame
  vec4 uSun;            // x, y, intensity, aspect
  vec4 uAtmosphere;     // fog, cloud coverage, wind, exposure
  vec4 uLighting;       // SSR, AO, bloom, debug view
  vec4 uQuality;        // fog steps, cloud slices, render scale, SSR steps
  vec4 uFlags;          // SSR, fog, clouds, denoise
};
`;

const NOISE_2D = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    value += noise2(p) * amplitude;
    p = rotation * p * 2.03 + 7.1;
    amplitude *= 0.48;
  }
  return value;
}
`;

// Ciclo dia/noite compartilhado entre o G-Buffer (céu/disco solar) e o
// lighting pass (PBR, SSR, nuvens e raymarch do fog).
// NOTA DE ADAPTAÇÃO: neste projeto não existe `u_sunPosition` (vec3 de
// direção); o sol é `uSun.xy`, uma *posição* screen-space em [0,1] escrita
// pela Engine2D no UBO. `normalize(uSun.xy).y` seria sempre > 0 e a noite
// nunca chegaria — por isso a elevação é a altura normalizada dessa
// posição em relação ao horizonte da cena (terrainHeight ≈ 0.245).
const SUN_CYCLE = /* glsl */ `
const float SUN_HORIZON_Y = 0.245;
float computeSunElevation() {
  // 0 no horizonte, ~+1 no topo da tela, negativo abaixo do horizonte.
  return (uSun.y - SUN_HORIZON_Y) / (1.0 - SUN_HORIZON_Y);
}
float sunDayFactor() {
  // Fade suave do crepúsculo: 1 em dia pleno, 0 em noite fechada.
  return smoothstep(-0.15, 0.05, computeSunElevation());
}
float sunDirectFactor() {
  // Luz direta/especular: zero garantido com o sol abaixo do horizonte.
  return smoothstep(0.0, 0.08, computeSunElevation());
}
vec3 sunTint(float elevation) {
  // Sol avermelhado perto do horizonte, quente/alaranjado em dia pleno.
  return mix(vec3(1.0, 0.30, 0.09), vec3(1.0, 0.69, 0.43), smoothstep(0.0, 0.35, elevation));
}
`;

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GEOMETRY_VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec4 iRect;
layout(location = 2) in vec4 iColor;
layout(location = 3) in vec4 iMaterial;
layout(location = 4) in vec4 iParams;
${GLOBALS}
out vec2 vUv;
out vec2 vWorld;
out vec4 vColor;
out vec4 vMaterial;
out vec4 vParams;
void main() {
  vec2 local = aPosition - 0.5;
  float angle = iParams.x;
  float c = cos(angle);
  float s = sin(angle);
  vec2 offset = mat2(c, s, -s, c) * (local * iRect.zw);
  vec2 world = iRect.xy + offset;
  if (iMaterial.w > 3.5 && iMaterial.w < 4.5) {
    world.y += sin(uResolutionTime.z * 0.85 + iParams.y) * 0.005;
    world.x += sin(uResolutionTime.z * 0.31) * 0.002;
  }
  vUv = aPosition;
  vWorld = world;
  vColor = iColor;
  vMaterial = iMaterial;
  vParams = iParams;
  gl_Position = vec4(world * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GEOMETRY_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vWorld;
in vec4 vColor;
in vec4 vMaterial;
in vec4 vParams;
${GLOBALS}
${NOISE_2D}
${SUN_CYCLE}
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormalMaterial;
layout(location = 2) out vec4 outDepth;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float shipDistance(vec2 p) {
  float hull = sdRoundBox(p - vec2(-0.02, -0.015), vec2(0.68, 0.17), 0.09);
  float nose = sdRoundBox(p - vec2(0.52, 0.005), vec2(0.23, 0.125), 0.07);
  float cabin = sdRoundBox(p - vec2(0.08, 0.15), vec2(0.29, 0.12), 0.055);
  float tail = sdRoundBox(p - vec2(-0.57, 0.12), vec2(0.12, 0.23), 0.035);
  float keel = sdRoundBox(p - vec2(-0.08, -0.15), vec2(0.43, 0.075), 0.025);
  return min(min(hull, nose), min(min(cabin, tail), keel));
}
float terrainHeight(float x) {
  float h = 0.245 + sin(x * 9.0 + 0.4) * 0.026 + sin(x * 21.0) * 0.014;
  h += (noise2(vec2(x * 12.0, 1.7)) - 0.5) * 0.024;
  float craterA = (x - 0.37) / 0.075;
  float craterB = (x - 0.72) / 0.055;
  h -= exp(-craterA * craterA * 2.0) * 0.026;
  h -= exp(-craterB * craterB * 2.0) * 0.019;
  h += exp(-pow(abs(craterA) - 1.0, 2.0) * 7.0) * 0.008;
  return h;
}

void main() {
  float type = vMaterial.w;
  vec3 color = vColor.rgb;
  vec2 normal = vec2(0.0, 0.2);
  float roughness = vMaterial.x;
  float metallic = vMaterial.y;
  float emission = vMaterial.z;
  float depth = vParams.z;

  if (type < 0.5) {
    float y = vWorld.y;
    float sunElevation = computeSunElevation();
    float dayFactor = smoothstep(-0.15, 0.05, sunElevation);
    // B.3 — fundo: gradiente diurno ↔ fundo noturno conforme o dayFactor.
    vec3 horizon = mix(vec3(0.022, 0.026, 0.048), vec3(0.38, 0.165, 0.105), dayFactor);
    vec3 middle = mix(vec3(0.007, 0.011, 0.027), vec3(0.115, 0.125, 0.205), dayFactor);
    vec3 zenith = mix(vec3(0.002, 0.004, 0.012), vec3(0.020, 0.038, 0.088), dayFactor);
    color = mix(horizon, middle, smoothstep(0.12, 0.52, y));
    color = mix(color, zenith, smoothstep(0.48, 0.98, y));
    float haze = fbm2(vWorld * vec2(3.0, 5.0) + vec2(0.0, uResolutionTime.z * 0.003));
    color += vec3(0.055, 0.025, 0.035) * haze * (1.0 - y) * mix(0.04, 0.55, dayFactor);

    vec2 starGrid = vWorld * vec2(330.0, 190.0);
    vec2 starCell = floor(starGrid);
    vec2 starUv = fract(starGrid) - 0.5;
    float starSeed = hash12(starCell);
    float star = step(0.993, starSeed) * (1.0 - smoothstep(0.015, 0.11, length(starUv)));
    star *= smoothstep(0.42, 0.78, y);
    // Estrelas são emissivas: somem de dia e voltam a brilhar à noite.
    star *= mix(1.0, 0.12, dayFactor);
    color += star * mix(vec3(0.35, 0.48, 0.75), vec3(0.9, 0.74, 0.58), hash12(starCell + 4.0));
    emission = star * 0.45;

    float sunDistance = length((vWorld - uSun.xy) * vec2(uSun.w, 1.0));
    float sunDisc = 1.0 - smoothstep(0.008, 0.012, sunDistance);
    // O disco desvanece ao longo do crepúsculo e some na noite fechada,
    // avermelhando enquanto cruza o horizonte.
    float sunVisibility = dayFactor;
    vec3 sunDiscColor = mix(vec3(1.0, 0.32, 0.10), vec3(1.0, 0.86, 0.61), smoothstep(0.02, 0.4, sunElevation));
    color = mix(color, sunDiscColor, sunDisc * sunVisibility);
    emission = max(emission, sunDisc * sunVisibility);
    normal = vec2(0.0);
    roughness = 1.0;
    metallic = 0.0;
    depth = 1.0;
  } else if (type < 1.5) {
    float x = vWorld.x;
    float ridge = 0.36 + noise2(vec2(x * 4.2, vParams.y)) * 0.12;
    ridge += sin(x * 15.0 + 1.4) * 0.018 + sin(x * 31.0) * 0.009;
    if (vWorld.y > ridge) discard;
    float strata = noise2(vWorld * vec2(19.0, 32.0));
    color = vColor.rgb * mix(0.52, 1.0, strata);
    color *= mix(0.65, 1.05, smoothstep(0.08, ridge, vWorld.y));
    float derivative = (noise2(vec2((x + 0.002) * 4.2, vParams.y)) - noise2(vec2((x - 0.002) * 4.2, vParams.y))) * 0.12 / 0.004;
    normal = normalize(vec2(-derivative * 0.18, 1.0));
    depth = 0.86;
  } else if (type < 2.5) {
    float height = terrainHeight(vWorld.x);
    if (vWorld.y > height) discard;
    float derivative = (terrainHeight(vWorld.x + 0.0015) - terrainHeight(vWorld.x - 0.0015)) / 0.003;
    float grit = fbm2(vWorld * vec2(65.0, 90.0));
    float strata = sin(vWorld.y * 175.0 + noise2(vWorld * 17.0) * 7.0) * 0.5 + 0.5;
    color = mix(vec3(0.115, 0.045, 0.026), vColor.rgb, 0.48 + grit * 0.52);
    color *= 0.76 + strata * 0.14;
    color += vec3(0.11, 0.047, 0.018) * smoothstep(height - 0.045, height, vWorld.y);
    float pebble = step(0.985, hash12(floor(vWorld * vec2(560.0, 330.0))));
    color += pebble * vec3(0.12, 0.08, 0.05);
    normal = normalize(vec2(-derivative * 0.3 + (grit - 0.5) * 0.34, 1.0));
    roughness = 0.88;
    depth = 0.48;
  } else if (type < 3.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float angle = atan(p.y, p.x);
    float edge = 0.79 + sin(angle * 5.0 + vParams.y) * 0.075 + sin(angle * 9.0 - vParams.y) * 0.035;
    float distanceToEdge = length(p) - edge;
    if (distanceToEdge > 0.0) discard;
    float rockNoise = fbm2(vUv * 7.0 + vParams.y);
    color = vColor.rgb * (0.64 + rockNoise * 0.65);
    color *= 0.84 + max(p.y, 0.0) * 0.18;
    normal = normalize(p * 0.72 + vec2((rockNoise - 0.5) * 0.3, 0.55));
    roughness = 0.84;
    depth = vParams.z;
  } else if (type < 4.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float d = shipDistance(p);
    if (d > 0.0) discard;
    vec2 e = vec2(0.003, 0.0);
    vec2 gradient = vec2(
      shipDistance(p + e.xy) - shipDistance(p - e.xy),
      shipDistance(p + e.yx) - shipDistance(p - e.yx)
    );
    gradient = normalize(gradient + vec2(0.00001));
    float bevel = smoothstep(-0.19, -0.005, d);
    normal = normalize(mix(vec2(p.x * 0.08, 0.32), -gradient, bevel * 0.82));

    float brushed = noise2(vec2(vUv.x * 12.0, vUv.y * 150.0));
    color = vColor.rgb * (0.73 + brushed * 0.23);
    color *= 0.82 + vUv.y * 0.25;
    float lowerHull = 1.0 - smoothstep(-0.13, -0.04, p.y);
    color = mix(color, vec3(0.105, 0.12, 0.135), lowerHull * 0.78);
    float orangeStripe = 1.0 - smoothstep(0.025, 0.045, abs(p.x + 0.31));
    color = mix(color, vec3(0.85, 0.235, 0.065), orangeStripe * 0.9);
    float panelLine = 1.0 - smoothstep(0.008, 0.018, abs(fract((p.x + 0.8) * 3.4) - 0.5));
    color *= 1.0 - panelLine * 0.13;

    float canopy = sdRoundBox(p - vec2(0.1, 0.17), vec2(0.245, 0.082), 0.04);
    if (canopy < 0.0 && p.y > 0.12) {
      float glassGradient = clamp((p.x + 0.2) * 1.4, 0.0, 1.0);
      color = mix(vec3(0.018, 0.09, 0.12), vec3(0.08, 0.34, 0.4), glassGradient);
      float windowFrame = 1.0 - smoothstep(0.008, 0.02, abs(p.x - 0.08));
      color *= 1.0 - windowFrame * 0.75;
      emission = 0.14 + max(0.0, p.y - 0.18) * 1.6;
      roughness = 0.12;
      metallic = 0.42;
    }
    float navigationLamp = 1.0 - smoothstep(0.025, 0.05, length(p - vec2(-0.65, 0.25)));
    color = mix(color, vec3(1.0, 0.19, 0.045), navigationLamp);
    emission = max(emission, navigationLamp);
    roughness = mix(0.26, 0.18, brushed);
    metallic = 0.88;
    depth = 0.16;
  } else if (type < 5.5) {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRoundBox(p, vec2(0.84, 0.71), 0.035);
    if (d > 0.0) discard;
    vec2 grid = abs(fract(vUv * vec2(6.0, 4.0)) - 0.5);
    float gridLine = smoothstep(0.44, 0.485, max(grid.x, grid.y));
    float frame = 1.0 - smoothstep(0.0, 0.09, abs(d));
    color = mix(vColor.rgb * (0.55 + vUv.y * 0.35), vec3(0.2, 0.38, 0.48), gridLine * 0.55);
    color = mix(color, vec3(0.33, 0.35, 0.34), frame);
    normal = normalize(vec2(p.x * 0.07, 0.28 + p.y * 0.06));
    roughness = mix(vMaterial.x, 0.36, gridLine);
    metallic = vMaterial.y;
    depth = vParams.z;
  } else {
    vec2 p = vUv * 2.0 - 1.0;
    float d = sdRoundBox(p, vec2(0.77, 0.67), 0.08);
    if (d > 0.0) discard;
    float edge = 1.0 - smoothstep(0.0, 0.11, abs(d));
    float strap = 1.0 - smoothstep(0.07, 0.11, abs(p.x + 0.15));
    color = vColor.rgb * (0.76 + vUv.y * 0.24);
    color = mix(color, vec3(0.12, 0.13, 0.13), strap * 0.75);
    color = mix(color, vec3(0.4, 0.38, 0.32), edge * 0.55);
    float lamp = 0.0;
    if (vParams.w > 1.5) {
      lamp = 1.0 - smoothstep(0.07, 0.12, length(p - vec2(0.38, 0.28)));
      color = mix(color, vec3(1.0, 0.32, 0.06), lamp);
    }
    emission = lamp;
    normal = normalize(vec2(p.x * 0.15, 0.35 + p.y * 0.08));
    roughness = vMaterial.x;
    metallic = vMaterial.y;
    depth = vParams.z;
  }

  outAlbedo = vec4(clamp(color, 0.0, 1.0), clamp(emission, 0.0, 1.0));
  outNormalMaterial = vec4(clamp(normal * 0.5 + 0.5, 0.0, 1.0), clamp(roughness, 0.03, 1.0), clamp(metallic, 0.0, 1.0));
  outDepth = vec4(depth, 0.0, 0.0, 1.0);
}
`;

export const LIGHTING_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
${GLOBALS}
${NOISE_2D}
${SUN_CYCLE}
uniform sampler2D tAlbedo;
uniform sampler2D tNormalMaterial;
uniform sampler2D tDepth;
layout(location = 0) out vec4 outColor;
const float PI = 3.14159265359;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}
float fbm3(vec3 p) {
  float value = noise3(p) * 0.62;
  p = p * 2.03 + vec3(5.2, 1.3, 7.7);
  value += noise3(p) * 0.28;
  p = p * 2.01 + vec3(1.7, 8.3, 2.4);
  value += noise3(p) * 0.10;
  return value;
}
vec3 decodeNormal(vec2 encoded) {
  vec2 xy = encoded * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.025, 1.0 - dot(xy, xy))));
}
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
float blueNoise(vec2 pixel) {
  // Interleaved gradient noise: low-discrepancy jitter without an extra texture.
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

float screenShadow(vec2 uv, float depth, vec2 lightDir) {
  float occlusion = 0.0;
  for (int i = 1; i <= 8; i++) {
    float distanceToSample = float(i) * 0.011;
    vec2 p = uv + lightDir * distanceToSample;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    float sampleDepth = texture(tDepth, p).r;
    float hit = step(sampleDepth, depth - 0.035) * step(0.02, distanceToSample);
    occlusion += hit * (1.0 - float(i) / 10.0);
  }
  return clamp(1.0 - occlusion * 0.24, 0.18, 1.0);
}

float ambientOcclusion(vec2 uv, float depth) {
  vec2 texel = 2.5 / uResolutionTime.xy;
  float d0 = texture(tDepth, uv + vec2(texel.x, 0.0)).r;
  float d1 = texture(tDepth, uv - vec2(texel.x, 0.0)).r;
  float d2 = texture(tDepth, uv + vec2(0.0, texel.y)).r;
  float d3 = texture(tDepth, uv - vec2(0.0, texel.y)).r;
  float occ = step(d0, depth - 0.025) + step(d1, depth - 0.025) + step(d2, depth - 0.025) + step(d3, depth - 0.025);
  return 1.0 - occ * 0.075 * uLighting.y;
}

float cloudField(vec2 p, float slice) {
  float time = uResolutionTime.z;
  vec2 wind = vec2(time * 0.011, -time * 0.002) * uAtmosphere.z;
  vec3 q = vec3((p + wind) * vec2(3.4 * uSun.w, 5.2), slice * 1.7 + time * 0.009 * uAtmosphere.z);
  float n = fbm3(q);
  float threshold = 1.02 - uAtmosphere.y * 0.69;
  float density = smoothstep(threshold, threshold + 0.19, n);
  float lowerBand = smoothstep(0.47, 0.57, p.y);
  float upperBand = 1.0 - smoothstep(0.87, 1.02, p.y);
  return density * lowerBand * upperBand;
}

float cloudGroundShadow(vec2 uv) {
  vec2 projected = uv + vec2(0.035, 0.22);
  float density = cloudField(projected, 0.15) * 0.55;
  density += cloudField(projected + vec2(0.018, 0.07), 0.48) * 0.3;
  density += cloudField(projected + vec2(0.03, 0.13), 0.82) * 0.15;
  return clamp(density * 1.7, 0.0, 0.78);
}

vec4 cloudLayer(vec2 uv, vec2 lightDir, float jitter) {
  if (uv.y < 0.46 || uv.y > 1.01) return vec4(0.0);
  // Sem sol acima do horizonte, a nuvem vira silhueta sobre o céu noturno.
  float cloudDayFactor = sunDayFactor();
  vec3 cloudSunColor = sunTint(computeSunElevation());
  float transmittance = 1.0;
  vec3 scattering = vec3(0.0);
  int slices = int(uQuality.y + 0.5);
  for (int i = 0; i < 8; i++) {
    if (i >= slices) break;
    float slice = (float(i) + jitter) / float(slices);
    float density = cloudField(uv, slice) * 0.62;
    if (density > 0.006) {
      float lightDensity = cloudField(uv + lightDir * 0.025, slice + 0.09);
      lightDensity += cloudField(uv + lightDir * 0.055, slice + 0.18) * 0.65;
      float lightTransmittance = exp(-lightDensity * 2.25);
      vec3 shadowColor = mix(vec3(0.006, 0.009, 0.020), vec3(0.095, 0.105, 0.15), cloudDayFactor);
      vec3 litColor = mix(vec3(0.010, 0.016, 0.034), cloudSunColor * 0.78, cloudDayFactor);
      vec3 cloudColor = mix(shadowColor, litColor, lightTransmittance);
      float alpha = 1.0 - exp(-density * 0.78);
      scattering += transmittance * alpha * cloudColor;
      transmittance *= 1.0 - alpha;
    }
    if (transmittance < 0.01) break;
  }
  return vec4(scattering, 1.0 - transmittance);
}

float fogDensity(vec2 p) {
  vec2 wind = vec2(uResolutionTime.z * 0.018, uResolutionTime.z * 0.004) * uAtmosphere.z;
  // Three 2D fBm octaves cost less than the 3D cloud field.
  float n = fbm2((p + wind) * vec2(5.0 * uSun.w, 8.0) + uResolutionTime.z * 0.006);
  float lowAltitude = 1.0 - smoothstep(0.2, 0.68, p.y);
  float wisps = smoothstep(0.28, 0.79, n);
  return (wisps * lowAltitude * 1.75 + 0.018) * uAtmosphere.x;
}

vec4 integrateFog(vec2 uv, vec2 lightDir, float sunDistance, float jitter) {
  // B — o scattering acumulado é atenuado pelo ciclo: à noite o
  // Rayleigh/Mie solar zera e resta só um resíduo de luar azul-marinho.
  float fogDayFactor = sunDayFactor();
  float fogIrradiance = mix(0.035, uSun.z, fogDayFactor);
  int steps = int(uQuality.x + 0.5);
  float rayLength = min(sunDistance, 0.92);
  float stepLength = rayLength / float(steps);
  float t = stepLength * jitter;
  float transmittance = 1.0;
  vec3 scattering = vec3(0.0);
  for (int i = 0; i < 32; i++) {
    if (i >= steps) break;
    vec2 p = uv + lightDir * t;
    if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
    float density = fogDensity(p);
    // Shorter intervals in dense low-altitude fog, longer intervals above it.
    float interval = stepLength * mix(0.78, 1.28, smoothstep(0.18, 0.7, p.y));
    float extinction = exp(-density * interval * 3.1);
    float attenuation = exp(-1.35 * t);
    vec3 dayFogTint = mix(vec3(0.34, 0.105, 0.055), vec3(0.12, 0.21, 0.38), smoothstep(0.15, 0.75, p.y));
    vec3 fogTint = mix(vec3(0.006, 0.010, 0.024), dayFogTint, fogDayFactor);
    // À noite a fase perde o forward-scattering solar (o "brilho" Mie).
    float phase = mix(0.05, 0.48 + exp(-sunDistance * 3.5) * 1.35, fogDayFactor);
    scattering += transmittance * (1.0 - extinction) * fogTint * attenuation * phase * fogIrradiance;
    transmittance *= extinction;
    t += interval;
    if (transmittance < 0.01) break;
  }
  return vec4(scattering, 1.0 - transmittance);
}

vec4 traceSSR(vec2 uv, vec2 normal, float depth, float roughness, float jitter) {
  vec2 view = normalize(vec2(0.15, 1.0));
  vec2 rayDir = reflect(-view, normal);
  rayDir = normalize(rayDir + vec2(jitter - 0.5, 0.5 - jitter) * roughness * 0.2);
  float stride = 0.022;
  vec2 previous = uv;
  vec2 hitUv = uv;
  float hit = 0.0;
  int steps = int(uQuality.w + 0.5);

  for (int i = 1; i <= 16; i++) {
    if (i > steps) break;
    vec2 p = uv + rayDir * (stride * float(i));
    if (p.x <= 0.005 || p.x >= 0.995 || p.y <= 0.005 || p.y >= 0.995) break;
    float sampleDepth = texture(tDepth, p).r;
    if (abs(sampleDepth - depth) > 0.045 && sampleDepth < 0.95) {
      vec2 a = previous;
      vec2 b = p;
      for (int refinement = 0; refinement < 4; refinement++) {
        vec2 mid = (a + b) * 0.5;
        float midDepth = texture(tDepth, mid).r;
        if (abs(midDepth - depth) > 0.045 && midDepth < 0.95) b = mid;
        else a = mid;
      }
      hitUv = b;
      hit = 1.0;
      break;
    }
    previous = p;
  }
  if (hit < 0.5) return vec4(0.0);

  vec4 hitAlbedo = texture(tAlbedo, hitUv);
  // A parcela solar do reflexo (SSR) morre com o sol; a parcela emissiva
  // (reflexo de lâmpadas/janelas) é preservada para brilhar à noite.
  float ssrDirectFactor = sunDirectFactor();
  vec3 reflected = hitAlbedo.rgb * (0.5 + uSun.z * 0.28) * mix(0.07, 1.0, ssrDirectFactor)
                 + hitAlbedo.rgb * hitAlbedo.a * 2.0;
  vec2 blurDirection = vec2(-rayDir.y, rayDir.x) * roughness * 0.014;
  reflected = reflected * 0.4
    + texture(tAlbedo, hitUv + blurDirection).rgb * 0.15
    + texture(tAlbedo, hitUv - blurDirection).rgb * 0.15
    + texture(tAlbedo, hitUv + blurDirection * 2.0).rgb * 0.15
    + texture(tAlbedo, hitUv - blurDirection * 2.0).rgb * 0.15;
  vec2 border = smoothstep(vec2(0.0), vec2(0.09), hitUv) * (1.0 - smoothstep(vec2(0.91), vec2(1.0), hitUv));
  float fade = border.x * border.y;
  return vec4(reflected, fade);
}

float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float denominator = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denominator * denominator, 0.0001);
}
float geometrySchlick(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = r * r / 8.0;
  return NdotV / (NdotV * (1.0 - k) + k);
}
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
vec3 cookTorrance(vec3 baseColor, vec3 N, vec3 L, vec3 V, float roughness, float metallic, vec3 radiance) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float D = distributionGGX(N, H, roughness);
  float G = geometrySchlick(NdotV, roughness) * geometrySchlick(NdotL, roughness);
  vec3 F0 = mix(vec3(0.04), baseColor, metallic);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  vec3 specular = D * G * F / max(4.0 * NdotV * NdotL, 0.001);
  vec3 diffuse = (1.0 - F) * (1.0 - metallic) * baseColor / PI;
  return (diffuse + specular) * radiance * NdotL;
}

void main() {
  vec2 uv = vUv;
  vec4 albedo = texture(tAlbedo, uv);
  vec4 material = texture(tNormalMaterial, uv);
  float depth = texture(tDepth, uv).r;
  vec2 sunDelta = uSun.xy - uv;
  float sunDistance = max(length(sunDelta * vec2(uSun.w, 1.0)), 0.0001);
  vec2 lightDir = normalize(sunDelta + vec2(0.00001));
  vec3 N = decodeNormal(material.rg);
  vec3 L = normalize(vec3(lightDir, 0.68));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float jitter = fract(blueNoise(gl_FragCoord.xy) + mod(uResolutionTime.w, 8.0) * 0.61803398875);
  vec3 color;
  float ssrMask = 0.0;
  vec3 emissive = vec3(0.0);

  // A — fator dia/noite a partir da elevação solar (ver SUN_CYCLE).
  float sunElevation = computeSunElevation();
  float dayFactor = smoothstep(-0.15, 0.05, sunElevation);
  float directFactor = smoothstep(0.0, 0.08, sunElevation);

  if (depth > 0.96) {
    // O albedo do céu já chega com o mix dia/noite e o disco solar com
    // fade (geometry pass). Aqui só o glow emissivo é escalado: estrelas
    // (albedo.a) continuam acesas à noite, sem halo solar residual.
    color = albedo.rgb + albedo.rgb * albedo.a * mix(0.55, 1.4 + uSun.z * 0.75, dayFactor);
  } else {
    float shadow = screenShadow(uv, depth, lightDir);
    float cloudShadow = uFlags.z > 0.5 ? cloudGroundShadow(uv) : 0.0;
    shadow *= 1.0 - cloudShadow * directFactor;
    vec3 sunColor = sunTint(sunElevation);
    // Luz direta + especular Cook–Torrance zeram abaixo do horizonte.
    vec3 radiance = sunColor * (uSun.z * directFactor) * shadow / (0.9 + sunDistance * 0.25);
    color = cookTorrance(albedo.rgb, N, L, V, material.b, material.a, radiance);
    float ao = ambientOcclusion(uv, depth);
    float skyFacing = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 dayAmbient = mix(vec3(0.055, 0.035, 0.04), vec3(0.09, 0.12, 0.19), skyFacing);
    // Ambiente noturno: apenas um resíduo fraco de luar azul-marinho.
    vec3 nightAmbient = vec3(0.010, 0.016, 0.034) * (0.65 + 0.35 * skyFacing);
    vec3 skyAmbient = mix(nightAmbient, dayAmbient, dayFactor);
    color += albedo.rgb * skyAmbient * ao * mix(0.85, 1.5, dayFactor);
    // C — o emissivo é apenas *separado* aqui; ele é somado no fim do
    // pass, depois de nuvens/fog, para nunca ser atenuado pelo ciclo.
    emissive = albedo.rgb * albedo.a * 3.2;

    if (uFlags.x > 0.5 && uLighting.x > 0.001 && (material.a > 0.08 || material.b < 0.35)) {
      vec4 ssr = traceSSR(uv, N.xy, depth, material.b, jitter);
      float weight = uLighting.x * (1.0 - material.b * 0.72) * mix(0.12, 0.72, material.a);
      float fresnel = 0.35 + 0.65 * pow(1.0 - max(N.z, 0.0), 2.0);
      ssrMask = clamp(ssr.a * weight * fresnel, 0.0, 0.82);
      color = mix(color, ssr.rgb, ssrMask);
    }
  }

  if (uFlags.z > 0.5 && uAtmosphere.y > 0.001) {
    vec4 clouds = cloudLayer(uv, lightDir, jitter);
    color = color * (1.0 - clouds.a * 0.68) + clouds.rgb;
  }

  if (uFlags.y > 0.5 && uAtmosphere.x > 0.001) {
    vec4 fog = integrateFog(uv, lightDir, sunDistance, jitter);
    color *= 1.0 - fog.a * 0.4;
    color += fog.rgb;
    float outerGlow = exp(-sunDistance * 5.5) * uAtmosphere.x;
    float innerGlow = exp(-sunDistance * 15.0) * uAtmosphere.x;
    color += vec3(0.055, 0.105, 0.23) * outerGlow * (uSun.z * dayFactor) * 0.34;
    color += vec3(0.55, 0.24, 0.09) * innerGlow * (uSun.z * dayFactor) * 0.24;
  }

  // C — emissivo por último: naves, lâmpadas e janelas seguem brilhando
  // no escuro total, sem passar pelo fade do fog/nuvens acima.
  color += emissive;

  outColor = vec4(max(color, 0.0), ssrMask);
}
`;

export const DENOISE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
${GLOBALS}
uniform sampler2D tColor;
uniform sampler2D tNormalMaterial;
uniform sampler2D tDepth;
layout(location = 0) out vec4 outColor;

vec3 decodeNormal(vec2 encoded) {
  vec2 xy = encoded * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.025, 1.0 - dot(xy, xy))));
}
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec2 uv = vUv;
  vec2 texel = 1.0 / max(uResolutionTime.xy * uQuality.z, vec2(1.0));
  vec4 center = texture(tColor, uv);
  float centerDepth = texture(tDepth, uv).r;
  vec3 centerNormal = decodeNormal(texture(tNormalMaterial, uv).rg);
  float centerLuma = luminance(center.rgb);
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 sampleUv = uv + offset * texel;
      float sampleDepth = texture(tDepth, sampleUv).r;
      vec3 sampleNormal = decodeNormal(texture(tNormalMaterial, sampleUv).rg);
      float depthDelta = abs(sampleDepth - centerDepth);
      float normalAlignment = dot(sampleNormal, centerNormal);
      if (depthDelta > 0.055 || normalAlignment < 0.52) continue;
      float spatialWeight = exp(-dot(offset, offset) * 0.24);
      float depthWeight = exp(-depthDelta * depthDelta * 950.0);
      float normalWeight = pow(max(normalAlignment, 0.0), 18.0);
      vec4 sampleColor = texture(tColor, sampleUv);
      float colorWeight = exp(-abs(luminance(sampleColor.rgb) - centerLuma) * 0.75);
      float weight = spatialWeight * depthWeight * normalWeight * colorWeight;
      sum += sampleColor * weight;
      weightSum += weight;
    }
  }
  outColor = weightSum > 0.0001 ? sum / weightSum : center;
}
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
${GLOBALS}
${NOISE_2D}
uniform sampler2D tColor;
uniform sampler2D tAlbedo;
uniform sampler2D tNormalMaterial;
uniform sampler2D tDepth;
layout(location = 0) out vec4 outColor;

vec3 decodeNormal(vec2 encoded) {
  vec2 xy = encoded * 2.0 - 1.0;
  return vec3(xy, sqrt(max(0.025, 1.0 - dot(xy, xy))));
}
vec3 aces(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  int view = int(uLighting.w + 0.5);
  vec3 color;
  if (view == 1) {
    vec4 albedo = texture(tAlbedo, vUv);
    color = pow(albedo.rgb + albedo.rgb * albedo.a * 0.5, vec3(1.0 / 2.2));
  } else if (view == 2) {
    color = decodeNormal(texture(tNormalMaterial, vUv).rg) * 0.5 + 0.5;
  } else if (view == 3) {
    float depth = texture(tDepth, vUv).r;
    float value = 1.0 - depth;
    color = mix(vec3(0.018, 0.025, 0.045), vec3(0.88, 0.31, 0.12), pow(value, 0.55));
    float contour = 1.0 - smoothstep(0.0, 0.08, abs(fract(depth * 18.0) - 0.5));
    color += contour * 0.055;
  } else {
    vec2 texel = 1.0 / max(uResolutionTime.xy * uQuality.z, vec2(1.0));
    color = texture(tColor, vUv).rgb;
    vec3 bloom = vec3(0.0);
    bloom += max(texture(tColor, vUv + vec2(texel.x * 3.0, 0.0)).rgb - 0.7, 0.0);
    bloom += max(texture(tColor, vUv - vec2(texel.x * 3.0, 0.0)).rgb - 0.7, 0.0);
    bloom += max(texture(tColor, vUv + vec2(0.0, texel.y * 3.0)).rgb - 0.7, 0.0);
    bloom += max(texture(tColor, vUv - vec2(0.0, texel.y * 3.0)).rgb - 0.7, 0.0);
    color += bloom * uLighting.z * 0.25;
    color = aces(color * uAtmosphere.w);
    color = pow(color, vec3(1.0 / 2.2));
    vec2 centered = (vUv - 0.5) * vec2(0.82, 1.0);
    float vignette = 1.0 - dot(centered, centered) * 0.52;
    color *= vignette;
    float grain = hash12(gl_FragCoord.xy + mod(uResolutionTime.w, 16.0)) - 0.5;
    color += grain * 0.011;
  }
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
