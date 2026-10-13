/* 鼠标输入：归一化坐标 [-1, 1]，记录最近活动时间（用于判断是否进入自动漂移） */
(function (SW) {
  'use strict';

  class Input {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.lastMove = -Infinity; // performance.now() 毫秒
      this.inside = false;
      this._onMove = (e) => {
        this.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.y = (e.clientY / window.innerHeight) * 2 - 1;
        this.lastMove = performance.now();
        this.inside = true;
      };
      this._onLeave = () => {
        this.inside = false;
      };
      window.addEventListener('mousemove', this._onMove, { passive: true });
      document.addEventListener('mouseleave', this._onLeave);
    }

    // 距离上次移动的秒数
    idleSeconds() {
      return (performance.now() - this.lastMove) / 1000;
    }
  }

  SW.Input = Input;
})((window.SW = window.SW || {}));
