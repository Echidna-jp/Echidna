/**
 * 可调参数清单（唯一来源）
 * ------------------------------------------------------------
 * 同一份清单同时用于：
 *   1. Wallpaper Engine 属性面板（project.json 由 tools/gen-project-json.js 生成）
 *   2. 浏览器调节面板（按 E 打开）
 *   3. Wallpaper Engine 属性 → config 的映射
 *
 * 字段：
 *   id     Wallpaper Engine 属性名（小写字母/数字）
 *   path   对应 config.js 中的路径
 *   scale  面板显示值 × scale = 配置值（例如百分比显示）
 *   we     false 表示只在浏览器面板出现，不进入 Wallpaper Engine
 */
(function (SW) {
  'use strict';

  const P = [
    // —— 画面 ——
    { id: 'quality', group: '画面', label: '画质预设', path: 'performance.quality', type: 'combo',
      options: [{ value: 'low', label: '流畅' }, { value: 'medium', label: '均衡' }, { value: 'high', label: '高画质' }] },
    { id: 'fpslimit', group: '画面', label: '帧率上限', path: 'performance.fps', type: 'slider', min: 10, max: 60, step: 1 },
    { id: 'renderscale', group: '画面', label: '渲染分辨率 %', path: 'performance.renderScale', type: 'slider', min: 50, max: 100, step: 5, scale: 0.01, we: false },
    { id: 'brightness', group: '画面', label: '亮度', path: 'light.grade.brightness', type: 'slider', min: -20, max: 20, step: 1, scale: 0.01 },
    { id: 'saturation', group: '画面', label: '饱和度 %', path: 'light.grade.saturation', type: 'slider', min: 50, max: 150, step: 1, scale: 0.01 },
    { id: 'contrast', group: '画面', label: '对比度 %', path: 'light.grade.contrast', type: 'slider', min: 80, max: 120, step: 1, scale: 0.01, we: false },
    { id: 'haze', group: '画面', label: '梦幻柔雾', path: 'light.grade.haze', type: 'slider', min: 0, max: 100, step: 1, scale: 0.01 },
    { id: 'vignette', group: '画面', label: '暗角', path: 'light.vignette.intensity', type: 'slider', min: 0, max: 100, step: 1, scale: 0.01 },

    // —— 樱花 ——
    { id: 'petals', group: '樱花', label: '樱花花瓣', path: 'petals.enabled', type: 'bool' },
    { id: 'petalcount', group: '樱花', label: '花瓣数量', path: 'petals.count', type: 'slider', min: 0, max: 300, step: 1 },
    { id: 'petalspeed', group: '樱花', label: '下落速度 %', path: 'petals.speed', type: 'slider', min: 10, max: 300, step: 5, scale: 0.01 },
    { id: 'petalsize', group: '樱花', label: '花瓣大小 %', path: 'petals.size', type: 'slider', min: 50, max: 200, step: 5, scale: 0.01 },
    { id: 'petalnear', group: '樱花', label: '前景大花瓣 %', path: 'petals.nearRatio', type: 'slider', min: 0, max: 30, step: 1, scale: 0.01 },
    { id: 'petalfar', group: '樱花', label: '远景小花瓣 %', path: 'petals.farRatio', type: 'slider', min: 0, max: 90, step: 1, scale: 0.01, we: false },
    { id: 'petalspin', group: '樱花', label: '翻转速度 %', path: 'petals.spin', type: 'slider', min: 0, max: 300, step: 5, scale: 0.01 },
    { id: 'petalsway', group: '樱花', label: '摇摆幅度 %', path: 'petals.sway', type: 'slider', min: 0, max: 300, step: 5, scale: 0.01 },
    { id: 'petalopacity', group: '樱花', label: '花瓣不透明度 %', path: 'petals.opacity', type: 'slider', min: 10, max: 100, step: 1, scale: 0.01, we: false },
    { id: 'petaltint', group: '樱花', label: '花瓣色调', path: 'petals.tint', type: 'color' },
    { id: 'wind', group: '樱花', label: '风力 %', path: 'wind.strength', type: 'slider', min: 0, max: 200, step: 5, scale: 0.01 },
    { id: 'winddir', group: '樱花', label: '风向', path: 'wind.direction', type: 'combo', numeric: true,
      options: [{ value: '1', label: '向右' }, { value: '-1', label: '向左' }] },
    { id: 'gust', group: '樱花', label: '阵风 %', path: 'wind.gust', type: 'slider', min: 0, max: 100, step: 1, scale: 0.01 },

    // —— 镜头 ——
    { id: 'mouseparallax', group: '镜头', label: '鼠标视差', path: 'camera.parallax.mouse', type: 'bool' },
    { id: 'parallax', group: '镜头', label: '视差幅度', path: 'camera.parallax.amount', type: 'slider', min: 0, max: 40, step: 1, scale: 0.001 },
    { id: 'idledrift', group: '镜头', label: '自动漂移 %', path: 'camera.parallax.idleDrift', type: 'slider', min: 0, max: 100, step: 1, scale: 0.01, we: false },
    { id: 'breathe', group: '镜头', label: '镜头呼吸', path: 'camera.breathe.enabled', type: 'bool' },
    { id: 'breathezoom', group: '镜头', label: '呼吸强度 ‰', path: 'camera.breathe.zoom', type: 'slider', min: 0, max: 30, step: 1, scale: 0.001 },
    { id: 'breatheperiod', group: '镜头', label: '呼吸周期（秒）', path: 'camera.breathe.period', type: 'slider', min: 4, max: 30, step: 1 },

    // —— 光效 ——
    { id: 'bloom', group: '光效', label: '柔光 Bloom 强度', path: 'light.bloom.intensity', type: 'slider', min: 0, max: 150, step: 1, scale: 0.01 },
    { id: 'bloomthreshold', group: '光效', label: 'Bloom 阈值', path: 'light.bloom.threshold', type: 'slider', min: 30, max: 100, step: 1, scale: 0.01 },
    { id: 'sun', group: '光效', label: '光源光晕', path: 'light.sun.intensity', type: 'slider', min: 0, max: 100, step: 1, scale: 0.01 },
    { id: 'sunx', group: '光效', label: '光源位置 X %', path: 'light.sun.position.0', type: 'slider', min: -30, max: 130, step: 1, scale: 0.01 },
    { id: 'suny', group: '光效', label: '光源位置 Y %', path: 'light.sun.position.1', type: 'slider', min: -30, max: 130, step: 1, scale: 0.01 },
    { id: 'suncolor', group: '光效', label: '光源颜色', path: 'light.sun.color', type: 'color' },
    { id: 'rays', group: '光效', label: '光束强度', path: 'light.rays.intensity', type: 'slider', min: 0, max: 50, step: 1, scale: 0.01 },
    { id: 'bokeh', group: '光效', label: '柔和光斑', path: 'bokeh.enabled', type: 'bool' },
    { id: 'bokehcount', group: '光效', label: '光斑数量', path: 'bokeh.count', type: 'slider', min: 0, max: 40, step: 1 },
    { id: 'bokehintensity', group: '光效', label: '光斑亮度 %', path: 'bokeh.intensity', type: 'slider', min: 0, max: 150, step: 1, scale: 0.01 },
    { id: 'motes', group: '光效', label: '漂浮光尘', path: 'motes.enabled', type: 'bool' },
    { id: 'motecount', group: '光效', label: '光尘数量', path: 'motes.count', type: 'slider', min: 0, max: 200, step: 1 },
    { id: 'moteintensity', group: '光效', label: '光尘亮度 %', path: 'motes.intensity', type: 'slider', min: 0, max: 150, step: 1, scale: 0.01 },

    // —— 木偶 ——
    { id: 'puppet', group: '木偶', label: '头发/衣袖摆动', path: 'puppet.enabled', type: 'bool' },
    { id: 'puppetstrength', group: '木偶', label: '摆动幅度 %', path: 'puppet.strength', type: 'slider', min: 0, max: 300, step: 5, scale: 0.01 },
    { id: 'puppetspeed', group: '木偶', label: '摆动速度 %', path: 'puppet.speed', type: 'slider', min: 25, max: 300, step: 5, scale: 0.01 },
    { id: 'puppetwind', group: '木偶', label: '随风响应 %', path: 'puppet.windResponse', type: 'slider', min: 0, max: 200, step: 5, scale: 0.01, we: false },

    // —— 素材（仅 Wallpaper Engine） ——
    { id: 'customimage', group: '素材', label: '自定义插画（可选）', path: '_customImage', type: 'file', editor: false },
  ];

  // 面板显示值 → 配置值
  function toConfig(p, v) {
    switch (p.type) {
      case 'slider':
        return Number(v) * (p.scale || 1);
      case 'bool':
        return v === true || v === 'true' || v === 1;
      case 'combo':
        return p.numeric ? Number(v) : String(v);
      case 'color':
        if (Array.isArray(v)) return v.slice(0, 3);
        return String(v).trim().split(/\s+/).slice(0, 3).map(Number);
      default:
        return v;
    }
  }

  // 配置值 → 面板显示值
  function toDisplay(p, v) {
    switch (p.type) {
      case 'slider': {
        const d = Number(v) / (p.scale || 1);
        const decimals = (String(p.step).split('.')[1] || '').length;
        return Number(d.toFixed(decimals));
      }
      case 'combo':
        return String(v);
      default:
        return v;
    }
  }

  SW.PARAMS = P;
  SW.params = { toConfig, toDisplay, byId: (id) => P.find((p) => p.id === id) };
})((window.SW = window.SW || {}));
