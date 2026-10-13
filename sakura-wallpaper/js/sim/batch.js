/**
 * 精灵批次：模拟系统往这里写「画什么」，渲染器（WebGL / Canvas 2D）负责「怎么画」。
 * 新增粒子特效时，只需写一个 emit(batch) 往里 push 精灵，无需改渲染器。
 *
 * 每个精灵 11 个浮点：格子索引, x, y, 宽, 高, 旋转, r, g, b, 不透明度, 叠加(0=正常混合 1=发光相加)
 * x/y 为中心点（渲染像素），宽/高为格子尺寸（可为负数表示镜像，用于花瓣翻转）。
 */
(function (SW) {
  'use strict';

  const STRIDE = 11;

  class SpriteBatch {
    constructor(capacity) {
      this.capacity = capacity || 512;
      this.data = new Float32Array(this.capacity * STRIDE);
      this.count = 0;
    }

    reset() {
      this.count = 0;
    }

    push(cell, x, y, w, h, rot, r, g, b, a, add) {
      if (a <= 0.002) return;
      if (this.count >= this.capacity) this._grow();
      const o = this.count * STRIDE;
      const d = this.data;
      d[o] = cell;
      d[o + 1] = x;
      d[o + 2] = y;
      d[o + 3] = w;
      d[o + 4] = h;
      d[o + 5] = rot;
      d[o + 6] = r;
      d[o + 7] = g;
      d[o + 8] = b;
      d[o + 9] = a;
      d[o + 10] = add;
      this.count++;
    }

    _grow() {
      const next = new Float32Array(this.capacity * 2 * STRIDE);
      next.set(this.data);
      this.data = next;
      this.capacity *= 2;
    }
  }

  SpriteBatch.STRIDE = STRIDE;
  SW.SpriteBatch = SpriteBatch;
})((window.SW = window.SW || {}));
