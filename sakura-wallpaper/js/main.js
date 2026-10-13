/* 入口：创建 App，接入 Wallpaper Engine，安装浏览器调节面板 */
(function (SW) {
  'use strict';

  const app = new SW.App(window.WALLPAPER_CONFIG);
  SW.app = app;
  SW.wallpaperEngine.attach(app); // 必须同步注册，WE 会在页面加载后立刻调用
  SW.ui.setFps('');

  app.start().catch((e) => {
    console.error('[Sakura] 启动失败：', e);
    SW.ui.toast('壁纸启动失败：' + e.message, 15000);
  });

  SW.editor = new SW.Editor(app);

  // 仅浏览器预览时提示快捷键（WE 中收不到键盘事件，也就不提示）
  setTimeout(() => {
    if (!SW.env.isWallpaperEngine) SW.ui.toast('浏览器预览：按 E 打开调节面板 / 木偶区域编辑器', 6000);
  }, 2500);
})((window.SW = window.SW || {}));
