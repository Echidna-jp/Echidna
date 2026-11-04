'use strict';
/*
 * 由官方原版 app.asar 生成汉化版：
 *   dist/preload.js                 末尾追加：翻译核心 + 页面翻译 + 词典（沙盒 preload 不能 require 其他文件，只能内联）
 *   dist/ideInstall/wizardPreload.js 同上（从旧版 IDE 迁移时的欢迎向导）
 *   dist/main.js                    第一行插入 require('./agzh/main-hook.js')
 *   dist/agzh/*                     主进程钩子、翻译核心、词典、补丁信息
 * 其余文件原样保留，app.asar.unpacked 不动。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const asar = require('./asar');

const ROOT = path.join(__dirname, '..');
const META_PATH = 'dist/agzh/meta.json';
const MARK_BEGIN = '/* ==== agzh: Antigravity 中文界面 BEGIN ==== */';
const MARK_END = '/* ==== agzh: Antigravity 中文界面 END ==== */';
const MAIN_LINE = "try { require('./agzh/main-hook.js'); } catch (e) { console.error('[agzh] main-hook', e); } /* agzh */";

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function toolVersion() {
  try {
    return JSON.parse(readText('package.json')).version;
  } catch (_) {
    return '0.0.0';
  }
}

/**
 * 读取词典：locales/<locale>/ 下的所有 .json 按文件名顺序合并（后面的覆盖前面的）。
 * 每个文件的结构都是 { text, patterns, sentences }，只保留运行时需要的这三部分。
 */
function loadLocale(locale = 'zh-CN') {
  const dir = path.join(ROOT, 'locales', locale);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new Error(`词典目录是空的：${dir}`);
  const merged = { text: {}, patterns: {}, sentences: {} };
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`词典文件 ${f} 不是有效的 JSON：${e.message}`);
    }
    for (const k of ['text', 'patterns', 'sentences']) Object.assign(merged[k], data[k] || {});
  }
  return merged;
}

function stripModuleExports(src) {
  // runtime/*.js 末尾的 module.exports 只给 Node 侧测试用，内联时去掉
  return src.replace(/\nif \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}\s*$/, '\n');
}

function rendererBundle(data, version) {
  const translator = stripModuleExports(readText('src/runtime/translator.js')).replace(/^'use strict';\s*/, '');
  const dom = stripModuleExports(readText('src/runtime/dom.js')).replace(/^'use strict';\s*/, '');
  return [
    '',
    MARK_BEGIN,
    ';(function agzhRenderer(DATA, VERSION) {',
    "  'use strict';",
    '  try {',
    "    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;",
    '    if (globalThis.__agzhRendererInstalled) return;',
    '    globalThis.__agzhRendererInstalled = true;',
    translator,
    dom,
    '    startDomTranslator(createTranslator(DATA), { version: VERSION });',
    '  } catch (e) {',
    "    try { console.warn('[agzh] renderer', e); } catch (_) {}",
    '  }',
    `})(${JSON.stringify(data)}, ${JSON.stringify(version)});`,
    MARK_END,
    '',
  ].join('\n');
}

function readMeta(archive) {
  const node = asar.getNode(archive, META_PATH);
  if (!node || node.files) return null;
  try {
    return JSON.parse(asar.readFile(archive, META_PATH).toString('utf8'));
  } catch (_) {
    return { broken: true };
  }
}

function appPackage(archive) {
  try {
    return JSON.parse(asar.readFile(archive, 'package.json').toString('utf8'));
  } catch (_) {
    return null;
  }
}

/** 确认这是 Antigravity 2.x 桌面应用的 app.asar（而不是旧版 IDE 或别的 Electron 程序） */
function checkTarget(archive) {
  const pkg = appPackage(archive);
  if (!pkg) throw new Error('app.asar 里没有 package.json');
  if (pkg.name !== 'antigravity' || pkg.main !== 'dist/main.js') {
    throw new Error(`这不是 Antigravity 2.x 桌面应用（name=${pkg.name}, main=${pkg.main}）`);
  }
  for (const f of ['dist/main.js', 'dist/preload.js']) {
    if (!asar.getNode(archive, f)) throw new Error(`app.asar 里缺少 ${f}，可能是不支持的版本`);
  }
  // 官方 dist/*.js 里没有一个汉字；有汉字说明被别的汉化工具改过，
  // 这时如果当成“原版”备份，以后就还原不回真正的原版了。
  for (const f of ['dist/main.js', 'dist/preload.js', 'dist/menu.js', 'dist/tray.js', 'dist/updater.js']) {
    if (!asar.getNode(archive, f)) continue;
    if (/[\u4e00-\u9fff]/.test(asar.readFile(archive, f).toString('utf8'))) {
      throw new Error('这个 app.asar 已经被其他汉化工具改过（不是官方原版）。请先重新安装官方 Antigravity，再运行本工具。');
    }
  }
  return pkg;
}

