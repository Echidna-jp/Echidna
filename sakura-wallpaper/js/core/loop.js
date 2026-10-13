/* 主循环：帧率上限、暂停原因管理、dt 限幅（休眠/切回后不会「跳一大步」） */
(function (SW) {
  'use strict';

  class Loop {
    constructor(tick) {
      this.tick = tick;
      this.fps = 30;
      this.pauses = new Set();
      this._raf = 0;
      this._next = 0;
      this._lastTick = 0;
      this._frame = this._frame.bind(this);
    }

    get running() {
      return this._raf !== 0;
    }

    start() {
      if (this._raf || this.pauses.size) return;
      this._lastTick = performance.now();
      this._next = this._lastTick;
      this._raf = requestAnimationFrame(this._frame);
    }

    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    // reason：'host'（Wallpaper Engine）、'hidden'（页面不可见）等，任一存在即暂停
    setPaused(reason, paused) {
      if (paused) this.pauses.add(reason);
      else this.pauses.delete(reason);
      if (this.pauses.size) this.stop();
      else this.start();
    }

    _frame(now) {
      this._raf = requestAnimationFrame(this._frame);
      const interval = 1000 / Math.max(1, this.fps);
      // 用「理想下一帧时刻」累计，允许 2ms 抖动，60Hz 屏幕上能稳定跑出 30/40 等帧率
      if (now < this._next - 2) return;
      this._next += interval;
      if (now - this._next > interval) this._next = now + interval;

      const dt = Math.min((now - this._lastTick) / 1000, 0.1);
      this._lastTick = now;
      this.tick(dt, now);
    }
  }

  SW.Loop = Loop;
})((window.SW = window.SW || {}));
