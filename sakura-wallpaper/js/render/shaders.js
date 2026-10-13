/**
 * GLSL 着色器（WebGL1 / GLSL ES 1.00）
 * 渲染管线：
 *   1. 场景：插画图层（呼吸/视差/深度/木偶） + 精灵（花瓣/光斑/光尘） → sceneFBO
 *   2. Bloom：亮部提取 + 双重 Kawase 降采样/升采样（低分辨率，开销很小）
 *   3. 合成：Bloom + 光源光晕 + 光束 + 调色 + 暗角 + 抖动去色带 → 屏幕
 * 想加新的后期效果：在 COMPOSITE 里加一段，或在 webgl-renderer.js 里加一个 pass。
 */
(function (SW) {
  'use strict';

  const FULLSCREEN_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

  // 插画图层：MAX_ZONES 由渲染器按显卡 uniform 上限注入
  const IMAGE_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uDepth;
uniform sampler2D uMask;
uniform vec2 uUvScale;
uniform vec2 uUvOffset;
uniform vec2 uDepthShift;
uniform float uHasDepth;
uniform float uHasMask;
uniform float uAspect;
uniform float uZoneCount;
uniform vec4 uZoneA[MAX_ZONES];
uniform vec4 uZoneB[MAX_ZONES];
uniform vec4 uZoneC[MAX_ZONES];
uniform vec4 uZoneD[MAX_ZONES];
uniform float uDebug;

// 返回宽高比空间中的位移；weight 输出总权重（调试可视化用）
vec2 puppet(vec2 uv, out float weight) {
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = uv * asp;
  vec2 off = vec2(0.0);
  weight = 0.0;
  float m = 1.0;
  if (uHasMask > 0.5) m = texture2D(uMask, uv).r;
  for (int i = 0; i < MAX_ZONES; i++) {
    if (float(i) >= uZoneCount) break;
    vec4 A = uZoneA[i];
    vec4 B = uZoneB[i];
    vec4 C = uZoneC[i];
    vec4 D = uZoneD[i];
    vec2 pivot = A.xy * asp;
    vec2 center = A.zw * asp;
    float d = length(p - center) / B.x;
    float w = 1.0 - smoothstep(B.y, 1.0, d);
    if (w <= 0.0) continue;
    vec2 axis = center - pivot;
    float s = clamp(dot(p - pivot, axis) / max(dot(axis, axis), 1e-6), 0.0, 1.6);
    float lever = pow(s, 1.4);
    // 从根部到末梢的波动延迟 + 二次谐波，避免机械的正弦感
    float sw = sin(C.z - s * B.w) * (1.0 - D.y) + sin(C.w - s * B.w * 2.13) * D.y;
    off += C.xy * (B.z * (sw + D.x) * w * lever * m);
    weight += w * min(lever, 1.0) * m;
  }
  return off;
}

void main() {
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = suv * uUvScale + uUvOffset;
  float weight = 0.0;
  if (uZoneCount > 0.5) uv -= puppet(uv, weight) / vec2(uAspect, 1.0);
  if (uHasDepth > 0.5) uv -= uDepthShift * (texture2D(uDepth, uv).r - 0.5) * 2.0;
  vec4 c = texture2D(uTex, uv);
  if (uDebug > 0.5) c.rgb = mix(c.rgb, vec3(1.0, 0.25, 0.4) * c.a, clamp(weight, 0.0, 1.0) * 0.6);
  gl_FragColor = c;
}`;

  const SPRITE_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
attribute vec4 aColor;
uniform vec2 uResolution;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec2 c = aPos / uResolution * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}`;

  // 预乘 alpha：vColor.rgb = 颜色×不透明度，vColor.a = 不透明度×(1-叠加)
  // 混合方式 ONE, ONE_MINUS_SRC_ALPHA 下，a=0 即为纯相加发光
  const SPRITE_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
}`;

  const BLOOM_DOWN_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform vec2 uThreshold; // x = 阈值, y = 柔和过渡

// 按亮度（而非最大通道）提取：浅粉色系插画整体偏亮，用最大通道会让大片天空都发光
vec3 prefilter(vec3 c) {
  float br = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = uThreshold.y + 1e-4;
  float soft = clamp(br - uThreshold.x + k, 0.0, 2.0 * k);
  soft = soft * soft / (4.0 * k);
  return c * max(soft, br - uThreshold.x) / max(br, 1e-4);
}

void main() {
  vec3 s = texture2D(uTex, vUv).rgb * 4.0;
  s += texture2D(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(uTex, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  s += texture2D(uTex, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  s += texture2D(uTex, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  s *= 0.125;
  if (uPrefilter > 0.5) s = prefilter(s);
  gl_FragColor = vec4(s, 1.0);
}`;

  const BLOOM_UP_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;  // 更小一级（已升采样累积）
uniform sampler2D uBase; // 当前级的降采样结果
uniform vec2 uTexel;     // 1 / 小一级尺寸
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D(uTex, vUv + vec2(-h.x, 0.0)).rgb;
  s += texture2D(uTex, vUv + vec2(h.x, 0.0)).rgb;
  s += texture2D(uTex, vUv + vec2(0.0, -h.y)).rgb;
  s += texture2D(uTex, vUv + vec2(0.0, h.y)).rgb;
  s += texture2D(uTex, vUv + h * vec2(-0.5, -0.5)).rgb * 2.0;
  s += texture2D(uTex, vUv + h * vec2(0.5, -0.5)).rgb * 2.0;
  s += texture2D(uTex, vUv + h * vec2(-0.5, 0.5)).rgb * 2.0;
  s += texture2D(uTex, vUv + h * vec2(0.5, 0.5)).rgb * 2.0;
  gl_FragColor = vec4(s / 12.0 + texture2D(uBase, vUv).rgb, 1.0);
}`;

  const COMPOSITE_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomIntensity;
uniform vec3 uBloomTint;
uniform vec2 uResolution;
uniform vec2 uSunPos;        // 屏幕 UV（左上为原点）
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uSunRadius;
uniform float uRayIntensity;
uniform float uRayDensity;
uniform vec3 uRayPhase;
uniform float uVignette;
uniform float uVignetteRadius;
uniform vec3 uVignetteColor;
uniform vec4 uGrade;         // 亮度, 对比度, 饱和度, 柔雾
uniform vec3 uHazeColor;
uniform float uSeed;

float rand(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
}

vec3 screen(vec3 a, vec3 b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  // 滤色叠加 Bloom：亮部不会被推爆成死白，光晕主要向较暗的周边扩散
  c = screen(c, clamp(texture2D(uBloom, vUv).rgb * uBloomIntensity * uBloomTint, 0.0, 1.0));

  // 光源光晕 + 缓慢转动的柔和光束
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uResolution.x / uResolution.y;
  vec2 d = (suv - uSunPos) * vec2(aspect, 1.0);
  float r = length(d);
  float glow = exp(-(r * r) / max(uSunRadius * uSunRadius, 1e-4)) * uSunIntensity;
  float ang = atan(d.y, d.x + 1e-5);
  float rays = (0.5 + 0.5 * sin(ang * 11.0 * uRayDensity + uRayPhase.x))
             * (0.5 + 0.5 * sin(ang * 17.0 * uRayDensity - uRayPhase.y))
             * (0.6 + 0.4 * sin(ang * 5.0 * uRayDensity + uRayPhase.z));
  rays = pow(rays, 1.5) * exp(-r * 1.3) * smoothstep(0.0, 0.3, r) * uRayIntensity;
  c = screen(c, clamp(uSunColor * (glow + rays), 0.0, 1.0));

  // 梦幻柔雾：以滤色方式整体提亮、降低反差
  c = mix(c, screen(c, uHazeColor * 0.55), uGrade.w);

  // 调色
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.z);
  c = (c - 0.5) * uGrade.y + 0.5 + uGrade.x;

  // 带颜色的暗角（比纯黑更柔和）
  vec2 q = (suv - 0.5) * vec2(1.0, 0.85) * 2.0;
  float v = smoothstep(uVignetteRadius * 0.55, uVignetteRadius * 1.45, length(q));
  c = mix(c, c * uVignetteColor, v * uVignette);

  // 抖动，消除柔和渐变上的色带
  c += (rand(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  SW.shaders = {
    FULLSCREEN_VS,
    IMAGE_FS,
    SPRITE_VS,
    SPRITE_FS,
    BLOOM_DOWN_FS,
    BLOOM_UP_FS,
    COMPOSITE_FS,
  };
})((window.SW = window.SW || {}));
