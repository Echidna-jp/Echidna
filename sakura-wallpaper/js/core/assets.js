/* 素材加载：图片候选加载、按屏幕缩放超大图、内置占位图 */
(function (SW) {
  'use strict';

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const done = () => resolve(img);
        if (img.decode) img.decode().then(done, done);
        else done();
      };
      img.onerror = () => reject(new Error('无法加载图片：' + src));
      img.src = src;
    });
  }

  // 依次尝试多个路径，返回第一个成功的 { img, src }；全部失败返回 null
  async function loadFirst(sources) {
    const list = Array.isArray(sources) ? sources : [sources];
    for (const src of list) {
      if (!src) continue;
      try {
        return { img: await loadImage(src), src };
      } catch (e) {
        /* 尝试下一个 */
      }
    }
    return null;
  }

  // 把图片缩小到长边不超过 maxSide（逐级减半，画质更好）。不需要缩放时原样返回
  function fitImage(img, maxSide) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale >= 0.999) return img;

    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    let src = img;
    let sw = w;
    let sh = h;
    while (sw / 2 > tw && sh / 2 > th) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw / 2);
      c.height = Math.round(sh / 2);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      src = c;
      sw = c.width;
      sh = c.height;
    }
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, tw, th);
    return out;
  }

  /* ---------- 占位图：未放入插画时，用程序绘制一幅春日樱花场景用于预览效果 ---------- */

  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createPlaceholder(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const rnd = seeded(20240401);
    const R = (a, b) => a + rnd() * (b - a);

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#9fc3ea');
    sky.addColorStop(0.45, '#dcd6ef');
    sky.addColorStop(0.75, '#f6dde8');
    sky.addColorStop(1, '#fbeef1');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 云
    for (let i = 0; i < 9; i++) {
      const x = R(0, w);
      const y = R(h * 0.05, h * 0.45);
      const r = R(h * 0.12, h * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 远山
    ctx.fillStyle = 'rgba(190,170,215,0.45)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    for (let x = 0; x <= w; x += w / 12) {
      ctx.lineTo(x, h * (0.66 + Math.sin(x / w * 7.3) * 0.03 + rnd() * 0.02));
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();

    // 地面
    const ground = ctx.createLinearGradient(0, h * 0.74, 0, h);
    ground.addColorStop(0, '#f2d3df');
    ground.addColorStop(1, '#e9bfd0');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.8);
    ctx.quadraticCurveTo(w * 0.5, h * 0.72, w, h * 0.8);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fill();

    const blossom = ['#f7c6d6', '#f4b3c9', '#fbd9e4', '#f0a8c0', '#fde6ee'];

    // 树干与枝条
    function branch(x0, y0, x1, y1, cx, cy, width) {
      ctx.strokeStyle = '#5b3f4f';
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
    branch(w * 0.94, h * 1.0, w * 0.86, h * 0.12, w * 0.95, h * 0.5, h * 0.035);
    branch(w * 0.88, h * 0.35, w * 0.6, h * 0.12, w * 0.75, h * 0.32, h * 0.012);
    branch(w * 0.87, h * 0.22, w * 0.7, h * 0.02, w * 0.8, h * 0.08, h * 0.01);
    branch(-w * 0.02, h * 0.18, w * 0.25, h * 0.08, w * 0.12, h * 0.2, h * 0.014);

    // 花团（远处更虚、更淡）。先画到独立图层，整层只模糊一次（逐个形状模糊会非常慢）
    const layer = document.createElement('canvas');
    layer.width = w;
    layer.height = h;
    const lctx = layer.getContext('2d');
    function cluster(cx, cy, rx, ry, n, blur, alpha) {
      lctx.clearRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd());
        const x = cx + Math.cos(a) * rx * d;
        const y = cy + Math.sin(a) * ry * d;
        lctx.globalAlpha = alpha * R(0.5, 1);
        lctx.fillStyle = blossom[(rnd() * blossom.length) | 0];
        lctx.beginPath();
        lctx.arc(x, y, R(h * 0.012, h * 0.04), 0, Math.PI * 2);
        lctx.fill();
      }
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(' + blur + 'px)';
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
    cluster(w * 0.8, h * 0.12, w * 0.22, h * 0.16, 260, h * 0.004, 0.75);
    cluster(w * 0.66, h * 0.08, w * 0.12, h * 0.08, 120, h * 0.003, 0.7);
    cluster(w * 0.12, h * 0.1, w * 0.16, h * 0.1, 160, h * 0.006, 0.65);
    cluster(w * 0.35, h * 0.62, w * 0.18, h * 0.05, 90, h * 0.01, 0.35);

    // 垂枝（可在编辑器里给它们加木偶区域做测试）
    for (let k = 0; k < 4; k++) {
      const x0 = w * (0.62 + k * 0.06);
      const y0 = h * (0.1 + rnd() * 0.06);
      const len = h * R(0.22, 0.34);
      ctx.strokeStyle = 'rgba(91,63,79,0.8)';
      ctx.lineWidth = h * 0.0025;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 - h * 0.01, y0 + len * 0.4, x0 + h * 0.01, y0 + len * 0.7, x0 - h * 0.005, y0 + len);
      ctx.stroke();
      for (let i = 0; i < 16; i++) {
        const t = i / 15;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = blossom[(rnd() * blossom.length) | 0];
        ctx.beginPath();
        ctx.arc(x0 + R(-1, 1) * h * 0.01, y0 + len * t, h * R(0.006, 0.011), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 地上的落花
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = R(0.4, 0.9);
      ctx.fillStyle = blossom[(rnd() * blossom.length) | 0];
      const y = R(h * 0.8, h);
      ctx.beginPath();
      ctx.ellipse(R(0, w), y, h * 0.004 * (y / h), h * 0.0025 * (y / h), R(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 标注
    ctx.font = Math.round(h * 0.022) + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(110,80,100,0.55)';
    ctx.textAlign = 'center';
    ctx.fillText('占位图 · 请把插画放到 assets/main.png', w * 0.5, h * 0.93);
    return c;
  }

  SW.assets = { loadImage, loadFirst, fitImage, createPlaceholder };
})((window.SW = window.SW || {}));
