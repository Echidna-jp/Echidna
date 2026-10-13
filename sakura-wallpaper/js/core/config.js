/* 配置工具：路径读写、深拷贝、画质预设 */
(function (SW) {
  'use strict';

  function clone(v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  }

  function getPath(obj, path) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length; i++) {
      if (o == null) return undefined;
      o = o[keys[i]];
    }
    return o;
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  }

  // 画质预设只影响「渲染开销」，不改变画面内容（数量等由用户自己决定）
  const QUALITY = {
    low: { renderScale: 0.75, bloomLevels: 4, textureScale: 0.85 },
    medium: { renderScale: 1, bloomLevels: 5, textureScale: 1 },
    high: { renderScale: 1, bloomLevels: 6, textureScale: 1.25 },
  };

  function quality(cfg) {
    return QUALITY[cfg.performance.quality] || QUALITY.medium;
  }

  SW.config = { clone, getPath, setPath, quality };
})((window.SW = window.SW || {}));
