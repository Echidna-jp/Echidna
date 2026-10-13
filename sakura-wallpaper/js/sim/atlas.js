/**
 * 精灵图集：启动时用 Canvas 2D 程序化绘制所有精灵，并预先生成不同虚化程度的版本（景深），
 * 运行时不做任何实时模糊。
 *
 * 布局（2048×2048）：
 *   左上 512×1024 区域，128px 小格：
 *     第 0~2 行：4 种花瓣 × 3 档虚化（清晰 / 轻虚 / 强虚）
 *     第 3 行：柔光斑、带边光斑、光尘、星芒
 *     第 4~6 行：4 种整朵樱花 × 3 档虚化
 *   其余区域，512px 大格：4 种樱花枝花丛 × 2 档虚化（远景轻虚 / 前景强虚）
 * 想换成手绘素材：把对应的 draw 函数换成 drawImage(你的 PNG) 即可。
 */
(function (SW) {
  'use strict';

  const TAU = Math.PI * 2;
  const SIZE = 2048;
  const CELL = 128;
  const BIG = 512;
  const BLURS = [0, 2.2, 6];
  const CLUSTER_BLURS = [1.2, 5];

  // 花瓣形状：w 宽度、notch 缺口深度、lobe 两瓣宽、skew 不对称、palette 配色（花瓣根部 → 中段 → 尖端）
  const SHAPES = [
    { w: 0.66, notch: 0.2, lobe: 0.23, skew: 0, palette: ['#e8829f', '#f3adc3', '#fde3eb'] },
    { w: 0.6, notch: 0.15, lobe: 0.2, skew: 0.07, palette: ['#e07596', '#ee9fb9', '#fbd9e4'] },
    { w: 0.74, notch: 0.24, lobe: 0.26, skew: -0.06, palette: ['#ec93b0', '#f7c0d1', '#fff0f4'] },
    { w: 0.56, notch: 0.12, lobe: 0.18, skew: 0.12, palette: ['#eba0b8', '#f6cad7', '#fff8fa'] },
  ];

  // 整朵花用的花瓣：更宽更圆，根部偏深粉、边缘近白
  const FLOWER_PETALS = [
    { w: 0.82, notch: 0.14, lobe: 0.28, skew: 0, palette: ['#ef8fb0', '#f9cddb', '#fff3f6'] },
    { w: 0.78, notch: 0.12, lobe: 0.26, skew: 0.04, palette: ['#e9809f', '#f6bfd0', '#fde9ef'] },
    { w: 0.86, notch: 0.16, lobe: 0.3, skew: -0.03, palette: ['#f3a3bd', '#fbd8e2', '#ffffff'] },
  ];

  // 内容在格子中所占比例（其余为模糊留白）。渲染时用它把「想要的大小」换算成格子大小
  const PETAL_FILL = 0.72;
  const ROUND_FILL = 0.94;

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

  /* ---------------- 花瓣 ---------------- */

  function petalPath(ctx, s, R) {
    const w = s.w * R;
    const k = s.skew * R;
    ctx.beginPath();
    ctx.moveTo(0, R);
    ctx.bezierCurveTo(w * 0.95 + k, R * 0.55, w * 1.05 + k, -R * 0.55, s.lobe * R + k * 0.5, -R);
    ctx.quadraticCurveTo(s.lobe * R * 0.45, -R * 0.96, 0, -R * (1 - s.notch));
    ctx.quadraticCurveTo(-s.lobe * R * 0.45, -R * 0.96, -s.lobe * R + k * 0.5, -R);
    ctx.bezierCurveTo(-w * 1.05 + k, -R * 0.55, -w * 0.95 + k, R * 0.55, 0, R);
    ctx.closePath();
  }

  // 以原点为中心画一片花瓣：根部在 (0, R)，尖端在 (0, -R)
  function drawPetal(ctx, s, R, veins) {
    const [base, mid, tip] = s.palette;
    petalPath(ctx, s, R);
    const g = ctx.createLinearGradient(0, R, 0, -R);
    g.addColorStop(0, base);
    g.addColorStop(0.38, mid);
    g.addColorStop(1, tip);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    petalPath(ctx, s, R);
    ctx.clip();
    const hl = ctx.createRadialGradient(-R * 0.15, -R * 0.25, 0, -R * 0.15, -R * 0.25, R * 0.8);
    hl.addColorStop(0, 'rgba(255,255,255,0.45)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    if (veins !== false) {
      ctx.strokeStyle = 'rgba(220,130,165,0.22)';
      ctx.lineWidth = Math.max(0.5, R / 55);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, R * 0.9);
        ctx.quadraticCurveTo(i * R * 0.1, 0, i * R * 0.17 + s.skew * R * 0.5, -R * 0.8);
        ctx.stroke();
      }
    }
    const bs = ctx.createRadialGradient(0, R, 0, 0, R, R * 0.6);
    bs.addColorStop(0, 'rgba(225,110,150,0.35)');
    bs.addColorStop(1, 'rgba(225,110,150,0)');
    ctx.fillStyle = bs;
    ctx.fillRect(-R, 0, R * 2, R);
    ctx.restore();

    petalPath(ctx, s, R);
    ctx.strokeStyle = 'rgba(205,100,140,0.42)';
    ctx.lineWidth = Math.max(0.6, R / 46);
    ctx.stroke();
  }

  /* ---------------- 整朵樱花 / 花苞 / 枝条 ---------------- */

  // R：花朵半径；tilt：纵向压缩模拟花朵朝向；rot：整体旋转
  function drawFlower(ctx, R, rnd, tilt, rot) {
    const shape = FLOWER_PETALS[(rnd() * FLOWER_PETALS.length) | 0];
    ctx.save();
    ctx.rotate(rot);
    ctx.scale(1, tilt);
    const start = rnd() * TAU;
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate(start + (i * TAU) / 5 + (rnd() - 0.5) * 0.25);
      ctx.translate(0, -R * 0.5);
      drawPetal(ctx, shape, R * 0.52 * (0.92 + rnd() * 0.14), R > 20);
      ctx.restore();
    }
    // 花心
    const c = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.3);
    c.addColorStop(0, 'rgba(205,70,110,0.9)');
    c.addColorStop(0.6, 'rgba(230,120,155,0.45)');
    c.addColorStop(1, 'rgba(240,160,185,0)');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.3, 0, TAU);
    ctx.fill();
    // 花蕊
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.3;
      const len = R * (0.26 + rnd() * 0.14);
      const x = Math.cos(a) * len;
      const y = Math.sin(a) * len;
      ctx.strokeStyle = 'rgba(225,115,150,0.75)';
      ctx.lineWidth = Math.max(0.5, R / 60);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = rnd() < 0.6 ? 'rgba(242,206,120,0.95)' : 'rgba(214,120,140,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.6, R / 30), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBud(ctx, R, rot) {
    ctx.save();
    ctx.rotate(rot);
    const g = ctx.createLinearGradient(0, R, 0, -R);
    g.addColorStop(0, '#c9476f');
    g.addColorStop(0.6, '#e88aa8');
    g.addColorStop(1, '#f6c3d3');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.2, R * 0.42, R * 0.75, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#7d3a46';
    ctx.beginPath();
    ctx.ellipse(0, R * 0.45, R * 0.3, R * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 沿二次曲线画一段逐渐变细的枝条
  function drawTwig(ctx, x0, y0, cx, cy, x1, y1, w0, w1) {
    const steps = 24;
    let px = x0;
    let py = y0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const w = w0 + (w1 - w0) * t;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#4e3640';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,115,120,0.55)';
      ctx.lineWidth = w * 0.3;
      ctx.beginPath();
      ctx.moveTo(px, py - w * 0.22);
      ctx.lineTo(x, y - w * 0.22);
      ctx.stroke();
      px = x;
      py = y;
    }
  }

  function quadPoint(b, t) {
    const u = 1 - t;
    return [
      u * u * b[0] + 2 * u * t * b[2] + t * t * b[4],
      u * u * b[1] + 2 * u * t * b[3] + t * t * b[5],
    ];
  }

  /**
   * 樱花枝花丛：枝条根部固定在格子左侧 (ANCHOR)，向右生长，节点处簇生 2~5 朵花和花苞。
   * 渲染时绕根部轻微摆动；镜像后可从右侧伸入画面。
   */
  const ANCHOR = [0.03, 0.55];

  function drawCluster(ctx, S, seed) {
    const rnd = seeded(seed);
    const R = (a, b) => a + rnd() * (b - a);
    const ax = S * ANCHOR[0];
    const ay = S * ANCHOR[1];
    const main = [ax, ay, S * R(0.4, 0.55), S * R(0.35, 0.6), S * R(0.9, 0.95), S * R(0.3, 0.5)];
    const branches = [{ b: main, w0: S * 0.034, w1: S * 0.009 }];
    const subCount = 1 + ((rnd() * 2) | 0);
    for (let i = 0; i < subCount; i++) {
      const t = R(0.3, 0.6);
      const p = quadPoint(main, t);
      const up = rnd() < 0.5 ? -1 : 1;
      branches.push({
        b: [p[0], p[1], p[0] + S * R(0.12, 0.2), p[1] + up * S * R(0.03, 0.07), p[0] + S * R(0.25, 0.38), p[1] + up * S * R(0.1, 0.18)],
        w0: S * 0.016 * (1 - t * 0.5),
        w1: S * 0.006,
      });
    }
    for (const br of branches) drawTwig(ctx, br.b[0], br.b[1], br.b[2], br.b[3], br.b[4], br.b[5], br.w0, br.w1);

    // 收集花朵，按大小排序后由后往前画（小的、偏暗的在后）
    const items = [];
    for (const br of branches) {
      const nodes = 3 + ((rnd() * 3) | 0);
      for (let k = 0; k < nodes; k++) {
        const t = R(0.3, 1.0);
        const p = quadPoint(br.b, t);
        const count = 2 + ((rnd() * 4) | 0);
        for (let j = 0; j < count; j++) {
          const a = rnd() * TAU;
          const d = S * R(0.03, 0.09);
          const fr = S * R(0.04, 0.07);
          // 留出边距，避免花朵被格子边缘切掉
          const fx = Math.min(S - fr * 1.3, Math.max(fr * 1.3, p[0] + Math.cos(a) * d));
          const fy = Math.min(S - fr * 1.3, Math.max(fr * 1.3, p[1] + Math.sin(a) * d * 0.8));
          items.push({ px: p[0], py: p[1], x: fx, y: fy, r: fr, bud: rnd() < 0.18, tilt: R(0.55, 1), rot: rnd() * TAU, shade: R(0.85, 1) });
        }
      }
    }
    items.sort((a, b) => a.r * a.shade - b.r * b.shade);
    for (const it of items) {
      // 花梗
      ctx.strokeStyle = 'rgba(110,70,70,0.75)';
      ctx.lineWidth = Math.max(1, S * 0.004);
      ctx.beginPath();
      ctx.moveTo(it.px, it.py);
      ctx.quadraticCurveTo((it.px + it.x) / 2, Math.min(it.py, it.y) - S * 0.01, it.x, it.y);
      ctx.stroke();
      ctx.save();
      ctx.translate(it.x, it.y);
      if (it.bud) drawBud(ctx, it.r * 0.55, Math.atan2(it.y - it.py, it.x - it.px) + Math.PI / 2);
      else {
        ctx.globalAlpha = 1;
        drawFlower(ctx, it.r, rnd, it.tilt, it.rot);
        if (it.shade < 0.95) {
          // 后排花朵略压暗，增加体积感
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = 'rgba(180,110,140,' + (1 - it.shade) * 1.5 + ')';
          ctx.fillRect(-it.r * 1.2, -it.r * 1.2, it.r * 2.4, it.r * 2.4);
        }
      }
      ctx.restore();
    }
  }

  function radial(ctx, r, stops) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, a] of stops) g.addColorStop(o, 'rgba(255,255,255,' + a + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }

  /* ---------------- 组装图集 ---------------- */

  function build() {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    const hasFilter = 'filter' in ctx;
    const cells = [];

    function addCell(x, y, w, h, fill, extra) {
      const inset = 0.5; // 半像素内缩，避免采样到相邻格子
      const cell = Object.assign({
        sx: x,
        sy: y,
        sw: w,
        sh: h,
        u0: (x + inset) / SIZE,
        v0: (y + inset) / SIZE,
        u1: (x + w - inset) / SIZE,
        v1: (y + h - inset) / SIZE,
        fill,
        index: cells.length,
      }, extra);
      cells.push(cell);
      return cell;
    }

    // 把临时画布带模糊地拷进图集（裁剪在格子内，模糊不会渗到相邻格子）
    function blit(src, x, y, blur) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, src.width, src.height);
      ctx.clip();
      if (blur > 0) {
        if (hasFilter) {
          ctx.filter = 'blur(' + blur + 'px)';
          ctx.drawImage(src, x, y);
        } else {
          ctx.globalAlpha = 1 / 8;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * TAU;
            ctx.drawImage(src, x + Math.cos(a) * blur, y + Math.sin(a) * blur);
          }
        }
      } else {
        ctx.drawImage(src, x, y);
      }
      ctx.restore();
    }

    const tmp = document.createElement('canvas');
    tmp.width = CELL;
    tmp.height = CELL;
    const tctx = tmp.getContext('2d');

    function smallSet(row0, draw) {
      const out = [];
      for (let i = 0; i < 4; i++) {
        tctx.clearRect(0, 0, CELL, CELL);
        tctx.save();
        tctx.translate(CELL / 2, CELL / 2);
        draw(tctx, i);
        tctx.restore();
        out.push(BLURS.map((blur, b) => {
          blit(tmp, i * CELL, (row0 + b) * CELL, blur);
          return addCell(i * CELL, (row0 + b) * CELL, CELL, CELL, PETAL_FILL);
        }));
      }
      return out;
    }

    // 花瓣（第 0~2 行）
    const petals = smallSet(0, (c, i) => drawPetal(c, SHAPES[i], (CELL * PETAL_FILL) / 2));

    // 光斑与光尘（第 3 行）
    const r = (CELL * ROUND_FILL) / 2;
    function special(col, draw) {
      ctx.save();
      ctx.translate(col * CELL + CELL / 2, 3 * CELL + CELL / 2);
      draw();
      ctx.restore();
      return addCell(col * CELL, 3 * CELL, CELL, CELL, ROUND_FILL);
    }
    const bokehSoft = special(0, () => radial(ctx, r, [[0, 0.85], [0.45, 0.6], [0.8, 0.22], [1, 0]]));
    const bokehRim = special(1, () => {
      if (hasFilter) ctx.filter = 'blur(1.2px)';
      radial(ctx, r * 0.97, [[0, 0.3], [0.7, 0.38], [0.86, 0.7], [0.95, 0.25], [1, 0]]);
    });
    const mote = special(2, () => radial(ctx, r, [[0, 1], [0.12, 0.85], [0.3, 0.32], [0.6, 0.08], [1, 0]]));
    const sparkle = special(3, () => {
      radial(ctx, r * 0.5, [[0, 1], [0.25, 0.6], [1, 0]]);
      for (const horiz of [true, false]) {
        const g = horiz ? ctx.createLinearGradient(-r, 0, r, 0) : ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        if (horiz) ctx.fillRect(-r, -1.2, r * 2, 2.4);
        else ctx.fillRect(-1.2, -r, 2.4, r * 2);
      }
    });

    // 整朵樱花（第 4~6 行）：前两种正面开放，后两种带倾斜
    const flowers = smallSet(4, (c, i) => {
      const rnd = seeded(101 + i * 17);
      drawFlower(c, (CELL * PETAL_FILL) / 2, rnd, i < 2 ? 1 : 0.62, rnd() * TAU);
    });

    // 樱花枝花丛（512 大格）
    const big = document.createElement('canvas');
    big.width = BIG;
    big.height = BIG;
    const bctx = big.getContext('2d');
    const slots = [
      [512, 0], [1024, 0], [1536, 0], [512, 512],
      [1024, 512], [1536, 512], [512, 1024], [1024, 1024],
    ];
    const clusters = [];
    for (let v = 0; v < 4; v++) {
      bctx.clearRect(0, 0, BIG, BIG);
      drawCluster(bctx, BIG, 7 + v * 131);
      clusters.push(CLUSTER_BLURS.map((blur, b) => {
        const [x, y] = slots[v * 2 + b];
        blit(big, x, y, blur);
        return addCell(x, y, BIG, BIG, 1, { anchor: ANCHOR });
      }));
    }

    return {
      canvas,
      cells,
      petals,
      flowers,
      clusters,
      bokeh: [bokehSoft, bokehRim],
      mote,
      sparkle,
      shapes: SHAPES.length,
    };
  }

  SW.atlas = { build };
})((window.SW = window.SW || {}));
