/**
 * 樱花花瓣
 * - 三个景深层：远（小、淡、轻虚、视差小）/ 中（清晰）/ 近（大、强虚、视差大）
 * - 两种运动：翻滚（持续旋转 + 翻面）与滑翔（钟摆式左右摆动，摆到两端时减速）
 * - 风场驱动水平漂移，阵风时翻转加快
 * 坐标为渲染像素；尺寸、速度以屏幕高度 H 为单位。
 */
(function (SW) {
  'use strict';
  const { TAU, range, smoothstep, lerp } = SW.math;

  const LAYERS = [
    { name: 'far', z0: 0.0, z1: 0.32 },
    { name: 'mid', z0: 0.36, z1: 0.84 },
    { name: 'near', z0: 0.9, z1: 1.0 },
  ];

  class Petals {
    constructor(atlas) {
      this.atlas = atlas;
      this.layers = [[], [], []];
      this.items = []; // 按 远→中→近 排序后的绘制顺序
      this.farCount = 0; // 前 farCount 个画在「前景层」之前
      this.W = 1;
      this.H = 1;
    }

    resize(W, H) {
      const sx = W / this.W;
      const sy = H / this.H;
      for (const p of this.items) {
        p.x *= sx;
        p.y *= sy;
      }
      this.W = W;
      this.H = H;
    }

    // 数量/比例变化时增减花瓣（保留已有的，不会整屏重置）
    sync(cfg) {
      const pc = cfg.petals;
      const n = pc.enabled ? Math.max(0, Math.round(pc.count)) : 0;
      const far = Math.round(n * Math.min(pc.farRatio, 1));
      const near = Math.round(n * Math.min(pc.nearRatio, 1 - Math.min(pc.farRatio, 1)));
      const want = [far, Math.max(0, n - far - near), near];
      let changed = false;
      for (let l = 0; l < 3; l++) {
        const arr = this.layers[l];
        if (arr.length === want[l]) continue;
        changed = true;
        if (arr.length > want[l]) arr.length = want[l];
        while (arr.length < want[l]) {
          const p = { z: range(LAYERS[l].z0, LAYERS[l].z1) };
          this._spawn(p, true);
          arr.push(p);
        }
        arr.sort((a, b) => a.z - b.z);
      }
      if (changed) {
        this.items = this.layers[0].concat(this.layers[1], this.layers[2]);
        this.farCount = this.layers[0].length;
      }
    }

    _spawn(p, anywhere, windValue) {
      const W = this.W;
      const H = this.H;
      const z = p.z;
      p.size = lerp(0.008, 0.024, smoothstep(0, 0.84, z)) * range(0.75, 1.25);
      if (z >= 0.9) p.size = range(0.034, 0.052);
      p.fall = range(0.045, 0.07); // H/秒
      p.drift = range(-0.006, 0.006);
      p.swayAmp = range(0.004, 0.014);
      p.swayFreq = range(0.12, 0.3);
      p.phase = Math.random() * TAU;
      p.rot = Math.random() * TAU;
      p.spin = range(0.2, 0.9) * (Math.random() < 0.5 ? -1 : 1);
      p.flip = Math.random() * TAU;
      p.flipSpeed = range(0.4, 1.6) * (Math.random() < 0.5 ? -1 : 1);
      p.shape = (Math.random() * this.atlas.shapes) | 0;
      p.shade = range(0.9, 1);
      p.glide = Math.random() < 0.35;

      if (anywhere) {
        // 首次出现：铺满全屏并淡入
        p.x = range(-0.05, 1.05) * W;
        p.y = range(-0.1, 1.0) * H;
        p.age = 0;
      } else {
        // 回收：从屏幕上方（偏上风处）重新落下
        const travel = ((windValue || 0) * 0.05) / p.fall; // 落下一屏期间的水平漂移（H）
        p.x = range(-0.05, 1.05) * W - travel * H * 0.5;
        p.y = -(p.size * 2 + 0.08) * H - Math.random() * H * 0.15;
        p.age = 10;
      }
    }

    update(dt, cfg, wind, cam) {
      const pc = cfg.petals;
      const H = this.H;
      const W = this.W;
      const speed = pc.speed;
      const spinK = pc.spin * speed * (1 + wind.gust * 0.8);
      const marginX = cam.margin * 2.6 + 0.08 * H;
      const bottom = H + cam.margin * 2.6 + 0.08 * H;
      for (let i = 0; i < this.items.length; i++) {
        const p = this.items[i];
        const depthK = 0.3 + 0.7 * p.z; // 远处的花瓣在屏幕上移动得更慢
        p.age += dt;
        p.phase += p.swayFreq * TAU * dt * speed * (1 + wind.gust * 0.5);
        const glideK = p.glide ? 0.55 + 0.45 * Math.abs(Math.cos(p.phase)) : 1;
        p.y += p.fall * H * depthK * speed * glideK * dt;
        p.x += (wind.value * 0.05 + p.drift) * H * depthK * speed * dt;
        p.rot += p.spin * spinK * dt;
        p.flip += p.flipSpeed * spinK * dt;
        if (p.y > bottom + p.size * H || p.x < -marginX - W * 0.3 || p.x > W + marginX + W * 0.3) {
          this._spawn(p, false, wind.value);
        }
      }
    }

    // 输出 [from, to) 区间的花瓣到批次
    emit(batch, cfg, cam, from, to) {
      const pc = cfg.petals;
      const H = this.H;
      const tint = pc.tint;
      const atlas = this.atlas;
      for (let i = from; i < to; i++) {
        const p = this.items[i];
        const z = p.z;
        const blur = z < 0.2 ? 1 : z > 0.88 ? 2 : z > 0.8 ? 1 : 0;
        const cell = atlas.petals[p.shape][blur];
        const factor = 0.9 + 1.6 * z; // 视差倍率：越近位移越大
        const sway = Math.sin(p.phase) * p.swayAmp * H * pc.sway * (0.3 + 0.7 * z);
        const x = cam.projectX(p.x + sway, factor);
        const y = cam.projectY(p.y, factor);
        const size = ((p.size * H * pc.size) / cell.fill) * (1 + cam.zoom);

        // 翻面：宽度按 cos 缩放（负值即镜像），侧对镜头时保留一部分宽度，避免变成细线
        const fc = Math.cos(p.flip);
        const w = size * (fc >= 0 ? 1 : -1) * (0.22 + 0.78 * Math.abs(fc));
        const h = size * (0.86 + 0.14 * Math.sin(p.flip * 0.7 + z * 10));
        const rot = p.glide ? p.rot * 0.25 + Math.cos(p.phase) * 0.6 : p.rot;
        const shade = p.shade * (0.8 + 0.2 * Math.abs(fc));

        let alpha = z < 0.36 ? 0.5 + z : z >= 0.9 ? 0.78 : 0.94;
        alpha *= pc.opacity * Math.min(1, p.age / 1.5);
        batch.push(cell.index, x, y, w, h, rot, tint[0] * shade, tint[1] * shade, tint[2] * shade, alpha, 0);
      }
    }
  }

  SW.Petals = Petals;
})((window.SW = window.SW || {}));
