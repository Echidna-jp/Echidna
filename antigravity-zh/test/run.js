'use strict';
/*
 * 测试：node test/run.js
 * 不依赖任何 npm 包。用 test/fixtures/app.asar（由 @electron/asar 打包、结构模仿 Antigravity 2.x 的小样本）。
 * 如果环境里能 require('playwright')，还会在真实 Chromium 里跑一遍页面翻译。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const asar = require('../src/asar');
const patch = require('../src/patch');
const { createTranslator } = require('../src/runtime/translator');

const FIXTURE = path.join(__dirname, 'fixtures', 'app.asar');
const FIXTURE_UNPACKED = path.join(__dirname, 'fixtures', 'app.asar.unpacked');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agzh-test-'));
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function makeInstall(asarBuf) {
  const dir = tmpdir();
  const res = path.join(dir, 'resources');
  fs.mkdirSync(res);
  fs.writeFileSync(path.join(res, 'app.asar'), asarBuf || fs.readFileSync(FIXTURE));
  copyDir(FIXTURE_UNPACKED, path.join(res, 'app.asar.unpacked'));
  fs.writeFileSync(path.join(dir, 'Antigravity.exe'), 'fake');
  return dir;
}
function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'src', 'cli.js'), ...args], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}
function withFile(arc, p, text) {
  return asar.rebuild(arc, new Map([[p, Buffer.from(text, 'utf8')]]));
}
function loadAllLocales() {
  return patch.loadLocale('zh-CN');
}

// ---------------- asar ----------------
test('asar：解析样本并列出文件', () => {
  const arc = asar.parse(fs.readFileSync(FIXTURE));
  const files = asar.listFiles(arc);
  for (const f of ['package.json', 'dist/main.js', 'dist/preload.js', 'dist/ideInstall/wizardPreload.js', 'node_modules/fake-mod/LICENSE']) {
    assert.ok(files.includes(f), `缺少 ${f}`);
  }
  assert.strictEqual(asar.getNode(arc, 'node_modules/fake-mod/LICENSE').unpacked, true);
  assert.throws(() => asar.readFile(arc, 'node_modules/fake-mod/LICENSE'), /unpacked/);
});

test('asar：不改动时重打包与 @electron/asar 的输出逐字节一致', () => {
  const buf = fs.readFileSync(FIXTURE);
  const out = asar.rebuild(asar.parse(buf), new Map());
  assert.ok(out.equals(buf));
});

test('asar：替换和新增文件后能正确读回，其余文件不变', () => {
  const buf = fs.readFileSync(FIXTURE);
  const arc = asar.parse(buf);
  const out = asar.rebuild(arc, new Map([
    ['dist/preload.js', Buffer.from('// new preload\n')],
    ['dist/agzh/x/y.json', Buffer.from('{"a":1}')],
  ]));
  const back = asar.parse(out);
  assert.strictEqual(asar.readFile(back, 'dist/preload.js').toString(), '// new preload\n');
  assert.strictEqual(asar.readFile(back, 'dist/agzh/x/y.json').toString(), '{"a":1}');
  assert.ok(asar.readFile(back, 'icon.png').equals(asar.readFile(arc, 'icon.png')));
  assert.strictEqual(asar.getNode(back, 'node_modules/fake-mod/LICENSE').unpacked, true);
  const node = asar.getNode(back, 'dist/preload.js');
  assert.strictEqual(node.integrity.hash, require('crypto').createHash('sha256').update('// new preload\n').digest('hex'));
});

// ---------------- patch ----------------
test('patch：生成汉化版并通过自检', () => {
  const { buf, meta } = patch.buildPatched(fs.readFileSync(FIXTURE));
  const arc = asar.parse(buf);
  assert.strictEqual(meta.appVersion, '9.9.9');
  assert.ok(patch.readMeta(arc));
  const preload = asar.readFile(arc, 'dist/preload.js').toString();
  assert.ok(preload.startsWith('"use strict";'));
  assert.ok(preload.includes(patch.MARK_BEGIN) && preload.trim().endsWith(patch.MARK_END));
  const wiz = asar.readFile(arc, 'dist/ideInstall/wizardPreload.js').toString();
  assert.ok(wiz.includes(patch.MARK_BEGIN));
  const mainLines = asar.readFile(arc, 'dist/main.js').toString().split('\n');
  assert.strictEqual(mainLines[0], '"use strict";');
  assert.ok(mainLines[1].includes("require('./agzh/main-hook.js')"));
  for (const f of ['dist/agzh/translator.js', 'dist/agzh/main-hook.js', 'dist/agzh/zh-CN.json']) {
    assert.ok(asar.getNode(arc, f), `缺少 ${f}`);
  }
  // 预加载脚本在没有 document 的环境里应安静退出，不抛错
  const sandbox = { exports: {}, require: () => ({}), console, globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`(function(exports, require){${preload}\n})(exports, require)`, sandbox);
});

test('patch：拒绝已汉化的包、其他程序、被别的汉化工具改过的包', () => {
  const { buf } = patch.buildPatched(fs.readFileSync(FIXTURE));
  assert.throws(() => patch.buildPatched(buf), /已经是汉化版/);
  const arc = asar.parse(fs.readFileSync(FIXTURE));
  const other = withFile(arc, 'package.json', '{"name":"other-app","main":"dist/main.js"}');
  assert.throws(() => patch.buildPatched(other), /不是 Antigravity/);
  const foreign = withFile(arc, 'dist/preload.js', '"use strict";\nconst DICT = {"Settings": "设置"};\n');
  assert.throws(() => patch.buildPatched(foreign), /其他汉化工具/);
});

// ---------------- cli ----------------
test('cli：汉化 → 重新生成 → 还原（逐字节恢复）', () => {
  const dir = makeInstall();
  const res = path.join(dir, 'resources');
  const original = fs.readFileSync(FIXTURE);

  let r = cli(['status', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /官方英文原版/);

  r = cli(['apply', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(patch.readMeta(asar.parse(fs.readFileSync(path.join(res, 'app.asar')))));
  assert.ok(fs.readFileSync(path.join(res, 'app.asar.agzh-original')).equals(original));

  r = cli(['apply', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /重新生成/);

  r = cli(['restore', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(fs.readFileSync(path.join(res, 'app.asar')).equals(original));
  assert.ok(!fs.existsSync(path.join(res, 'app.asar.agzh-original')));

  r = cli(['restore', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /不需要还原/);
});

test('cli：官方更新后重新汉化，备份换成新版原版', () => {
  const dir = makeInstall();
  const res = path.join(dir, 'resources');
  assert.strictEqual(cli(['apply', '--dir', dir]).code, 0);
  // 模拟官方更新：app.asar 被换成新版官方原版，旧备份还留着
  const arc = asar.parse(fs.readFileSync(FIXTURE));
  const newOfficial = withFile(arc, 'package.json', '{"name":"antigravity","productName":"Antigravity","version":"10.0.0","main":"dist/main.js"}');
  fs.writeFileSync(path.join(res, 'app.asar'), newOfficial);
  const r = cli(['apply', '--dir', dir]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /10\.0\.0/);
  assert.ok(fs.readFileSync(path.join(res, 'app.asar.agzh-original')).equals(newOfficial));
  assert.strictEqual(cli(['restore', '--dir', dir]).code, 0);
  assert.ok(fs.readFileSync(path.join(res, 'app.asar')).equals(newOfficial));
});

test('cli：遇到被别的工具改过的包时不动任何文件', () => {
  const arc = asar.parse(fs.readFileSync(FIXTURE));
  const foreign = withFile(arc, 'dist/preload.js', '"use strict";\n// 汉化\n');
  const dir = makeInstall(foreign);
  const res = path.join(dir, 'resources');
  const r = cli(['apply', '--dir', dir]);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /其他汉化工具/);
  assert.ok(fs.readFileSync(path.join(res, 'app.asar')).equals(foreign));
  assert.ok(!fs.existsSync(path.join(res, 'app.asar.agzh-original')));
});

test('cli：--log 写入文件且不输出到控制台', () => {
  const dir = makeInstall();
  const log = path.join(dir, 'out.log');
  const r = cli(['status', '--dir', dir, '--log', log]);
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, '');
  assert.match(fs.readFileSync(log, 'utf8'), /Antigravity 版本：9\.9\.9/);
});

// ---------------- translator ----------------
test('翻译：精确匹配、标点变体、大小写', () => {
  const t = createTranslator({ text: { Settings: '设置', Loading: '正在加载', 'Sort by': '排序方式', Name: '名称' } });
  assert.strictEqual(t.translate('Settings'), '设置');
  assert.strictEqual(t.translate('  Settings \n'), '  设置 \n');
  assert.strictEqual(t.translate('Settings:'), '设置：');
  assert.strictEqual(t.translate('Loading...'), '正在加载…');
  assert.strictEqual(t.translate('Sort By'), '排序方式');
  assert.strictEqual(t.translate('name'), null, '单个全小写词（多半是代码）不做模糊匹配');
  assert.strictEqual(t.translate('设置'), null);
  assert.strictEqual(t.translate('Unknown thing'), null);
});

test('翻译：句式、占位符里的词、中英文空格', () => {
  const t = createTranslator({
    text: { Project: '项目', archive: '归档', General: '常规' },
    patterns: {
      'Delete {0}': '删除 {0}',
      "Couldn't {0} conversation": '无法{0}对话',
      '{0} agents running': '{0} 个智能体正在运行',
      'Settings - {0}': '设置 - {0}',
      'about {0} hours': '约 {0} 小时',
      '{0} ago': '{0}前',
      '{0} of {1}': '{0}/{1}',
      '({0} step{1})': '（{0} 个步骤）',
      '{0} question{1}': '{0} 个问题',
    },
  });
  assert.strictEqual(t.translate('Delete Project'), '删除项目');
  assert.strictEqual(t.translate('Delete my-skill'), '删除 my-skill');
  assert.strictEqual(t.translate("Couldn't archive conversation"), '无法归档对话');
  assert.strictEqual(t.translate('3 agents running'), '3 个智能体正在运行');
  assert.strictEqual(t.translate('Settings - General'), '设置 - 常规');
  assert.strictEqual(t.translate('Settings - Foo'), '设置 - Foo');
  assert.strictEqual(t.translate('about 3 hours ago'), '约 3 小时前');
  assert.strictEqual(t.translate('(1 step)'), '（1 个步骤）');
  assert.strictEqual(t.translate('(2 steps)'), '（2 个步骤）');
  // 弱句式只接受数字或可翻译的内容
  assert.strictEqual(t.translate('3 of 10'), '3/10');
  assert.strictEqual(t.translate('Terms of Service'), null);
  // 复数词尾不能吞掉后面的长文
  assert.strictEqual(t.translate('Use when the user asks questions about how to use it.'), null);
  assert.strictEqual(t.translate('2 questions'), '2 个问题');
});

test('翻译：整句片段规则与仅精确匹配', () => {
  const t = createTranslator({
    text: { Type: '类型', 'New Conversation': '新对话' },
    patterns: { 'Open {0}': '打开 {0}' },
    sentences: {
      'Type / and select plan to have the agent generate a plan.': {
        Type: '输入', 'and select': '并选择', 'to have the agent generate a plan.': '，让智能体生成计划。',
      },
      'Review {0} comment{1}': { Review: '查看', comment: '条评论', s: '' },
    },
  });
  const s = 'Type / and select plan to have the agent generate a plan.';
  assert.strictEqual(t.translateFragment(s, 'Type '), '输入');
  assert.strictEqual(t.translateFragment(s, ' and select '), '并选择');
  assert.strictEqual(t.translateFragment(s, 'plan'), undefined);
  assert.strictEqual(t.translateFragment('Review 3 comments', 's'), '');
  assert.strictEqual(t.translateFragment('Review 1 comment', 'comment'), '条评论');
  assert.strictEqual(t.translate('Type'), '类型');
  assert.strictEqual(t.translateExact('New Conversation'), '新对话');
  assert.strictEqual(t.translateExact('Open main.py'), null);
  assert.strictEqual(t.translate('Open main.py'), '打开 main.py');
});

// ---------------- 词典 ----------------
test('词典：格式检查', () => {
  const dir = path.join(ROOT, 'locales', 'zh-CN');
  const seen = new Map();
  let total = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [k, v] of Object.entries(data.text || {})) {
      total++;
      assert.strictEqual(typeof v, 'string', `${f}: ${k}`);
      assert.ok(v.length > 0, `${f}: 空译文 ${k}`);
      assert.strictEqual(k, k.replace(/\s+/g, ' ').trim(), `${f}: 键前后有多余空白 "${k}"`);
      assert.ok(!/\{\d+\}/.test(v), `${f}: text 里不该有占位符 ${k}`);
      if (seen.has(k) && seen.get(k).v !== v) {
        // 后面的文件覆盖前面的：允许，但要是有意为之
        console.log(`    提示：${f} 覆盖了 ${seen.get(k).f} 中的 "${k}"`);
      }
      seen.set(k, { f, v });
    }
    for (const [k, v] of Object.entries(data.patterns || {})) {
      total++;
      const a = new Set(k.match(/\{\d+\}/g) || []);
      const b = v.match(/\{\d+\}/g) || [];
      assert.ok(a.size > 0, `${f}: 句式没有占位符 ${k}`);
      for (const p of b) assert.ok(a.has(p), `${f}: 译文用了原文没有的占位符 ${p}：${k}`);
      // 省略的占位符只能是紧跟在单词后的复数词尾
      for (const p of a) {
        if (b.includes(p)) continue;
        const before = k.slice(0, k.indexOf(p));
        assert.ok(/[A-Za-z]$/.test(before), `${f}: 译文丢掉了非复数占位符 ${p}：${k}`);
      }
    }
    for (const [k, frags] of Object.entries(data.sentences || {})) {
      total++;
      for (const [fk, fv] of Object.entries(frags)) {
        assert.strictEqual(typeof fv, 'string', `${f}: ${k} / ${fk}`);
      }
    }
  }
  assert.ok(total > 3000, `词条太少：${total}`);
  const merged = loadAllLocales();
  const t = createTranslator(merged);
  assert.ok(t.size > 3000);
});

// ---------------- main-hook ----------------
test('主进程钩子：菜单、托盘、对话框、通知', () => {
  const dir = tmpdir();
  fs.copyFileSync(path.join(ROOT, 'src/runtime/main-hook.js'), path.join(dir, 'main-hook.js'));
  fs.copyFileSync(path.join(ROOT, 'src/runtime/translator.js'), path.join(dir, 'translator.js'));
  fs.writeFileSync(path.join(dir, 'zh-CN.json'), JSON.stringify(loadAllLocales()));

  const calls = {};
  class Tray { setContextMenu(m) { calls.tray = m.items.map((i) => i.label); } }
  const fake = {
    Menu: { buildFromTemplate: (tpl) => ({ items: tpl }) },
    Tray,
    dialog: {
      showMessageBox: (w, o) => { calls.box = o || w; return Promise.resolve({ response: 0 }); },
      showErrorBox: (t, c) => { calls.err = [t, c]; },
    },
    ipcMain: { handle: (ch, fn) => { calls.handlers = calls.handlers || {}; calls.handlers[ch] = fn; } },
  };
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') return fake;
    return origLoad.call(this, req, ...rest);
  };
  const origLog = console.log;
  console.log = () => {};
  try {
    require(path.join(dir, 'main-hook.js'));
  } finally {
    Module._load = origLoad;
    console.log = origLog;
  }
  const m = fake.Menu.buildFromTemplate([{ label: 'Quit' }, { label: 'No agents running' }, { label: '3 agents running', submenu: [{ label: 'Open Antigravity' }] }]);
  assert.deepStrictEqual(m.items.map((i) => i.label), ['退出', '没有正在运行的智能体', '3 个智能体正在运行']);
  assert.strictEqual(m.items[2].submenu[0].label, '打开 Antigravity');
  new fake.Tray().setContextMenu({ items: [{ label: '1 agent running' }] });
  assert.deepStrictEqual(calls.tray, ['1 个智能体正在运行']);
  fake.dialog.showMessageBox({}, { buttons: ['Cancel', 'Quit'], title: 'Confirm Quit', message: 'Are you sure you want to quit?' });
  assert.deepStrictEqual(calls.box.buttons, ['取消', '退出']);
  assert.strictEqual(calls.box.message, '确定要退出吗？');
  fake.dialog.showErrorBox('Startup failed', 'boom');
  assert.deepStrictEqual(calls.err, ['启动失败', 'boom']);
  let got;
  fake.ipcMain.handle('notification:send', (e, o) => { got = o; });
  calls.handlers['notification:send']({}, { title: 'Agent finished', body: 'x' });
  assert.strictEqual(got.title, '智能体已完成');
});

// ---------------- 页面翻译（可选，需要 playwright） ----------------
let playwright = null;
try { playwright = require('playwright'); } catch (_) { /* 没有就跳过 */ }
if (playwright) {
  test('页面翻译：在 Chromium 里跑注入脚本（含 React 式更新、禁区、属性）', async () => {
    const { buf } = patch.buildPatched(fs.readFileSync(FIXTURE));
    const preload = asar.readFile(asar.parse(buf), 'dist/preload.js').toString();
    const bundle = preload.slice(preload.indexOf(patch.MARK_BEGIN));
    const browser = await playwright.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<html lang="en"><body>
        <button id="b">Cancel</button>
        <input id="i" placeholder="Search conversations...">
        <p id="mix">Type <kbd>/</kbd> and select <code>plan</code> to have the agent generate a plan.</p>
        <div data-markdown-root><p id="md">Cancel</p></div>
        <div class="font-mono" id="mono">Settings</div>
        <div data-sidebar-row-id="1"><span id="title1">New Conversation</span><span id="title2">Open source license question</span></div>
        <span id="cnt">3 agents running</span>
      </body></html>`);
      await page.evaluate(bundle);
      const get = (sel) => page.$eval(sel, (el) => el.textContent);
      assert.strictEqual(await get('#b'), '取消');
      assert.strictEqual(await page.$eval('#i', (el) => el.getAttribute('placeholder')), '搜索对话…');
      assert.strictEqual(await get('#mix'), '输入/并选择plan，让智能体生成计划。');
      assert.strictEqual(await get('#md'), 'Cancel');
      assert.strictEqual(await get('#mono'), 'Settings');
      assert.strictEqual(await get('#title1'), '新对话');
      assert.strictEqual(await get('#title2'), 'Open source license question');
      assert.strictEqual(await get('#cnt'), '3 个智能体正在运行');
      assert.strictEqual(await page.$eval('html', (el) => el.lang), 'zh-CN');
      // 像 React 一样改回英文 / 新增节点
      await page.evaluate(() => {
        document.querySelector('#b').firstChild.nodeValue = 'Retry';
        const s = document.createElement('span'); s.id = 'new'; s.textContent = 'Settings'; document.body.appendChild(s);
        document.querySelector('#i').setAttribute('placeholder', 'Search files...');
      });
      await page.waitForTimeout(50);
      assert.strictEqual(await get('#b'), '重试');
      assert.strictEqual(await get('#new'), '设置');
      assert.strictEqual(await page.$eval('#i', (el) => el.getAttribute('placeholder')), '搜索文件…');
    } finally {
      await browser.close();
    }
  });
}

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e}`);
    }
  }
  if (!playwright) console.log('  - 跳过页面翻译测试（没有 playwright）');
  console.log(failed ? `\n${failed} 项失败` : `\n全部 ${tests.length} 项通过`);
  process.exitCode = failed ? 1 : 0;
})();
