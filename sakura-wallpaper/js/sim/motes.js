/**
 * 漂浮光尘：细小的发光微粒，缓慢上浮、随风轻摆、闪烁，原地淡入淡出。
 * 少量带十字星芒（sparkle），增加一点「闪闪发光」的梦幻感。
 */
(function (SW) {
  'use strict';
  const { TAU, range, smoothstep } = SW.math;

  class Motes {
    constructor(atlas) {
      this.atlas = atlas;
      this.items = [];
      this.W = 1;
      this.H = 1;
    }

    resize(W, H) {
      const sx = W / this.W;
      const sy = H / this.H;
      for (const m of this.items) {
        m.x *= sx;
        m.y *= sy;
      }
      this.W = W;
      this.H = H;
    }

    sync(cfg) {
      const c = cfg.motes;
      const n = c.enabled ? Math.max(0, Math.round(c.count)) : 0;
      if (this.items.length > n) this.items.length = n;
      while (this.items.length < n) {
        const m = {};
        this._spawn(m, cfg, true);
        this.items.push(m);
      }
    }

    _spawn(m, cfg, initial) {
      m.x = Math.random() * this.W;
      m.y = range(0.05, 1.05) * this.H;
      m.size = range(0.0018, 0.0045);
      m.life = range(6, 14);
      m.age = initial ? Math.random() * m.life : 0;
      m.vy = -range(0.006, 0.018);
      m.wobF = range(0.15, 0.4);
      m.wobP = Math.random() * TAU;
      m.twF = range(0.3, 1.1);
      m.twP = Math.random() * TAU;
      m.sparkle = Math.random() < cfg.motes.sparkle;
      m.factor = range(1.0, 2.2);
      m.base = range(0.4, 1);
    }

    update(dt, cfg, wind) {
      const c = cfg.motes;
      const H = this.H;
      for (const m of this.items) {
        m.age += dt;
        m.y += m.vy * H * c.speed * dt;
        m.x += (wind.value * 0.012 + Math.sin(m.age * m.wobF * TAU + m.wobP) * 0.006) * H * c.speed * dt;
        if (m.age > m.life) this._spawn(m, cfg, false);
      }
    }

    emit(batch, cfg, cam) {
      const c = cfg.motes;
      const H = this.H;
      const col = c.color;
      for (const m of this.items) {
        const cell = m.sparkle ? this.atlas.sparkle : this.atlas.mote;
        const fade = smoothstep(0, 2, m.age) * (1 - smoothstep(m.life - 2.5, m.life, m.age));
        const tw = 0.6 + 0.4 * Math.sin(TAU * m.twF * m.age + m.twP);
        const alpha = c.intensity * m.base * fade * tw * (m.sparkle ? 0.8 : 0.65);
        const size = ((m.size * H * c.size * (m.sparkle ? 3.2 : 1)) / cell.fill) * (1 + cam.zoom);
        batch.push(
          cell.index, cam.projectX(m.x, m.factor), cam.projectY(m.y, m.factor),
          size, size, m.sparkle ? m.age * 0.15 : 0, col[0], col[1], col[2], alpha, 1
        );
      }
    }
  }

  SW.Motes = Motes;
})((window.SW = window.SW || {}));
