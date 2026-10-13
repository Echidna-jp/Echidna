/**
 * 镜头：呼吸缩放 + 鼠标视差 + 自动漂移，以及「屏幕 ↔ 插画」坐标映射。
 * 所有图层共用同一个镜头，按各自的视差倍率（factor）位移，从而产生分层纵深。
 */
(function (SW) {
  'use strict';
  const { TAU, clamp, damp, lerp } = SW.math;

  class Camera {
    constructor() {
      this.W = 1;
      this.H = 1;
      this.offset = [0, 0]; // 当前镜头位移（像素，视差倍率 1 的图层）
      this.zoom = 0; // 当前呼吸缩放量
      this.focus = [0.5, 0.5]; // 缩放中心（像素）
      this.parallaxNorm = [0, 0]; // 归一化视差方向，用于深度图
      this.margin = 0; // 插画需要多出来的边距（像素），保证位移时不露边
      this.frozen = false; // 编辑器放置木偶区域时冻结镜头
      this._par = [0, 0];
      this._idle = 1;
      this._breathe = 0;
    }

    resize(W, H) {
      this.W = W;
      this.H = H;
    }

    update(dt, t, cfg, input, maxFactor) {
      const W = this.W;
      const H = this.H;
      const pc = cfg.camera.parallax;
      const bc = cfg.camera.breathe;
      const amt = pc.enabled ? pc.amount * H : 0;

      // —— 视差目标：鼠标 / 无鼠标时的缓慢漂移 ——
      let tx = 0;
      let ty = 0;
      if (amt > 0 && !this.frozen) {
        const mouseActive = pc.mouse && input.inside && input.idleSeconds() < 8;
        this._idle = damp(this._idle, mouseActive ? 0 : 1, 0.5, dt);
        const sgn = pc.invert ? -1 : 1;
        const mx = mouseActive ? clamp(input.x, -1, 1) * sgn : 0;
        const my = mouseActive ? clamp(input.y, -1, 1) * sgn : 0;
        const ix = (Math.sin((t * TAU) / 23) * 0.7 + Math.sin((t * TAU) / 41 + 1.3) * 0.3) * pc.idleDrift;
        const iy = (Math.sin((t * TAU) / 31 + 0.7) * 0.7 + Math.sin((t * TAU) / 53 + 2.1) * 0.3) * pc.idleDrift;
        tx = lerp(mx, ix, this._idle) * amt;
        ty = lerp(my, iy, this._idle) * amt * 0.7;
      }
      const k = Math.max(0.05, pc.smoothing);
      this._par[0] = damp(this._par[0], tx, k, dt);
      this._par[1] = damp(this._par[1], ty, k, dt);
      this.parallaxNorm[0] = amt > 0 ? this._par[0] / amt : 0;
      this.parallaxNorm[1] = amt > 0 ? this._par[1] / amt : 0;

      // —— 呼吸：余弦缓入缓出 + 极慢平移 ——
      this._breathe = damp(this._breathe, bc.enabled && !this.frozen ? 1 : 0, 1.5, dt);
      const period = Math.max(1, bc.period);
      this.zoom = this._breathe * bc.zoom * (0.5 - 0.5 * Math.cos((t * TAU) / period));
      const dx = this._breathe * bc.drift * H * Math.sin((t * TAU) / (period * 1.7));
      const dy = this._breathe * bc.drift * H * Math.sin((t * TAU) / (period * 2.3) + 1);

      this.offset[0] = this._par[0] + dx;
      this.offset[1] = this._par[1] + dy;
      this.focus[0] = bc.focus[0] * W;
      this.focus[1] = bc.focus[1] * H;

      // 边距：最大视差 × 最大图层倍率 + 漂移 + 深度视差 + 少量余量
      this.margin = (pc.amount * maxFactor + bc.drift + pc.depth) * H + 2;
    }

    /**
     * 计算某个图层的 UV 映射：imageUV = screenUV * scale + offset（screenUV 左上角为原点）
     * imgW/imgH 只用到比例；cover 方式铺满屏幕并留足边距。
     */
    mapping(cfg, factor, imgW, imgH, out) {
      const W = this.W;
      const H = this.H;
      const m = this.margin;
      const s0 = Math.max((W + 2 * m) / imgW, (H + 2 * m) / imgH);
      const halfW = W / s0 / 2 + m / s0;
      const halfH = H / s0 / 2 + m / s0;
      const fc = cfg.image.focus;
      const cx = clamp(fc[0] * imgW, halfW, Math.max(halfW, imgW - halfW));
      const cy = clamp(fc[1] * imgH, halfH, Math.max(halfH, imgH - halfH));
      const s = s0 * (1 + this.zoom);
      const Fx = this.focus[0];
      const Fy = this.focus[1];
      const fix = cx + (Fx - W / 2) / s0;
      const fiy = cy + (Fy - H / 2) / s0;
      const ox = this.offset[0] * factor;
      const oy = this.offset[1] * factor;
      out.scale[0] = W / (s * imgW);
      out.scale[1] = H / (s * imgH);
      out.offset[0] = (fix - (Fx + ox) / s) / imgW;
      out.offset[1] = (fiy - (Fy + oy) / s) / imgH;
      out.pxScale = s; // 屏幕像素 / 插画像素
      return out;
    }

    // 精灵（屏幕空间）跟随镜头：按视差倍率位移，并随呼吸一起轻微缩放
    projectX(x, factor) {
      return this.focus[0] + (x + this.offset[0] * factor - this.focus[0]) * (1 + this.zoom);
    }

    projectY(y, factor) {
      return this.focus[1] + (y + this.offset[1] * factor - this.focus[1]) * (1 + this.zoom);
    }
  }

  // 用于存放映射结果的小对象（循环复用，避免每帧分配）
  Camera.createMapping = () => ({ scale: [1, 1], offset: [0, 0], pxScale: 1 });

  SW.Camera = Camera;
})((window.SW = window.SW || {}));
