/* 数学工具：随机、噪声、插值、与帧率无关的平滑 */
(function (SW) {
  'use strict';

  const TAU = Math.PI * 2;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(a, b, v) {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function range(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  // 1D 值噪声，输出 [-1, 1]，连续且平滑
  function hash1(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
  }

  // 两个八度的分形噪声，输出约 [-1, 1]
  function fbm1(x) {
    return noise1(x) * 0.67 + noise1(x * 2.13 + 17.3) * 0.33;
  }

  // 指数阻尼：current 以 lambda 速率趋近 target，结果与帧率无关
  function damp(current, target, lambda, dt) {
    return lerp(current, target, 1 - Math.exp(-lambda * dt));
  }

  // 把相位包裹到 [0, TAU)，避免长时间运行后着色器里的浮点精度丢失
  function wrapPhase(p) {
    p %= TAU;
    return p < 0 ? p + TAU : p;
  }

  SW.math = { TAU, clamp, lerp, smoothstep, range, pick, noise1, fbm1, damp, wrapPhase };
})((window.SW = window.SW || {}));