function checkSyntax(name, code) {
  try {
    // 只编译不运行；CommonJS 文件包一层函数以允许顶层 return
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${code}\n})`, { filename: name });
  } catch (e) {
    throw new Error(`生成的 ${name} 语法检查没通过：${e.message}`);
  }
}

/**
 * @param {Buffer} originalBuf 官方原版 app.asar
 * @returns {{ buf: Buffer, meta: object }}
 */
function buildPatched(originalBuf, opts = {}) {
  const archive = asar.parse(originalBuf);
  if (readMeta(archive)) throw new Error('传入的 app.asar 已经是汉化版，需要官方原版');
  const pkg = checkTarget(archive);
  const data = opts.data || loadLocale(opts.locale);
  const version = toolVersion();

  const changes = new Map();

  const preload = asar.readFile(archive, 'dist/preload.js').toString('utf8');
  const bundle = rendererBundle(data, version);
  changes.set('dist/preload.js', Buffer.from(preload + bundle, 'utf8'));

  if (asar.getNode(archive, 'dist/ideInstall/wizardPreload.js')) {
    const wiz = asar.readFile(archive, 'dist/ideInstall/wizardPreload.js').toString('utf8');
    changes.set('dist/ideInstall/wizardPreload.js', Buffer.from(wiz + bundle, 'utf8'));
  }

  const main = asar.readFile(archive, 'dist/main.js').toString('utf8');
  // 插在 "use strict"; 之后，官方代码之前
  const m = /^(\s*(?:'use strict'|"use strict");?[^\n]*\n)/.exec(main);
  const patchedMain = m ? m[1] + MAIN_LINE + '\n' + main.slice(m[1].length) : MAIN_LINE + '\n' + main;
  changes.set('dist/main.js', Buffer.from(patchedMain, 'utf8'));

  changes.set('dist/agzh/translator.js', Buffer.from(readText('src/runtime/translator.js'), 'utf8'));
  changes.set('dist/agzh/main-hook.js', Buffer.from(readText('src/runtime/main-hook.js'), 'utf8'));
  changes.set('dist/agzh/zh-CN.json', Buffer.from(JSON.stringify(data), 'utf8'));

  const meta = {
    tool: 'antigravity-zh',
    toolVersion: version,
    appVersion: pkg.version,
    originalSha256: sha256(originalBuf),
    originalSize: originalBuf.length,
    entries: Object.keys(data.text).length + Object.keys(data.patterns).length +
      Object.keys(data.sentences || {}).length,
    patchedAt: new Date().toISOString(),
  };
  changes.set(META_PATH, Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));

  for (const [p, buf] of changes) {
    if (p.endsWith('.js')) checkSyntax(p, buf.toString('utf8'));
  }

  const out = asar.rebuild(archive, changes);

  // 回读校验：新包能解析，改动的文件内容一致，未改动的文件逐字节相同
  const check = asar.parse(out);
  for (const [p, buf] of changes) {
    if (!asar.readFile(check, p).equals(buf)) throw new Error(`回读校验失败：${p}`);
  }
  for (const p of asar.listFiles(archive)) {
    const node = asar.getNode(archive, p);
    if (node.unpacked || node.link || changes.has(p)) continue;
    if (!asar.readFile(check, p).equals(asar.readFile(archive, p))) throw new Error(`回读校验失败：${p}`);
  }
  return { buf: out, meta };
}

module.exports = {
  buildPatched, readMeta, appPackage, checkTarget, sha256, loadLocale, toolVersion,
  META_PATH, MARK_BEGIN, MARK_END,
};
