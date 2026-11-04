'use strict';
/*
 * Antigravity 中文界面 · 主进程钩子
 *
 * 由补丁加在 dist/main.js 的第一行（require('./agzh/main-hook.js')），
 * 在官方代码运行之前，给几个会显示文字的 Electron 接口套一层翻译：
 *   - Menu.buildFromTemplate：托盘菜单、程序坞菜单、界面里弹出的原生右键菜单
 *   - Tray#setContextMenu：托盘里“N 个智能体正在运行”这类动态文字
 *   - dialog.*：退出确认、错误提示等系统对话框
 *   - ipcMain.handle('notification:send')：系统通知
 *
 * 不碰应用菜单（File/Edit/...）：官方代码按英文标签查找它，翻了会坏；
 * 而且 Windows 版隐藏了菜单栏，本来就看不到。
 *
 * 任何一步出错都只记日志、不抛出，保证官方程序照常启动。
 */

const path = require('path');

function log(...args) {
  try { console.log('[agzh]', ...args); } catch (_) { /* ignore */ }
}

let tr = null;
try {
  const { createTranslator } = require('./translator.js');
  const data = require('./zh-CN.json');
  tr = createTranslator(data);
} catch (e) {
  log('词典加载失败，主进程不翻译：', e && e.message);
}

function t(s) {
  if (!tr || typeof s !== 'string') return s;
  const r = tr.translate(s);
  return r == null ? s : r;
}

function translateTemplate(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => {
    if (!item || typeof item !== 'object' || item.constructor !== Object) return item;
    const copy = { ...item };
    if (typeof copy.label === 'string') copy.label = t(copy.label);
    if (typeof copy.sublabel === 'string') copy.sublabel = t(copy.sublabel);
    if (typeof copy.toolTip === 'string') copy.toolTip = t(copy.toolTip);
    if (Array.isArray(copy.submenu)) copy.submenu = translateTemplate(copy.submenu);
    return copy;
  });
}

function translateMenuInPlace(menu, depth = 0) {
  if (!menu || !Array.isArray(menu.items) || depth > 6) return;
  for (const item of menu.items) {
    try {
      if (typeof item.label === 'string' && item.label) {
        const zh = t(item.label);
        if (zh !== item.label) item.label = zh;
      }
      if (item.submenu) translateMenuInPlace(item.submenu, depth + 1);
    } catch (_) { /* ignore */ }
  }
}

function translateBoxOptions(o) {
  if (!o || typeof o !== 'object') return o;
  const c = { ...o };
  for (const k of ['title', 'message', 'detail', 'checkboxLabel', 'buttonLabel', 'nameFieldLabel']) {
    if (typeof c[k] === 'string') c[k] = t(c[k]);
  }
  if (Array.isArray(c.buttons)) c.buttons = c.buttons.map((b) => (typeof b === 'string' ? t(b) : b));
  return c;
}

function install() {
  if (!tr) return;
  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    return;
  }
  const { Menu, Tray, dialog, ipcMain } = electron;

  // 1) Menu.buildFromTemplate
  try {
    const orig = Menu.buildFromTemplate.bind(Menu);
    Menu.buildFromTemplate = function agzhBuildFromTemplate(template) {
      try {
        return orig(translateTemplate(template));
      } catch (e) {
        log('菜单翻译失败，改用原文：', e && e.message);
        return orig(template);
      }
    };
  } catch (e) { log('hook Menu 失败', e && e.message); }

  // 2) Tray#setContextMenu（托盘菜单里的动态文字是直接改 label 再重新设置的）
  try {
    const origSet = Tray.prototype.setContextMenu;
    if (typeof origSet === 'function') {
      Tray.prototype.setContextMenu = function agzhSetContextMenu(menu) {
        try { translateMenuInPlace(menu); } catch (_) { /* ignore */ }
        return origSet.call(this, menu);
      };
    }
  } catch (e) { log('hook Tray 失败', e && e.message); }

  // 3) dialog
  try {
    for (const name of ['showMessageBox', 'showMessageBoxSync']) {
      const orig = dialog[name];
      if (typeof orig !== 'function') continue;
      dialog[name] = function agzhDialog(a, b) {
        // 签名：(options) 或 (window, options)
        if (b === undefined) return orig.call(dialog, translateBoxOptions(a));
        return orig.call(dialog, a, translateBoxOptions(b));
      };
    }
    const origErr = dialog.showErrorBox;
    if (typeof origErr === 'function') {
      dialog.showErrorBox = function agzhErrorBox(title, content) {
        return origErr.call(dialog, t(title), typeof content === 'string' ? t(content) : content);
      };
    }
    for (const name of ['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
      const orig = dialog[name];
      if (typeof orig !== 'function') continue;
      dialog[name] = function agzhFileDialog(a, b) {
        if (b === undefined && a && typeof a === 'object' && !a.webContents) {
          return orig.call(dialog, translateBoxOptions(a));
        }
        return orig.call(dialog, a, translateBoxOptions(b));
      };
    }
  } catch (e) { log('hook dialog 失败', e && e.message); }

  // 4) 系统通知：内容来自界面，在主进程这边翻
  try {
    const origHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = function agzhHandle(channel, listener) {
      if (channel === 'notification:send' && typeof listener === 'function') {
        const wrapped = (event, options, ...rest) => {
          let o = options;
          try {
            if (o && typeof o === 'object') {
              o = { ...o };
              if (typeof o.title === 'string') o.title = t(o.title);
              if (typeof o.body === 'string') o.body = t(o.body);
            }
          } catch (_) { o = options; }
          return listener(event, o, ...rest);
        };
        return origHandle(channel, wrapped);
      }
      return origHandle(channel, listener);
    };
  } catch (e) { log('hook ipcMain 失败', e && e.message); }

  log('主进程钩子已加载', path.basename(__dirname));
}

try { install(); } catch (e) { log('安装钩子失败', e && e.message); }
