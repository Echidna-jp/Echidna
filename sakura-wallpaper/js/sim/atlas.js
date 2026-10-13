/**
 * 精灵图集：启动时用 Canvas 2D 程序化绘制花瓣、光斑、光尘，
 * 并预先生成不同模糊程度的版本（景深），运行时不再做任何实时模糊。
 *
 * 布局（4×4，每格 128px）：
 *   第 0~2 行：4 种花瓣形状 × 3 档模糊（清晰 / 轻虚 / 强虚）
 *   第 3 行：柔光斑、带边光斑、光尘、星芒
 * 想换成手绘花瓣：把 drawPetal 换成 drawImage(你的花瓣 PNG) 即可。
 */
(function (SW) {
  'use strict';

  const CELL = 128;
  const COLS = 4;
  const ROWS = 4;
  const BLURS = [0, 2.2, 6];

  // 花瓣形状：w 宽度、notch 缺口深度、lobe 两瓣宽、skew 不对称、palette 配色
  const SHAPES = [
    { w: 0.66, notch: 0.2, lobe: 0.23, skew: 0, palette: ['#e8829f', '#f3adc3', '#fde3eb'] },
    { w: 0.6, notch: 0.15, lobe: 0.2, skew: 0.07, palette: ['#e07596', '#ee9fb9', '#fbd9e4'] },
    { w: 0.74, notch: 0.24, lobe: 0.26, skew: -0.06, palette: ['#ec93b0', '#f7c0d1', '#fff0f4'] },
    { w: 0.56, notch: 0.12, lobe: 0.18, skew: 0.12, palette: ['#eba0b8', '#f6cad7', '#fff8fa'] },
  ];

  // 内容在格子中所占比例（其余为模糊留白）。渲染时用它把「想要的大小」换算成格子大小
  const PETAL_FILL = 0.72;
  const ROUND_FILL = 0.94;

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

  function drawPetal(ctx, s, R) {
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
    // 柔和高光
    const hl = ctx.createRadialGradient(-R * 0.15, -R * 0.25, 0, -R * 0.15, -R * 0.25, R * 0.8);
    hl.addColorStop(0, 'rgba(255,255,255,0.45)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    // 叶脉
    ctx.strokeStyle = 'rgba(220,130,165,0.22)';
    ctx.lineWidth = 0.8;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(0, R * 0.9);
      ctx.quadraticCurveTo(i * R * 0.1, 0, i * R * 0.17 + s.skew * R * 0.5, -R * 0.8);
      ctx.stroke();
    }
    // 底部稍深（花萼处）
    const bs = ctx.createRadialGradient(0, R, 0, 0, R, R * 0.6);
    bs.addColorStop(0, 'rgba(225,110,150,0.35)');
    bs.addColorStop(1, 'rgba(225,110,150,0)');
    ctx.fillStyle = bs;
    ctx.fillRect(-R, 0, R * 2, R);
    ctx.restore();

    // 细边
    petalPath(ctx, s, R);
    ctx.strokeStyle = 'rgba(205,100,140,0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function radial(ctx, r, stops) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [o, a] of stops) g.addColorStop(o, 'rgba(255,255,255,' + a + ')');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function build() {
    const canvas = document.createElement('canvas');
    canvas.width = CELL * COLS;
    canvas.height = CELL * ROWS;
    const ctx = canvas.getContext('2d');
    const hasFilter = 'filter' in ctx;
    const cells = [];

    function addCell(col, row, fill) {
      const inset = 0.5; // 半像素内缩，避免采样到相邻格子
      const cell = {
        sx: col * CELL,
        sy: row * CELL,
        sw: CELL,
        sh: CELL,
        u0: (col * CELL + inset) / canvas.width,
        v0: (row * CELL + inset) / canvas.height,
        u1: ((col + 1) * CELL - inset) / canvas.width,
        v1: ((row + 1) * CELL - inset) / canvas.height,
        fill,
        index: cells.length,
      };
      cells.push(cell);
      return cell;
    }

    // 先在临时画布上画清晰版本，再带模糊地拷进图集
    const tmp = document.createElement('canvas');
    tmp.width = CELL;
    tmp.height = CELL;
    const tctx = tmp.getContext('2d');

    const petals = SHAPES.map(() => []);
    SHAPES.forEach((shape, i) => {
      tctx.clearRect(0, 0, CELL, CELL);
      tctx.save();
      tctx.translate(CELL / 2, CELL / 2);
      drawPetal(tctx, shape, (CELL * PETAL_FILL) / 2);
      tctx.restore();
      BLURS.forEach((blur, b) => {
        ctx.save();
        if (blur > 0) {
          if (hasFilter) {
            ctx.filter = 'blur(' + blur + 'px)';
            ctx.drawImage(tmp, i * CELL, b * CELL);
          } else {
            // 不支持 filter 时，用多次偏移叠加近似模糊
            ctx.globalAlpha = 1 / 8;
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              ctx.drawImage(tmp, i * CELL + Math.cos(a) * blur, b * CELL + Math.sin(a) * blur);
            }
          }
        } else {
          ctx.drawImage(tmp, i * CELL, b * CELL);
        }
        ctx.restore();
        petals[i][b] = addCell(i, b, PETAL_FILL);
      });
    });

    // 第 3 行：光斑与光尘
    const r = (CELL * ROUND_FILL) / 2;
    function special(col, draw) {
      ctx.save();
      ctx.translate(col * CELL + CELL / 2, 3 * CELL + CELL / 2);
      draw();
      ctx.restore();
      return addCell(col, 3, ROUND_FILL);
    }
    const bokehSoft = special(0, () =>
      radial(ctx, r, [[0, 0.85], [0.45, 0.6], [0.8, 0.22], [1, 0]])
    );
    const bokehRim = special(1, () => {
      if (hasFilter) ctx.filter = 'blur(1.2px)';
      radial(ctx, r * 0.97, [[0, 0.3], [0.7, 0.38], [0.86, 0.7], [0.95, 0.25], [1, 0]]);
    });
    const mote = special(2, () =>
      radial(ctx, r, [[0, 1], [0.12, 0.85], [0.3, 0.32], [0.6, 0.08], [1, 0]])
    );
    const sparkle = special(3, () => {
      radial(ctx, r * 0.5, [[0, 1], [0.25, 0.6], [1, 0]]);
      for (const horiz of [true, false]) {
        const g = horiz
          ? ctx.createLinearGradient(-r, 0, r, 0)
          : ctx.createLinearGradient(0, -r, 0, r);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        if (horiz) ctx.fillRect(-r, -1.2, r * 2, 2.4);
        else ctx.fillRect(-1.2, -r, 2.4, r * 2);
      }
    });

    return { canvas, cells, petals, bokeh: [bokehSoft, bokehRim], mote, sparkle, shapes: SHAPES.length };
  }

  SW.atlas = { build };
})((window.SW = window.SW || {}));
