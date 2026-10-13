/**
 * Canvas 2D 渲染器（降级路径）
 * 用于：不支持 WebGL，或浏览器以 file:// 直接打开导致 WebGL 无法读取本地图片时。
 * 保留：呼吸、视差、花瓣、光斑、光尘、光晕、暗角；不含：Bloom、木偶摆动、深度视差。
 */
(function (SW) {
  'use strict';
  const STRIDE = SW.SpriteBatch.STRIDE;

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + a + ')';
  }

  class CanvasRenderer {
    static create(canvas) {
      const ctx = canvas.getContext('2d', { alpha: false });
      return ctx ? new CanvasRenderer(canvas, ctx) : null;
    }

    constructor(canvas, ctx) {
      this.kind = 'canvas2d';
      this.canvas = canvas;
      this.ctx = ctx;
      this.lost = false;
      this.maxZones = 0;
      this.maxTextureSize = 8192;
      this.layers = {};
      this.W = 0;
      this.H = 0;
      this._filter = '';
    }

    setAtlas(canvas) {
      this.atlas = canvas;
    }

    setLayers(layers) {
      this.layers = layers;
    }

    resize(W, H) {
      if (W === this.W && H === this.H) return;
      this.W = W;
      this.H = H;
      this.canvas.width = W;
      this.canvas.height = H;
    }

    _drawLayer(src, map) {
      const iw = src.naturalWidth || src.width;
      const ih = src.naturalHeight || src.height;
      const W = this.W;
      const H = this.H;
      // 屏幕像素 = (插画UV - offset) / scale × 屏幕尺寸
      this.ctx.setTransform(
        W / (map.scale[0] * iw), 0, 0, H / (map.scale[1] * ih),
        (-map.offset[0] / map.scale[0]) * W, (-map.offset[1] / map.scale[1]) * H
      );
      this.ctx.drawImage(src, 0, 0);
    }

    _drawSprites(frame, from, to) {
      const ctx = this.ctx;
      const d = frame.batch.data;
      const cells = frame.cells;
      for (let i = from; i < to; i++) {
        const s = i * STRIDE;
        const cell = cells[d[s]];
        const c = Math.cos(d[s + 5]);
        const sn = Math.sin(d[s + 5]);
        const sx = d[s + 3] / cell.sw;
        const sy = d[s + 4] / cell.sh;
        ctx.globalAlpha = Math.min(1, d[s + 9]);
        ctx.globalCompositeOperation = d[s + 10] > 0.5 ? 'lighter' : 'source-over';
        ctx.setTransform(c * sx, sn * sx, -sn * sy, c * sy, d[s + 1], d[s + 2]);
        ctx.drawImage(this.atlas, cell.sx, cell.sy, cell.sw, cell.sh, -cell.sw / 2, -cell.sh / 2, cell.sw, cell.sh);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    render(frame) {
      const bg = this.layers.background;
      if (!bg) return;
      const ctx = this.ctx;
      const W = this.W;
      const H = this.H;

      // 调色交给 CSS filter（GPU 合成，几乎零开销）
      const g = frame.grade;
      const filter = 'saturate(' + g.saturation.toFixed(2) + ') contrast(' + g.contrast.toFixed(2) + ') brightness(' + (1 + g.brightness + g.haze * 0.08).toFixed(3) + ')';
      if (filter !== this._filter) {
        this.canvas.style.filter = filter;
        this._filter = filter;
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      this._drawLayer(bg, frame.bg);
      const fg = this.layers.foreground;
      if (fg && frame.fg) {
        this._drawSprites(frame, 0, frame.split);
        ctx.globalCompositeOperation = 'source-over';
        this._drawLayer(fg, frame.fg);
        this._drawSprites(frame, frame.split, frame.batch.count);
      } else {
        this._drawSprites(frame, 0, frame.batch.count);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // 光源光晕
      const sun = frame.sun;
      if (sun.intensity > 0) {
        const sx = sun.pos[0] * W;
        const sy = sun.pos[1] * H;
        const r = sun.radius * H * 1.6;
        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0, rgba(sun.color, Math.min(1, sun.intensity)));
        grad.addColorStop(0.5, rgba(sun.color, Math.min(1, sun.intensity) * 0.3));
        grad.addColorStop(1, rgba(sun.color, 0));
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      // 暗角
      const v = frame.vignette;
      if (v.intensity > 0) {
        const grad = ctx.createRadialGradient(W / 2, H / 2, H * v.radius * 0.4, W / 2, H / 2, Math.hypot(W, H) * 0.62);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, rgba([
          1 - (1 - v.color[0]) * v.intensity,
          1 - (1 - v.color[1]) * v.intensity,
          1 - (1 - v.color[2]) * v.intensity,
        ], 1));
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    dispose() {
      this.canvas.style.filter = '';
    }
  }

  SW.CanvasRenderer = CanvasRenderer;
})((window.SW = window.SW || {}));
