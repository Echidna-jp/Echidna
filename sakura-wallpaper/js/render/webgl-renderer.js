/**
 * WebGL 渲染器（主渲染路径）
 * 场景 → Bloom → 合成。支持 WebGL 上下文丢失后自动恢复（长时间挂机、显卡驱动重置时）。
 */
(function (SW) {
  'use strict';
  const S = SW.shaders;
  const U = SW.glutil;
  const STRIDE = SW.SpriteBatch.STRIDE;
  const VERT_FLOATS = 8; // x, y, u, v, r, g, b, a

  class WebGLRenderer {
    static create(canvas, opts) {
      const gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: (opts && opts.powerPreference) || 'default',
      });
      if (!gl) return null;
      return new WebGLRenderer(canvas, gl);
    }

    constructor(canvas, gl) {
      this.kind = 'webgl';
      this.canvas = canvas;
      this.gl = gl;
      this.lost = false;
      this.W = 0;
      this.H = 0;
      this._sources = { atlas: null, layers: {} };
      this._spriteVerts = new Float32Array(0);
      this._bloomLevels = 0;

      this._onLost = (e) => {
        e.preventDefault();
        this.lost = true;
      };
      this._onRestored = () => {
        this._init();
        if (this._sources.atlas) this.setAtlas(this._sources.atlas);
        this.setLayers(this._sources.layers);
        const W = this.W;
        const H = this.H;
        this.W = this.H = 0;
        this.resize(W, H);
        this.lost = false;
      };
      canvas.addEventListener('webglcontextlost', this._onLost);
      canvas.addEventListener('webglcontextrestored', this._onRestored);
      this._init();
    }

    _init() {
      const gl = this.gl;
      // 按显卡 uniform 上限决定木偶区域上限（桌面显卡通常远超需求）
      this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
      const maxVec = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
      this.maxZones = Math.max(1, Math.min(SW.puppet.MAX_ZONES, Math.floor((maxVec - 16) / 4)));
      const imageFs = '#define MAX_ZONES ' + this.maxZones + '\n' + S.IMAGE_FS;

      this.progImage = U.createProgram(gl, S.FULLSCREEN_VS, imageFs);
      this.progSprite = U.createProgram(gl, S.SPRITE_VS, S.SPRITE_FS, ['aPos', 'aUv', 'aColor']);
      this.progDown = U.createProgram(gl, S.FULLSCREEN_VS, S.BLOOM_DOWN_FS);
      this.progUp = U.createProgram(gl, S.FULLSCREEN_VS, S.BLOOM_UP_FS);
      this.progComposite = U.createProgram(gl, S.FULLSCREEN_VS, S.COMPOSITE_FS);

      // 覆盖全屏的大三角形
      this.triBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      this.spriteBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();
      this._indexCapacity = 0;

      this.texGray = U.createSolidTexture(gl, 128, 128, 128, 255);
      this.texWhite = U.createSolidTexture(gl, 255, 255, 255, 255);
      this.texBlack = U.createSolidTexture(gl, 0, 0, 0, 255);
      this.tex = { atlas: null, background: null, foreground: null, depth: null, mask: null };
      this.scene = null;
      this.down = [];
      this.up = [];
    }

    setAtlas(canvas) {
      const gl = this.gl;
      this._sources.atlas = canvas;
      if (this.tex.atlas) gl.deleteTexture(this.tex.atlas);
      this.tex.atlas = U.createTexture(gl, canvas, { premultiply: true, mipmap: true });
    }

    // layers：{ background, foreground, depth, mask }，值为 Image/Canvas 或 null。
    // 浏览器以 file:// 打开时这里会抛出 SecurityError，由上层降级处理
    setLayers(layers) {
      const gl = this.gl;
      const keys = ['background', 'foreground', 'depth', 'mask'];
      for (const k of keys) {
        if (this.tex[k]) {
          gl.deleteTexture(this.tex[k]);
          this.tex[k] = null;
        }
      }
      for (const k of keys) {
        const src = layers[k];
        if (src) this.tex[k] = U.createTexture(gl, src, { premultiply: k === 'foreground' });
      }
      this._sources.layers = layers;
    }

    resize(W, H, bloomLevels) {
      const gl = this.gl;
      const levels = bloomLevels || this._bloomLevels || 5;
      if (W === this.W && H === this.H && levels === this._bloomLevels) return;
      this.W = W;
      this.H = H;
      this._bloomLevels = levels;
      this.canvas.width = W;
      this.canvas.height = H;
      U.deleteTarget(gl, this.scene);
      this.down.forEach((t) => U.deleteTarget(gl, t));
      this.up.forEach((t) => U.deleteTarget(gl, t));
      this.scene = U.createTarget(gl, W, H);
      this.down = [];
      this.up = [];
      let w = W;
      let h = H;
      for (let i = 0; i < levels; i++) {
        w = Math.floor(w / 2);
        h = Math.floor(h / 2);
        if (w < 4 || h < 4) break;
        this.down.push(U.createTarget(gl, w, h));
      }
      for (let i = 0; i < this.down.length - 1; i++) {
        this.up.push(U.createTarget(gl, this.down[i].w, this.down[i].h));
      }
    }

    _drawTriangle(prog) {
      const gl = this.gl;
      gl.useProgram(prog.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1);
      gl.disableVertexAttribArray(2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _bindTex(unit, tex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }

    _drawImageLayer(tex, map, frame, withPuppet) {
      const gl = this.gl;
      const p = this.progImage;
      gl.useProgram(p.prog);
      this._bindTex(0, tex);
      this._bindTex(1, this.tex.depth || this.texGray);
      this._bindTex(2, this.tex.mask || this.texWhite);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform1i(p.u.uDepth, 1);
      gl.uniform1i(p.u.uMask, 2);
      gl.uniform2f(p.u.uUvScale, map.scale[0], map.scale[1]);
      gl.uniform2f(p.u.uUvOffset, map.offset[0], map.offset[1]);
      // 深度视差只作用于背景层（前景层本身已有独立视差）
      const useDepth = !!this.tex.depth && !withPuppet.isForeground;
      gl.uniform1f(p.u.uHasDepth, useDepth ? 1 : 0);
      gl.uniform2f(p.u.uDepthShift, frame.depthShift[0], frame.depthShift[1]);
      gl.uniform1f(p.u.uHasMask, this.tex.mask ? 1 : 0);
      gl.uniform1f(p.u.uAspect, frame.aspect);
      const pk = frame.puppet;
      const zones = withPuppet.enabled ? pk.count : 0;
      gl.uniform1f(p.u.uZoneCount, zones);
      if (zones > 0) {
        gl.uniform4fv(p.u.uZoneA, pk.A);
        gl.uniform4fv(p.u.uZoneB, pk.B);
        gl.uniform4fv(p.u.uZoneC, pk.C);
        gl.uniform4fv(p.u.uZoneD, pk.D);
      }
      gl.uniform1f(p.u.uDebug, withPuppet.enabled && frame.puppetDebug ? 1 : 0);
      this._drawTriangle(p);
    }

    _uploadSprites(batch) {
      const gl = this.gl;
      const n = batch.count;
      if (n === 0) return;
      const need = n * 4 * VERT_FLOATS;
      if (this._spriteVerts.length < need) this._spriteVerts = new Float32Array(need * 2);
      const v = this._spriteVerts;
      const d = batch.data;
      const cells = this._cells;
      let o = 0;
      for (let i = 0; i < n; i++) {
        const s = i * STRIDE;
        const cell = cells[d[s]];
        const cx = d[s + 1];
        const cy = d[s + 2];
        const hw = d[s + 3] * 0.5;
        const hh = d[s + 4] * 0.5;
        const c = Math.cos(d[s + 5]);
        const sn = Math.sin(d[s + 5]);
        const a = d[s + 9];
        const r = d[s + 6] * a;
        const g = d[s + 7] * a;
        const b = d[s + 8] * a;
        const outA = a * (1 - d[s + 10]);
        // 四个角：左上、右上、右下、左下
        for (let k = 0; k < 4; k++) {
          const lx = k === 0 || k === 3 ? -hw : hw;
          const ly = k < 2 ? -hh : hh;
          v[o++] = cx + lx * c - ly * sn;
          v[o++] = cy + lx * sn + ly * c;
          v[o++] = k === 0 || k === 3 ? cell.u0 : cell.u1;
          v[o++] = k < 2 ? cell.v0 : cell.v1;
          v[o++] = r;
          v[o++] = g;
          v[o++] = b;
          v[o++] = outA;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, o), gl.DYNAMIC_DRAW);

      if (this._indexCapacity < n) {
        const cap = Math.min(16383, Math.max(n, this._indexCapacity * 2, 256));
        const idx = new Uint16Array(cap * 6);
        for (let i = 0; i < cap; i++) {
          const b4 = i * 4;
          idx.set([b4, b4 + 1, b4 + 2, b4, b4 + 2, b4 + 3], i * 6);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
        this._indexCapacity = cap;
      }
    }

    _drawSprites(from, to) {
      const count = Math.min(to, this._indexCapacity) - from;
      if (count <= 0 || !this.tex.atlas) return;
      const gl = this.gl;
      const p = this.progSprite;
      gl.useProgram(p.prog);
      this._bindTex(0, this.tex.atlas);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform2f(p.u.uResolution, this.W, this.H);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
      const stride = VERT_FLOATS * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, from * 12);
    }

    _bloom(frame) {
      const gl = this.gl;
      const b = frame.bloom;
      if (!b.enabled || b.intensity <= 0 || this.down.length === 0) return this.texBlack;
      gl.disable(gl.BLEND);
      const down = this.progDown;
      let src = this.scene;
      for (let i = 0; i < this.down.length; i++) {
        const dst = this.down[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.useProgram(down.prog);
        this._bindTex(0, src.tex);
        gl.uniform1i(down.u.uTex, 0);
        gl.uniform2f(down.u.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform1f(down.u.uPrefilter, i === 0 ? 1 : 0);
        gl.uniform2f(down.u.uThreshold, b.threshold, b.knee);
        this._drawTriangle(down);
        src = dst;
      }
      const up = this.progUp;
      for (let i = this.up.length - 1; i >= 0; i--) {
        const dst = this.up[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.useProgram(up.prog);
        this._bindTex(0, src.tex);
        this._bindTex(1, this.down[i].tex);
        gl.uniform1i(up.u.uTex, 0);
        gl.uniform1i(up.u.uBase, 1);
        gl.uniform2f(up.u.uTexel, 1 / src.w, 1 / src.h);
        this._drawTriangle(up);
        src = dst;
      }
      return src.tex;
    }

    render(frame) {
      if (this.lost || !this.tex.background || !this.scene) return;
      const gl = this.gl;
      this._cells = frame.cells;

      // —— 1. 场景 ——
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
      gl.viewport(0, 0, this.W, this.H);
      gl.disable(gl.BLEND);
      const hasFg = !!this.tex.foreground && frame.fg;
      this._drawImageLayer(this.tex.background, frame.bg, frame, { enabled: !hasFg, isForeground: false });

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this._uploadSprites(frame.batch);
      if (hasFg) {
        this._drawSprites(0, frame.split);
        this._drawImageLayer(this.tex.foreground, frame.fg, frame, { enabled: true, isForeground: true });
        this._drawSprites(frame.split, frame.batch.count);
      } else {
        this._drawSprites(0, frame.batch.count);
      }

      // —— 2. Bloom ——
      const bloomTex = this._bloom(frame);

      // —— 3. 合成到屏幕 ——
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.disable(gl.BLEND);
      const p = this.progComposite;
      gl.useProgram(p.prog);
      this._bindTex(0, this.scene.tex);
      this._bindTex(1, bloomTex);
      gl.uniform1i(p.u.uScene, 0);
      gl.uniform1i(p.u.uBloom, 1);
      const levels = Math.max(1, this.down.length);
      gl.uniform1f(p.u.uBloomIntensity, (frame.bloom.intensity * 1.5) / levels);
      gl.uniform3fv(p.u.uBloomTint, frame.bloom.tint);
      gl.uniform2f(p.u.uResolution, this.W, this.H);
      const sun = frame.sun;
      gl.uniform2f(p.u.uSunPos, sun.pos[0], sun.pos[1]);
      gl.uniform3fv(p.u.uSunColor, sun.color);
      gl.uniform1f(p.u.uSunIntensity, sun.intensity);
      gl.uniform1f(p.u.uSunRadius, sun.radius);
      gl.uniform1f(p.u.uRayIntensity, frame.rays.intensity);
      gl.uniform1f(p.u.uRayDensity, frame.rays.density);
      gl.uniform3fv(p.u.uRayPhase, frame.rays.phase);
      gl.uniform1f(p.u.uVignette, frame.vignette.intensity);
      gl.uniform1f(p.u.uVignetteRadius, frame.vignette.radius);
      gl.uniform3fv(p.u.uVignetteColor, frame.vignette.color);
      const g = frame.grade;
      gl.uniform4f(p.u.uGrade, g.brightness, g.contrast, g.saturation, g.haze);
      gl.uniform3fv(p.u.uHazeColor, g.hazeColor);
      gl.uniform1f(p.u.uSeed, frame.seed);
      this._drawTriangle(p);
    }

    dispose() {
      this.canvas.removeEventListener('webglcontextlost', this._onLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  }

  SW.WebGLRenderer = WebGLRenderer;
})((window.SW = window.SW || {}));
