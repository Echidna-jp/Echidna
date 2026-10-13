/**
 * 木偶摆动（类似 Wallpaper Engine 场景壁纸的「木偶变形」）
 * ------------------------------------------------------------
 * 每个区域 = 根部 pivot（固定）+ 摆动中心 center + 影响半径 radius。
 * 着色器里对区域内像素做轻微位移：离根部越远摆幅越大，并带「从根到梢」的波动延迟，
 * 看起来像柔软的发丝/衣袖被微风吹动。这里负责把配置打包成着色器 uniform。
 */
(function (SW) {
  'use strict';
  const { TAU, wrapPhase, clamp } = SW.math;

  const MAX_ZONES = 8;
  const phases = new WeakMap(); // 每个区域独立累加相位：改速度/阵风时不会跳变

  function createPack(max) {
    return {
      max,
      count: 0,
      A: new Float32Array(max * 4), // pivot.xy, center.xy（插画 UV）
      B: new Float32Array(max * 4), // 半径, 羽化, 摆幅, 波动
      C: new Float32Array(max * 4), // 摆动方向.xy（宽高比空间单位向量）, 相位1, 相位2
      D: new Float32Array(max * 4), // 顺风倾斜, 二次谐波比例, -, -
    };
  }

  // 摆动方向：垂直于「根部→中心」，再按 angle 偏转。返回宽高比空间的单位向量
  function zoneDir(zone, aspect) {
    const ax = (zone.center[0] - zone.pivot[0]) * aspect;
    const ay = zone.center[1] - zone.pivot[1];
    const len = Math.hypot(ax, ay) || 1;
    const px = -ay / len;
    const py = ax / len;
    const a = ((zone.angle || 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [px * c - py * s, px * s + py * c];
  }

  function pack(cfg, dt, wind, aspect, out) {
    const pc = cfg.puppet;
    out.count = 0;
    if (!pc.enabled || !pc.zones) return out;
    const gustAmp = 1 + pc.windResponse * wind.gust * 1.5;
    for (const z of pc.zones) {
      if (z.enabled === false) continue;
      if (out.count >= out.max) break;
      let ph = phases.get(z);
      if (!ph) {
        ph = { p1: 0, p2: 1.3 };
        phases.set(z, ph);
      }
      const f = TAU * (z.speed || 0.2) * pc.speed * (1 + wind.gust * 0.35);
      ph.p1 = wrapPhase(ph.p1 + f * dt);
      ph.p2 = wrapPhase(ph.p2 + f * 2.13 * dt);

      const dir = zoneDir(z, aspect);
      const i = out.count * 4;
      out.A[i] = z.pivot[0];
      out.A[i + 1] = z.pivot[1];
      out.A[i + 2] = z.center[0];
      out.A[i + 3] = z.center[1];
      out.B[i] = Math.max(0.001, z.radius);
      out.B[i + 1] = clamp(z.feather == null ? 0.35 : z.feather, 0, 0.95);
      out.B[i + 2] = (z.amplitude || 0) * pc.strength * gustAmp;
      out.B[i + 3] = z.wave == null ? 1.5 : z.wave;
      out.C[i] = dir[0];
      out.C[i + 1] = dir[1];
      out.C[i + 2] = wrapPhase(ph.p1 + (z.phase || 0));
      out.C[i + 3] = wrapPhase(ph.p2 + (z.phase || 0) * 2.13);
      // 顺风倾斜：沿摆动方向的水平分量顺着风向偏
      const lean = pc.windResponse * (z.lean == null ? 0.5 : z.lean) * wind.value * 0.5;
      out.D[i] = dir[0] >= 0 ? lean : -lean;
      out.D[i + 1] = 0.2;
      out.count++;
    }
    return out;
  }

  SW.puppet = { MAX_ZONES, createPack, pack, zoneDir };
})((window.SW = window.SW || {}));
