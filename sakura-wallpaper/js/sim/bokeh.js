/**
 * 柔和光斑（散景）：大而虚的光圈，缓慢漂移、明暗呼吸、淡入淡出。
 * 一部分聚集在光源附近，让光斑与画面光线方向一致。
 */
(function (SW) {
  'use strict';
  const { TAU, range, pick, smoothstep, clamp } = SW.math;

  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  }

  class Bokeh {
    constructor(atlas) {
      this.atlas = atlas;
      this.items = [];
      this.W = 1;
      this.H = 1;
    }

    resize(W, H) {
      const sx = W / this.W;
      const sy = H / this.H;
      for (const b of this.items) {
        b.x *= sx;
        b.y *= sy;
      }
      this.W = W;
      this.H = H;
    }

    sync(cfg) {
      const c = cfg.bokeh;
      const n = c.enabled ? Math.max(0, Math.round(c.count)) : 0;
      if (this.items.length > n) this.items.length = n;
      while (this.items.length < n) {
        const b = {};
        this._spawn(b, cfg, true);
        this.items.push(b);
      }
    }

    _spawn(b, cfg, initial) {
      const c = cfg.bokeh;
      const sun = cfg.light.sun.position;
      if (Math.random() < c.nearLight) {
        b.x = clamp(sun[0] + gauss() * 0.35, -0.05, 1.05) * this.W;
        b.y = clamp(sun[1] + 0.15 + gauss() * 0.3, -0.05, 1.05) * this.H;
      } else {
        b.x = Math.random() * this.W;
        b.y = Math.random() * this.H;
      }
      b.size = range(0.035, 0.11);
      b.life = range(14, 26);
      b.age = initial ? Math.random() * b.life : 0;
      b.vx = range(-0.004, 0.004);
      b.vy = range(-0.006, 0.002);
      b.color = pick(c.colors);
      b.rim = Math.random() < 0.4;
      b.pulseF = range(0.05, 0.12);
      b.pulseP = Math.random() * TAU;
      b.factor = range(1.2, 2.6);
      b.base = range(0.35, 1);
    }

    update(dt, cfg, wind) {
      const c = cfg.bokeh;
      const H = this.H;
      for (const b of this.items) {
        b.age += dt;
        b.x += (b.vx + wind.value * 0.004) * H * c.speed * dt;
        b.y += b.vy * H * c.speed * dt;
        if (b.age > b.life) this._spawn(b, cfg, false);
      }
    }

    emit(batch, cfg, cam) {
      const c = cfg.bokeh;
      const H = this.H;
      for (const b of this.items) {
        const cell = this.atlas.bokeh[b.rim ? 1 : 0];
        const fade = smoothstep(0, 3, b.age) * (1 - smoothstep(b.life - 4, b.life, b.age));
        const pulse = 0.75 + 0.25 * Math.sin(TAU * b.pulseF * b.age + b.pulseP);
        const alpha = c.intensity * 0.22 * b.base * fade * pulse;
        const size = ((b.size * H * c.size) / cell.fill) * (1 + cam.zoom);
        const col = b.color;
        batch.push(
          cell.index, cam.projectX(b.x, b.factor), cam.projectY(b.y, b.factor),
          size, size, 0, col[0], col[1], col[2], alpha, 1
        );
      }
    }
  }

  SW.Bokeh = Bokeh;
})((window.SW = window.SW || {}));
