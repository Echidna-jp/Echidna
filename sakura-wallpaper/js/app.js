/**
 * App：把素材加载、模拟系统、镜头与渲染器串起来。
 * 想加新特效：
 *   - 粒子类：仿照 sim/motes.js 写一个系统，在 _buildFrame 中调用它的 emit
 *   - 后期类：在 render/shaders.js 的 COMPOSITE_FS 中添加，或在 webgl-renderer.js 中加 pass
 */
(function (SW) {
  'use strict';
  const { TAU, wrapPhase } = SW.math;

  class App {
    constructor(cfg) {
      this.cfg = cfg;
      this.input = new SW.Input();
      this.wind = new SW.Wind();
      this.camera = new SW.Camera();
      this.atlas = SW.atlas.build();
      this.petals = new SW.Petals(this.atlas);
      this.bokeh = new SW.Bokeh(this.atlas);
      this.motes = new SW.Motes(this.atlas);
      this.batch = new SW.SpriteBatch(512);
      this.loop = new SW.Loop((dt) => this.tick(dt));

      this.renderer = null;
      this.W = 1;
      this.H = 1;
      this.time = 0;
      this.hostFps = 0; // Wallpaper Engine 全局帧率上限
      this.customImage = null; // Wallpaper Engine「自定义插画」
      this.overrides = {}; // 浏览器拖入的图片：{ background, foreground, depth, mask }
      this.raw = null; // 原始图片
      this.layers = {}; // 缩放后交给渲染器的图片
      this.imgW = 16;
      this.imgH = 9;
      this.usingPlaceholder = false;
      this.puppetDebug = false;
      this.onFrame = []; // 每帧回调（编辑器用）
      this.stats = { fps: 0, ms: 0, frames: 0, acc: 0, cpu: 0 };
      this._loadToken = 0;
      this._ready = false;
      this._rayPhase = [0, 0, 0];

      this.frame = {
        W: 1,
        H: 1,
        bg: SW.Camera.createMapping(),
        fg: null,
        fgMap: SW.Camera.createMapping(),
        aspect: 16 / 9,
        depthShift: [0, 0],
        puppet: SW.puppet.createPack(1),
        puppetDebug: false,
        batch: this.batch,
        cells: this.atlas.cells,
        split: 0,
        bloom: cfg.light.bloom,
        sun: { pos: [0, 0], color: cfg.light.sun.color, intensity: 0, radius: 1 },
        rays: { intensity: 0, density: 1, phase: new Float32Array(3) },
        vignette: cfg.light.vignette,
        grade: cfg.light.grade,
        seed: 0,
      };
    }

    async start() {
      this._createRenderer('webgl');
      this._resize();
      let resizeTimer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => this._resize(), 150);
      });
      document.addEventListener('visibilitychange', () => {
        this.loop.setPaused('hidden', this.cfg.performance.pauseWhenHidden && document.hidden);
      });
      this._installDrop();
      await this.loadImages();
      this.loop.start();
    }

    /* ---------------- 渲染器 ---------------- */

    _createRenderer(kind) {
      // 一个 canvas 只能拥有一种上下文，切换渲染器时换一块新画布
      const old = document.getElementById('stage');
      const canvas = document.createElement('canvas');
      canvas.id = 'stage';
      if (this._ready) canvas.classList.add('ready');
      old.parentNode.replaceChild(canvas, old);
      if (this.renderer) this.renderer.dispose();

      let r = null;
      if (kind === 'webgl') {
        try {
          r = SW.WebGLRenderer.create(canvas, { powerPreference: this.cfg.performance.powerPreference });
        } catch (e) {
          console.warn('[Sakura] WebGL 初始化失败，改用 Canvas 2D：', e);
          r = null;
        }
      }
      if (!r) r = SW.CanvasRenderer.create(canvas);
      r.setAtlas(this.atlas.canvas);
      this.renderer = r;
      this.canvas = canvas;
      this.frame.puppet = SW.puppet.createPack(Math.max(1, r.maxZones));
      this.W = this.H = 0; // 强制下一次 _resize 生效
    }

    _resize() {
      if (!this.renderer) return;
      const cfg = this.cfg;
      const q = SW.config.quality(cfg);
      const pc = cfg.performance;
      const dpr = Math.min(window.devicePixelRatio || 1, pc.maxPixelRatio);
      const scale = Math.max(0.25, pc.renderScale * q.renderScale);
      const W = Math.max(1, Math.round(window.innerWidth * dpr * scale));
      const H = Math.max(1, Math.round(window.innerHeight * dpr * scale));
      const levels = Math.max(1, Math.min(cfg.light.bloom.levels, q.bloomLevels));
      this.W = W;
      this.H = H;
      this.renderer.resize(W, H, levels);
      this.camera.resize(W, H);
      this.petals.resize(W, H);
      this.bokeh.resize(W, H);
      this.motes.resize(W, H);
      // 窗口变大很多时，按新分辨率重新缩放插画
      if (this.raw && this._fittedFor && W * H > this._fittedFor * 1.3) this._applyImages();
    }

    /* ---------------- 素材 ---------------- */

    async loadImages() {
      const token = ++this._loadToken;
      const ic = this.cfg.image;
      const ov = this.overrides;
      const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const bgList = [ov.background, this.customImage].concat(list(ic.background)).filter(Boolean);
      const opt = (slot) => {
        const l = [ov[slot]].concat(list(ic[slot])).filter(Boolean);
        return l.length ? SW.assets.loadFirst(l) : Promise.resolve(null);
      };
      const [bg, fg, depth, mask] = await Promise.all([
        SW.assets.loadFirst(bgList),
        opt('foreground'),
        opt('depth'),
        opt('motionMask'),
      ]);
      if (token !== this._loadToken) return; // 已有更新的加载请求

      if (this.customImage && (!bg || bg.src !== this.customImage) && !ov.background) {
        SW.ui.toast('自定义插画加载失败，已使用默认插画');
      }
      this.usingPlaceholder = !bg;
      if (!bg) {
        SW.ui.toast('未找到 assets/main.png，当前显示内置占位图。把插画放进 assets 文件夹即可。', 9000);
      }
      for (const [name, res] of [['foreground', fg], ['depth', depth], ['motionMask', mask]]) {
        if (ic[name] && !res) console.warn('[Sakura] 可选素材加载失败：', ic[name]);
      }
      this.raw = {
        background: bg ? bg.img : SW.assets.createPlaceholder(1920, 1080),
        foreground: fg && fg.img,
        depth: depth && depth.img,
        mask: mask && mask.img,
      };
      this._applyImages();
    }

    // 计算插画纹理的长边上限：够当前屏幕显示即可，避免 8K 超分图白白占用显存
    _textureLimit(img) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      let limit = this.renderer.maxTextureSize || 4096;
      const user = this.cfg.image.maxTextureSize;
      if (user > 0) return Math.min(limit, user);
      const q = SW.config.quality(this.cfg);
      const s = Math.max(this.W / iw, this.H / ih) * 1.12 * q.textureScale;
      limit = Math.min(limit, Math.ceil(Math.max(iw, ih) * Math.min(1, s)));
      return Math.max(1024, limit);
    }

    _applyImages() {
      const raw = this.raw;
      const side = this._textureLimit(raw.background);
      const fit = SW.assets.fitImage;
      const layers = {
        background: fit(raw.background, side),
        foreground: raw.foreground ? fit(raw.foreground, side) : null,
        depth: raw.depth ? fit(raw.depth, Math.ceil(side / 2)) : null,
        mask: raw.mask ? fit(raw.mask, Math.ceil(side / 2)) : null,
      };
      this._fittedFor = this.W * this.H;
      try {
        this.renderer.setLayers(layers);
      } catch (e) {
        if (this.renderer.kind !== 'webgl') throw e;
        // 浏览器以 file:// 打开时，WebGL 不允许读取本地图片 → 降级到 Canvas 2D
        console.warn('[Sakura] WebGL 无法读取图片，降级为 Canvas 2D：', e);
        this._createRenderer('canvas');
        this._resize();
        this.renderer.setLayers(layers);
        this.fallbackReason = 'file';
        SW.ui.toast('浏览器直接打开 file:// 时 WebGL 无法读取本地图片，已降级为简化模式（无 Bloom / 木偶）。请双击 preview.bat 预览完整效果，或把图片拖进窗口。', 14000);
      }
      this.layers = layers;
      const bg = layers.background;
      this.imgW = bg.naturalWidth || bg.width;
      this.imgH = bg.naturalHeight || bg.height;
    }

    setCustomImage(url) {
      if (url === this.customImage) return;
      this.customImage = url;
      if (this.renderer) this.loadImages();
    }

    _installDrop() {
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
        if (!files.length) return;
        const names = [];
        for (const f of files) {
          const n = f.name.toLowerCase();
          const slot = /depth|深度/.test(n) ? 'depth'
            : /mask|遮罩/.test(n) ? 'motionMask'
            : /fg|fore|char|角色|前景/.test(n) ? 'foreground'
            : 'background';
          if (this.overrides[slot]) URL.revokeObjectURL(this.overrides[slot]);
          this.overrides[slot] = URL.createObjectURL(f);
          names.push(f.name + ' → ' + slot);
        }
        // 拖入的图片是同源 blob，可以重新尝试 WebGL
        if (this.renderer.kind !== 'webgl' && this.fallbackReason === 'file') {
          this.fallbackReason = null;
          this._createRenderer('webgl');
          this._resize();
        }
        SW.ui.toast('已载入：' + names.join('，'));
        this.loadImages();
      });
    }

    /* ---------------- 配置变更（来自 Wallpaper Engine / 编辑器） ---------------- */

    onConfigChange(paths) {
      if (!this.renderer) return;
      let resize = false;
      let refit = false;
      let reload = false;
      for (const p of paths) {
        if (p.startsWith('performance.') || p === 'light.bloom.levels') resize = true;
        if (p === 'performance.quality') refit = true;
        if (p.startsWith('image.')) reload = true;
      }
      if (resize) {
        // 拖动滑块时会连续触发，稍作合并
        this._refitPending = this._refitPending || refit;
        clearTimeout(this._cfgTimer);
        this._cfgTimer = setTimeout(() => {
          this._resize();
          if (this.raw && this._refitPending) this._applyImages();
          this._refitPending = false;
        }, 200);
      }
      if (reload) this.loadImages();
    }

    /* ---------------- 每帧 ---------------- */

    tick(dt) {
      const cfg = this.cfg;
      if (!this.raw || this.renderer.lost) return;
      const t0 = performance.now();
      this.time += dt;
      this.loop.fps = this.hostFps > 0 ? Math.min(cfg.performance.fps, this.hostFps) : cfg.performance.fps;

      this.petals.sync(cfg);
      this.bokeh.sync(cfg);
      this.motes.sync(cfg);

      this.wind.update(this.time, cfg);
      const hasFg = !!this.layers.foreground;
      this.camera.update(dt, this.time, cfg, this.input, hasFg ? Math.max(1, cfg.camera.parallax.foreground) : 1);
      this.petals.update(dt, cfg, this.wind, this.camera);
      this.bokeh.update(dt, cfg, this.wind);
      this.motes.update(dt, cfg, this.wind);

      this._buildFrame(dt);
      this.renderer.render(this.frame);

      if (!this._ready) {
        this._ready = true;
        this.canvas.classList.add('ready');
      }
      for (const fn of this.onFrame) fn(dt);
      this._stats(dt, performance.now() - t0);
    }

    _buildFrame(dt) {
      const cfg = this.cfg;
      const f = this.frame;
      const cam = this.camera;
      const lc = cfg.light;
      f.W = this.W;
      f.H = this.H;

      cam.mapping(cfg, 1, this.imgW, this.imgH, f.bg);
      if (this.layers.foreground) {
        f.fg = cam.mapping(cfg, cfg.camera.parallax.foreground, this.imgW, this.imgH, f.fgMap);
      } else {
        f.fg = null;
      }
      f.aspect = this.imgW / this.imgH;
      const pc = cfg.camera.parallax;
      const dpx = pc.enabled ? pc.depth * this.H : 0;
      f.depthShift[0] = (cam.parallaxNorm[0] * dpx) / (f.bg.pxScale * this.imgW);
      f.depthShift[1] = (cam.parallaxNorm[1] * dpx) / (f.bg.pxScale * this.imgH);

      SW.puppet.pack(cfg, dt, this.wind, f.aspect, f.puppet);
      f.puppetDebug = this.puppetDebug;

      // 精灵：远景花瓣 | (前景层) | 光尘、中近景花瓣、光斑
      const b = this.batch;
      b.reset();
      this.petals.emit(b, cfg, cam, 0, this.petals.farCount);
      f.split = b.count;
      this.motes.emit(b, cfg, cam);
      this.petals.emit(b, cfg, cam, this.petals.farCount, this.petals.items.length);
      this.bokeh.emit(b, cfg, cam);

      // 光源：呼吸明暗，并随镜头略微移动
      const sc = lc.sun;
      const pulse = 1 + sc.pulse * Math.sin((TAU * this.time) / Math.max(1, sc.pulsePeriod));
      f.sun.pos[0] = sc.position[0] + (cam.offset[0] * sc.follow) / this.W;
      f.sun.pos[1] = sc.position[1] + (cam.offset[1] * sc.follow) / this.H;
      f.sun.color = sc.color;
      f.sun.intensity = sc.enabled ? sc.intensity * pulse : 0;
      f.sun.radius = sc.radius;

      const rc = lc.rays;
      const ph = this._rayPhase;
      ph[0] = wrapPhase(ph[0] + TAU * 0.031 * rc.speed * dt);
      ph[1] = wrapPhase(ph[1] + TAU * 0.023 * rc.speed * dt);
      ph[2] = wrapPhase(ph[2] + TAU * 0.017 * rc.speed * dt);
      f.rays.phase[0] = ph[0];
      f.rays.phase[1] = ph[1];
      f.rays.phase[2] = ph[2];
      f.rays.intensity = sc.enabled ? rc.intensity * (0.8 + 0.2 * pulse) : 0;
      f.rays.density = rc.density;

      f.bloom = lc.bloom;
      f.vignette = lc.vignette;
      f.grade = lc.grade;
    }

    _stats(dt, cpuMs) {
      const s = this.stats;
      s.frames++;
      s.acc += dt;
      s.cpu += cpuMs;
      if (s.acc >= 1) {
        s.fps = s.frames / s.acc;
        s.ms = s.cpu / s.frames;
        s.frames = 0;
        s.acc = 0;
        s.cpu = 0;
        SW.ui.setFps(this.cfg.debug.showFps ? s.fps.toFixed(0) + ' fps · ' + s.ms.toFixed(1) + ' ms' : '');
      }
    }

    /* ---------------- 坐标换算（编辑器用） ---------------- */

    // 木偶作用的图层映射（有前景层时作用于前景层）
    puppetMapping() {
      return this.frame.fg || this.frame.bg;
    }

    imageToScreen(u, v) {
      const m = this.puppetMapping();
      return [(u - m.offset[0]) / m.scale[0], (v - m.offset[1]) / m.scale[1]];
    }

    screenToImage(x, y) {
      const m = this.puppetMapping();
      return [x * m.scale[0] + m.offset[0], y * m.scale[1] + m.offset[1]];
    }
  }

  SW.App = App;
})((window.SW = window.SW || {}));
