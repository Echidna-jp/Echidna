/**
 * 浏览器调节面板（按 E 开关，或网址加 ?edit）
 * - 参数：实时调节所有参数，导出配置
 * - 木偶：在插画上可视化放置「头发末梢 / 衣袖」摆动区域，导出后粘贴到 config.js
 * - 信息：帧率、渲染耗时、分辨率等
 * 只在浏览器预览中使用；Wallpaper Engine 里不会出现（壁纸收不到键盘事件）。
 */
(function (SW) {
  'use strict';
  const { clamp } = SW.math;
  const { getPath, setPath, clone } = SW.config;

  const DRAFT_KEY = 'sakura-wallpaper:zones-draft';

  const ZONE_FIELDS = [
    { key: 'amplitude', label: '摆幅', min: 0, max: 0.02, step: 0.0005 },
    { key: 'speed', label: '速度（次/秒）', min: 0.03, max: 1, step: 0.01 },
    { key: 'wave', label: '波动传递', min: 0, max: 6, step: 0.1 },
    { key: 'angle', label: '方向偏转（度）', min: -90, max: 90, step: 1 },
    { key: 'radius', label: '影响半径', min: 0.01, max: 0.5, step: 0.005 },
    { key: 'feather', label: '边缘羽化', min: 0, max: 0.95, step: 0.01 },
    { key: 'phase', label: '相位', min: 0, max: 6.28, step: 0.05 },
    { key: 'lean', label: '顺风倾斜', min: 0, max: 2, step: 0.05 },
  ];

  const TEMPLATE = `
<header>
  <b>樱梦 · 调节面板</b>
  <span class="sw-hint">E 键开关</span>
  <button class="sw-x" data-act="dock" title="移到另一侧">⇆</button>
  <button class="sw-x" data-act="close" title="关闭">×</button>
</header>
<nav>
  <button data-tab="params" class="on">参数</button>
  <button data-tab="puppet">木偶</button>
  <button data-tab="info">信息</button>
</nav>
<section data-pane="params">
  <div class="sw-params"></div>
  <div class="sw-actions">
    <button data-act="export-config">导出配置</button>
    <button data-act="reset">恢复默认</button>
  </div>
</section>
<section data-pane="puppet" hidden>
  <p class="sw-tip">
    在插画上拖动：<b>■ 根部</b>（固定点）、<b>● 摆动中心</b>、<b>◆ 半径</b>；拖动圆内空白处可整体移动。
    双击空白处新增区域，Delete 键删除。区域越靠近发梢/袖口、摆幅越小，效果越自然。
  </p>
  <label class="sw-check"><input type="checkbox" data-opt="showZones" checked> 显示区域</label>
  <label class="sw-check"><input type="checkbox" data-opt="debug"> 显示影响权重（红色）</label>
  <label class="sw-check"><input type="checkbox" data-opt="freeze" checked> 冻结镜头（便于放置）</label>
  <div class="sw-zone-list"></div>
  <div class="sw-actions">
    <button data-act="add-zone">＋ 新增</button>
    <button data-act="dup-zone">复制</button>
    <button data-act="del-zone">删除</button>
  </div>
  <div class="sw-zone-fields"></div>
  <div class="sw-actions">
    <button data-act="export-zones">导出区域代码</button>
    <button data-act="restore-draft" hidden>恢复上次草稿</button>
  </div>
</section>
<section data-pane="info" hidden>
  <pre class="sw-info"></pre>
</section>
<div class="sw-modal" hidden>
  <p class="sw-modal-tip"></p>
  <textarea readonly spellcheck="false"></textarea>
  <div class="sw-actions">
    <button data-act="copy">复制</button>
    <button data-act="close-modal">关闭</button>
  </div>
</div>`;

  function hex(c) {
    return '#' + c.map((v) => ('0' + Math.round(clamp(v, 0, 1) * 255).toString(16)).slice(-2)).join('');
  }

  function unhex(h) {
    return [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
  }

  function round(v, d) {
    const k = Math.pow(10, d);
    return Math.round(v * k) / k;
  }

  class Editor {
    constructor(app) {
      this.app = app;
      this.cfg = app.cfg;
      this.defaults = clone(app.cfg);
      this.isOpen = false;
      this.tab = 'params';
      this.selected = this.cfg.puppet.zones.length ? 0 : -1;
      this.opts = { showZones: true, debug: false, freeze: true };
      this.drag = null;
      this.controls = [];

      this.overlay = document.getElementById('overlay');
      this.octx = this.overlay.getContext('2d');
      this.el = document.createElement('div');
      this.el.id = 'sw-editor';
      this.el.innerHTML = TEMPLATE;
      this.el.hidden = true;
      document.body.appendChild(this.el);
      this.$ = (sel) => this.el.querySelector(sel);
      // 弹窗挂到 body 上：面板的 backdrop-filter 会把 fixed 定位限制在面板内部
      this.modal = this.$('.sw-modal');
      document.body.appendChild(this.modal);

      this._buildParams();
      this._bindUi();
      this._bindOverlay();
      app.onFrame.push(() => this._onFrame());

      window.addEventListener('keydown', (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.key === 'e' || e.key === 'E') this.toggle();
        if (e.key === 'Delete' && this.isOpen && this.tab === 'puppet') this._deleteZone();
      });
      if (/[?&]edit\b/.test(location.search)) this.toggle(true);
    }

    toggle(force) {
      this.isOpen = force == null ? !this.isOpen : !!force;
      this.el.hidden = !this.isOpen;
      if (this.isOpen) {
        this._refreshParams();
        this._refreshZones();
      }
      this._syncModes();
    }

    _syncModes() {
      const puppetTab = this.isOpen && this.tab === 'puppet';
      this.app.camera.frozen = puppetTab && this.opts.freeze;
      this.app.puppetDebug = this.isOpen && this.opts.debug;
      this.overlay.style.pointerEvents = puppetTab ? 'auto' : 'none';
      if (!this.isOpen || !this.opts.showZones) this._clearOverlay();
    }

    /* ---------------- 参数页 ---------------- */

    _buildParams() {
      const box = this.$('.sw-params');
      let group = '';
      for (const p of SW.PARAMS) {
        if (p.editor === false) continue;
        if (p.group !== group) {
          group = p.group;
          const h = document.createElement('h4');
          h.textContent = group;
          box.appendChild(h);
        }
        const row = document.createElement('label');
        row.className = 'sw-row sw-' + p.type;
        const name = document.createElement('span');
        name.textContent = p.label;
        row.appendChild(name);
        let input;
        let out = null;
        if (p.type === 'slider') {
          input = document.createElement('input');
          input.type = 'range';
          input.min = p.min;
          input.max = p.max;
          input.step = p.step;
          out = document.createElement('output');
        } else if (p.type === 'bool') {
          input = document.createElement('input');
          input.type = 'checkbox';
        } else if (p.type === 'combo') {
          input = document.createElement('select');
          for (const o of p.options) {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            input.appendChild(opt);
          }
        } else if (p.type === 'color') {
          input = document.createElement('input');
          input.type = 'color';
        } else {
          continue;
        }
        row.appendChild(input);
        if (out) row.appendChild(out);
        box.appendChild(row);

        const read = () => {
          if (p.type === 'bool') return input.checked;
          if (p.type === 'color') return unhex(input.value);
          return input.value;
        };
        const evt = p.type === 'slider' ? 'input' : 'change';
        input.addEventListener(evt, () => {
          setPath(this.cfg, p.path, SW.params.toConfig(p, read()));
          if (out) out.textContent = input.value;
          this.app.onConfigChange([p.path]);
        });
        this.controls.push({ p, input, out });
      }
    }

    _refreshParams() {
      for (const { p, input, out } of this.controls) {
        const v = getPath(this.cfg, p.path);
        if (p.type === 'bool') input.checked = !!v;
        else if (p.type === 'color') input.value = hex(v);
        else input.value = SW.params.toDisplay(p, v);
        if (out) out.textContent = input.value;
      }
    }

    /* ---------------- 木偶页 ---------------- */

    get zones() {
      return this.cfg.puppet.zones;
    }

    _refreshZones() {
      const list = this.$('.sw-zone-list');
      list.innerHTML = '';
      this.zones.forEach((z, i) => {
        const b = document.createElement('button');
        b.textContent = (z.enabled === false ? '○ ' : '● ') + (z.name || '区域 ' + (i + 1));
        b.className = i === this.selected ? 'on' : '';
        b.addEventListener('click', () => {
          this.selected = i;
          this._refreshZones();
        });
        list.appendChild(b);
      });
      if (!this.zones.length) list.innerHTML = '<span class="sw-tip">还没有区域：双击插画或点「＋ 新增」。</span>';

      const box = this.$('.sw-zone-fields');
      box.innerHTML = '';
      const z = this.zones[this.selected];
      if (z) {
        const nameRow = document.createElement('label');
        nameRow.className = 'sw-row';
        nameRow.innerHTML = '<span>名称</span><input type="text">';
        const nameInput = nameRow.querySelector('input');
        nameInput.value = z.name || '';
        nameInput.addEventListener('input', () => {
          z.name = nameInput.value;
          this._saveDraft();
        });
        nameInput.addEventListener('change', () => this._refreshZones());
        box.appendChild(nameRow);

        const enRow = document.createElement('label');
        enRow.className = 'sw-check';
        enRow.innerHTML = '<input type="checkbox"> 启用';
        const en = enRow.querySelector('input');
        en.checked = z.enabled !== false;
        en.addEventListener('change', () => {
          z.enabled = en.checked;
          this._saveDraft();
          this._refreshZones();
        });
        box.appendChild(enRow);

        for (const f of ZONE_FIELDS) {
          const row = document.createElement('label');
          row.className = 'sw-row sw-slider';
          row.innerHTML = '<span></span><input type="range"><output></output>';
          row.querySelector('span').textContent = f.label;
          const input = row.querySelector('input');
          const out = row.querySelector('output');
          input.min = f.min;
          input.max = f.max;
          input.step = f.step;
          input.value = z[f.key] == null ? 0 : z[f.key];
          out.textContent = input.value;
          input.addEventListener('input', () => {
            z[f.key] = Number(input.value);
            out.textContent = input.value;
            this._saveDraft();
          });
          box.appendChild(row);
        }
      }
      this.$('[data-act="restore-draft"]').hidden = !this._draft();
    }

    _newZone(u, v) {
      return {
        name: '区域 ' + (this.zones.length + 1),
        pivot: [round(u, 4), round(clamp(v - 0.08, 0, 1), 4)],
        center: [round(u, 4), round(v, 4)],
        radius: 0.07,
        feather: 0.35,
        amplitude: 0.004,
        speed: 0.22,
        wave: 1.6,
        angle: 0,
        phase: round(Math.random() * 6.28, 2),
        lean: 0.5,
      };
    }

    _addZone(u, v) {
      if (u == null) [u, v] = this.app.screenToImage(0.5, 0.5);
      this.zones.push(this._newZone(u, v));
      this.selected = this.zones.length - 1;
      this._saveDraft();
      this._refreshZones();
    }

    _deleteZone() {
      if (this.selected < 0) return;
      this.zones.splice(this.selected, 1);
      this.selected = Math.min(this.selected, this.zones.length - 1);
      this._saveDraft();
      this._refreshZones();
    }

    _draft() {
      try {
        const s = localStorage.getItem(DRAFT_KEY);
        return s && s !== JSON.stringify(this.zones) ? s : null;
      } catch (e) {
        return null;
      }
    }

    _saveDraft() {
      clearTimeout(this._draftTimer);
      this._draftTimer = setTimeout(() => {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(this.zones));
        } catch (e) {
          /* 隐私模式等情况下忽略 */
        }
      }, 400);
    }

    _zonesCode() {
      const fmt = (v) => (Array.isArray(v) ? '[' + v.map((x) => round(x, 4)).join(', ') + ']' : typeof v === 'string' ? JSON.stringify(v) : round(v, 4));
      const keys = ['name', 'enabled', 'pivot', 'center', 'radius', 'feather', 'amplitude', 'speed', 'wave', 'angle', 'phase', 'lean'];
      const lines = this.zones.map((z) => {
        const parts = keys.filter((k) => z[k] != null && !(k === 'enabled' && z[k] !== false)).map((k) => k + ': ' + fmt(z[k]));
        return '      { ' + parts.join(', ') + ' },';
      });
      return '    zones: [\n' + lines.join('\n') + '\n    ],';
    }

    /* ---------------- 交互绑定 ---------------- */

    _bindUi() {
      const onClick = (e) => {
        const tab = e.target.getAttribute('data-tab');
        if (tab) {
          this.tab = tab;
          this.el.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === e.target));
          this.el.querySelectorAll('section').forEach((s) => (s.hidden = s.getAttribute('data-pane') !== tab));
          this._syncModes();
          return;
        }
        const act = e.target.getAttribute('data-act');
        if (!act) return;
        switch (act) {
          case 'close':
            this.toggle(false);
            break;
          case 'dock':
            this.el.classList.toggle('left');
            break;
          case 'reset':
            for (const { p } of this.controls) setPath(this.cfg, p.path, clone(getPath(this.defaults, p.path)));
            this._refreshParams();
            this.app.onConfigChange(this.controls.map((c) => c.p.path));
            break;
          case 'export-config':
            this._modal(
              '可整体替换 config.js 的内容（会丢失注释），或只复制需要修改的部分。',
              'window.WALLPAPER_CONFIG = ' + JSON.stringify(this.cfg, null, 2) + ';\n'
            );
            break;
          case 'add-zone':
            this._addZone();
            break;
          case 'dup-zone': {
            const z = this.zones[this.selected];
            if (!z) break;
            const c = clone(z);
            c.name = (z.name || '区域') + ' 副本';
            c.pivot[0] += 0.02;
            c.center[0] += 0.02;
            this.zones.push(c);
            this.selected = this.zones.length - 1;
            this._saveDraft();
            this._refreshZones();
            break;
          }
          case 'del-zone':
            this._deleteZone();
            break;
          case 'export-zones':
            this._modal('复制后替换 config.js 中 puppet 下的 zones: [] 这一段。', this._zonesCode());
            break;
          case 'restore-draft': {
            const d = this._draft();
            if (d) {
              this.cfg.puppet.zones = JSON.parse(d);
              this.selected = this.zones.length ? 0 : -1;
              this._refreshZones();
            }
            break;
          }
          case 'copy': {
            const ta = this.modal.querySelector('textarea');
            ta.select();
            const done = () => SW.ui.toast('已复制到剪贴板', 2500);
            if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, () => document.execCommand('copy') && done());
            else if (document.execCommand('copy')) done();
            break;
          }
          case 'close-modal':
            this.modal.hidden = true;
            break;
        }
      };
      this.el.addEventListener('click', onClick);
      this.modal.addEventListener('click', onClick);
      this.el.querySelectorAll('[data-opt]').forEach((input) => {
        input.addEventListener('change', () => {
          this.opts[input.getAttribute('data-opt')] = input.checked;
          this._syncModes();
        });
      });
    }

    _modal(tip, text) {
      this.modal.querySelector('.sw-modal-tip').textContent = tip;
      this.modal.querySelector('textarea').value = text;
      this.modal.hidden = false;
    }

    /* ---------------- 叠加层：绘制与拖拽木偶区域 ---------------- */

    _px(u, v) {
      const s = this.app.imageToScreen(u, v);
      return [s[0] * window.innerWidth, s[1] * window.innerHeight];
    }

    _uv(x, y) {
      return this.app.screenToImage(x / window.innerWidth, y / window.innerHeight);
    }

    // 屏幕上 1 个「插画高度单位」对应的像素数
    _pxPerUnit() {
      return window.innerHeight / this.app.puppetMapping().scale[1];
    }

    _hit(x, y) {
      const k = this._pxPerUnit();
      const order = this.zones.map((_, i) => i);
      if (this.selected >= 0) order.unshift(order.splice(this.selected, 1)[0]);
      for (const i of order) {
        const z = this.zones[i];
        const P = this._px(z.pivot[0], z.pivot[1]);
        const C = this._px(z.center[0], z.center[1]);
        const R = z.radius * k;
        if (Math.hypot(x - P[0], y - P[1]) < 10) return { i, part: 'pivot' };
        if (Math.hypot(x - C[0], y - C[1]) < 10) return { i, part: 'center' };
        if (Math.hypot(x - (C[0] + R), y - C[1]) < 10) return { i, part: 'radius' };
      }
      for (const i of order) {
        const z = this.zones[i];
        const C = this._px(z.center[0], z.center[1]);
        if (Math.hypot(x - C[0], y - C[1]) < z.radius * k) return { i, part: 'move' };
      }
      return null;
    }

    _bindOverlay() {
      const ov = this.overlay;
      ov.addEventListener('pointerdown', (e) => {
        const h = this._hit(e.clientX, e.clientY);
        if (!h) return;
        this.selected = h.i;
        const z = this.zones[h.i];
        this.drag = { part: h.part, start: this._uv(e.clientX, e.clientY), pivot: z.pivot.slice(), center: z.center.slice() };
        ov.setPointerCapture(e.pointerId);
        this._refreshZones();
      });
      ov.addEventListener('pointermove', (e) => {
        const h = this.drag ? null : this._hit(e.clientX, e.clientY);
        ov.style.cursor = this.drag ? 'grabbing' : h ? (h.part === 'move' ? 'grab' : 'pointer') : 'crosshair';
        if (!this.drag) return;
        const z = this.zones[this.selected];
        const uv = this._uv(e.clientX, e.clientY);
        const d = this.drag;
        if (d.part === 'pivot') z.pivot = [round(uv[0], 4), round(uv[1], 4)];
        else if (d.part === 'center') z.center = [round(uv[0], 4), round(uv[1], 4)];
        else if (d.part === 'radius') {
          const C = this._px(z.center[0], z.center[1]);
          z.radius = round(Math.max(0.01, Math.hypot(e.clientX - C[0], e.clientY - C[1]) / this._pxPerUnit()), 4);
        } else {
          const du = uv[0] - d.start[0];
          const dv = uv[1] - d.start[1];
          z.pivot = [round(d.pivot[0] + du, 4), round(d.pivot[1] + dv, 4)];
          z.center = [round(d.center[0] + du, 4), round(d.center[1] + dv, 4)];
        }
      });
      const end = () => {
        if (!this.drag) return;
        this.drag = null;
        this._saveDraft();
        this._refreshZones();
      };
      ov.addEventListener('pointerup', end);
      ov.addEventListener('pointercancel', end);
      ov.addEventListener('dblclick', (e) => {
        if (this._hit(e.clientX, e.clientY)) return;
        const uv = this._uv(e.clientX, e.clientY);
        this._addZone(uv[0], uv[1]);
      });
    }

    _clearOverlay() {
      this.octx.setTransform(1, 0, 0, 1, 0, 0);
      this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }

    _onFrame() {
      if (!this.isOpen) return;
      if (this.tab === 'info') this._updateInfo();
      if (!this.opts.showZones) return;
      const ov = this.overlay;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(window.innerWidth * dpr);
      const h = Math.round(window.innerHeight * dpr);
      if (ov.width !== w || ov.height !== h) {
        ov.width = w;
        ov.height = h;
      }
      const ctx = this.octx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const k = this._pxPerUnit();
      const aspect = this.app.imgW / this.app.imgH;
      this.zones.forEach((z, i) => {
        const sel = i === this.selected;
        const P = this._px(z.pivot[0], z.pivot[1]);
        const C = this._px(z.center[0], z.center[1]);
        const R = z.radius * k;
        const col = sel ? '#ff8fb8' : 'rgba(255,255,255,0.85)';
        ctx.globalAlpha = z.enabled === false ? 0.4 : 1;
        ctx.lineWidth = sel ? 2 : 1.2;
        ctx.strokeStyle = col;
        ctx.setLineDash(sel ? [] : [6, 5]);
        ctx.beginPath();
        ctx.arc(C[0], C[1], R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(C[0], C[1], R * (z.feather == null ? 0.35 : z.feather), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(P[0], P[1]);
        ctx.lineTo(C[0], C[1]);
        ctx.stroke();
        // 摆动方向（双向箭头）
        const dir = SW.puppet.zoneDir(z, aspect);
        const L = Math.max(14, Math.min(60, z.amplitude * k * 6));
        ctx.beginPath();
        ctx.moveTo(C[0] - dir[0] * L, C[1] - dir[1] * L);
        ctx.lineTo(C[0] + dir[0] * L, C[1] + dir[1] * L);
        ctx.stroke();
        // 手柄
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(40,20,40,0.8)';
        ctx.lineWidth = 1;
        ctx.fillRect(P[0] - 5, P[1] - 5, 10, 10);
        ctx.strokeRect(P[0] - 5, P[1] - 5, 10, 10);
        ctx.beginPath();
        ctx.arc(C[0], C[1], 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(C[0] + R, C[1] - 6);
        ctx.lineTo(C[0] + R + 6, C[1]);
        ctx.lineTo(C[0] + R, C[1] + 6);
        ctx.lineTo(C[0] + R - 6, C[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.font = '12px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 3;
        ctx.fillText(z.name || '区域 ' + (i + 1), P[0] + 9, P[1] - 7);
        ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;
    }

    _updateInfo() {
      const now = performance.now();
      if (now - (this._infoAt || 0) < 500) return;
      this._infoAt = now;
      const a = this.app;
      const s = a.stats;
      const lt = a.layers.background;
      const rawBg = a.raw && a.raw.background;
      const lines = [
        '运行环境    ' + (SW.env.isWallpaperEngine ? 'Wallpaper Engine' : '浏览器预览'),
        '渲染器      ' + (a.renderer.kind === 'webgl' ? 'WebGL' : 'Canvas 2D（简化模式）'),
        '帧率        ' + s.fps.toFixed(1) + ' fps（上限 ' + a.loop.fps + '）',
        'CPU 每帧    ' + s.ms.toFixed(2) + ' ms',
        '渲染分辨率  ' + a.W + ' × ' + a.H,
        '插画原图    ' + (rawBg ? (rawBg.naturalWidth || rawBg.width) + ' × ' + (rawBg.naturalHeight || rawBg.height) : '-') + (a.usingPlaceholder ? '（占位图）' : ''),
        '插画纹理    ' + (lt ? (lt.naturalWidth || lt.width) + ' × ' + (lt.naturalHeight || lt.height) : '-'),
        '精灵数量    ' + a.batch.count,
        '木偶区域    ' + a.frame.puppet.count + ' / 上限 ' + (a.renderer.maxZones || 0),
        '可选素材    ' + ['foreground', 'depth', 'mask'].map((k) => k + (a.layers[k] ? '✓' : '✗')).join('  '),
      ];
      this.$('.sw-info').textContent = lines.join('\n');
    }
  }

  SW.Editor = Editor;
})((window.SW = window.SW || {}));
