/* 全局风场：一阵阵缓慢起伏的风，花瓣、光尘、木偶摆动共用，让所有动态「在同一阵风里」 */
(function (SW) {
  'use strict';
  const { fbm1, smoothstep } = SW.math;

  class Wind {
    constructor() {
      this.gust = 0; // 当前阵风 0~1（已乘配置强度）
      this.strength = 0; // 当前风力（无符号）
      this.value = 0; // 带方向的风力
    }

    update(t, cfg) {
      const c = cfg.wind;
      // 大部分时间平静，偶尔起一阵风
      const n = 0.5 + 0.5 * fbm1(t / Math.max(1, c.gustPeriod) + 3.7);
      this.gust = smoothstep(0.4, 0.95, n) * c.gust;
      this.strength = c.strength * (0.6 + 1.1 * this.gust);
      this.value = (c.direction < 0 ? -1 : 1) * this.strength;
    }
  }

  SW.Wind = Wind;
})((window.SW = window.SW || {}));
