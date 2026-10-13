/**
 * Wallpaper Engine 接入
 * - applyUserProperties：属性面板 → config（映射规则见 js/params.js）
 * - applyGeneralProperties：读取 WE 全局帧率上限
 * - setPaused：WE 暂停壁纸（全屏游戏等）时停止渲染，零占用
 * 注意：监听器必须在脚本加载时同步注册，WE 会在页面加载后立即调用。
 */
(function (SW) {
  'use strict';

  SW.env = SW.env || { isWallpaperEngine: false };

  // WE 的文件属性返回本地路径，转换成 file:/// URL（逐段编码，兼容中文、空格、# 等字符）
  function fileUrl(path) {
    const parts = String(path).replace(/\\/g, '/').split('/');
    return 'file:///' + parts.map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).filter((s, i) => s || i > 0).join('/');
  }

  function attach(app) {
    window.wallpaperPropertyListener = {
      applyUserProperties(props) {
        SW.env.isWallpaperEngine = true;
        const changed = [];
        for (const key in props) {
          const prop = props[key];
          if (!prop || !('value' in prop)) continue;
          if (key === 'customimage') {
            app.setCustomImage(prop.value ? fileUrl(prop.value) : null);
            continue;
          }
          const p = SW.params.byId(key);
          if (!p || p.we === false) continue;
          SW.config.setPath(app.cfg, p.path, SW.params.toConfig(p, prop.value));
          changed.push(p.path);
        }
        if (changed.length) app.onConfigChange(changed);
      },

      applyGeneralProperties(props) {
        SW.env.isWallpaperEngine = true;
        if (props.fps) app.hostFps = props.fps;
      },

      setPaused(isPaused) {
        app.loop.setPaused('host', !!isPaused);
      },
    };
  }

  SW.wallpaperEngine = { attach, fileUrl };
})((window.SW = window.SW || {}));
