'use strict';
/*
 * 找出界面 bundle 里还没翻译的文案（维护词典用）。
 *
 *   cd tools && npm install            # 第一次需要：装 acorn 解析器
 *   node tools/extract-webui.js "<安装目录>\\resources\\bin\\language_server.exe" webui
 *   node tools/find-untranslated.js webui/main.js untranslated.json
 *
 * 做法：解析 main.js 里所有字符串/模板字符串，按语法位置分类（JSX 子节点、label/title 等属性、
 * 返回值……），过滤掉 CSS 类名、标识符、日志等，再和 locales/zh-CN 里的词条对比。
 * 输出里 tier=A 的最可能是界面文字，B 是混有库代码报错的低可信度候选。
 */
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'node_modules', 'acorn'));
const walk = require(path.join(__dirname, 'node_modules', 'acorn-walk'));
const { loadLocale } = require('../src/patch');
const { createTranslator } = require('../src/runtime/translator');

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.log('用法：node tools/find-untranslated.js <main.js> <输出.json>');
  process.exit(2);
}
const src = fs.readFileSync(inFile, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });

const NON_UI_KEYS = new Set([
  'className', 'class', 'style', 'id', 'data-testid', 'testId', 'dataTestId', 'type', 'variant', 'size',
  'icon', 'iconName', 'iconPath', 'key', 'href', 'src', 'role', 'fill', 'viewBox', 'd', 'xmlns', 'stroke',
  'kind', 'case', 'width', 'height', 'code', 'place', 'light', 'dark', 'hcLight', 'hcDark', 'target', 'rel',
  'stopColor', 'tag', 'customFlag', 'offset', 'align', 'side', 'position', 'mode', 'transform', 'to', 'x', 'y',
  'value', 'method', 'mimeType', 'contentType', 'language', 'lang', 'url', 'path', 'uri', 'command',
  'event', 'eventName', 'storageKey', 'cssVar', 'color', 'background', 'font', 'fontFamily', 'pattern',
  'regex', 'format', 'locale', 'scheme', 'protocol', 'host', 'origin', 'pathname', 'query', 'channel',
  'typeName', 'jsonName', 'localName', 'fieldName', 'enumName', 'surface', 'screen', 'action', 'status',
  'context', 'result', 'display', 'textColor', 'bgColor', 'gradient', 'filter', 'clipPath', 'mask',
  'aria-hidden', 'aria-live', 'aria-haspopup', 'aria-expanded', 'aria-controls', 'aria-describedby',
  'aria-labelledby', 'aria-current', 'aria-orientation', 'autoComplete', 'inputMode', 'enterKeyHint',
  'sandbox', 'allow', 'referrerPolicy', 'loading', 'decoding', 'crossOrigin', 'integrity', 'shortcut',
  'keybinding', 'accelerator', 'theme', 'themeName', 'cursor', 'easing', 'duration', 'delay', 'transition',
]);
const LOG_METHODS = new Set(['log', 'warn', 'debug', 'info', 'trace', 'error', 'group', 'groupCollapsed', 'time', 'timeEnd', 'assert']);

const found = new Map();
function add(s, kind, ctx) {
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return;
  const k = kind + '\0' + s;
  let e = found.get(k);
  if (!e) found.set(k, (e = { kind, s, ctx: new Map(), n: 0 }));
  e.ctx.set(ctx, (e.ctx.get(ctx) || 0) + 1);
  e.n++;
}
function tpl(node) {
  let s = '';
  node.quasis.forEach((q, i) => { s += q.value.cooked ?? q.value.raw; if (i < node.expressions.length) s += `{${i}}`; });
  return s;
}
function keyName(p) {
  if (!p || p.type !== 'Property') return null;
  return p.key.type === 'Identifier' ? p.key.name : (typeof p.key.value === 'string' ? p.key.value : null);
}

// Walk with ancestors to classify each literal.
walk.fullAncestor(ast, (node, _st, anc) => {
  let s, kind;
  if (node.type === 'Literal' && typeof node.value === 'string') { s = node.value; kind = 'text'; }
  else if (node.type === 'TemplateLiteral') {
    if (anc.length > 1 && anc[anc.length - 2].type === 'TaggedTemplateExpression') return;
    s = node.expressions.length ? tpl(node) : (node.quasis[0].value.cooked ?? '');
    kind = node.expressions.length ? 'pattern' : 'text';
  } else return;
  // find nearest meaningful parent, skipping conditional/logical/sequence wrappers
  let i = anc.length - 2, child = node;
  while (i >= 0 && ['ConditionalExpression', 'LogicalExpression', 'SequenceExpression', 'ArrayExpression', 'ParenthesizedExpression'].includes(anc[i].type)) {
    if (anc[i].type === 'ConditionalExpression' && anc[i].test === child) return; // used as test
    child = anc[i]; i--;
  }
  const p = anc[i];
  if (!p) return;
  let ctx;
  switch (p.type) {
    case 'Property': {
      if (p.key === child && !p.computed) return; // it's a key
      const k = keyName(p);
      if (k && NON_UI_KEYS.has(k)) return;
      ctx = 'prop:' + k;
      break;
    }
    case 'CallExpression':
    case 'NewExpression': {
      if (p.callee === child) return;
      const c = p.callee;
      const m = c.type === 'MemberExpression' && !c.computed ? c.property.name : (c.type === 'Identifier' ? c.name : '');
      const obj = c.type === 'MemberExpression' && c.object.type === 'Identifier' ? c.object.name : '';
      if (obj === 'console') return;
      if (m === 'createElement') {
        if (p.arguments[0] === child) return; // element type
        ctx = 'child';
        break;
      }
      if (['require', 'querySelector', 'querySelectorAll', 'getElementById', 'addEventListener', 'removeEventListener',
        'setAttribute', 'getAttribute', 'removeAttribute', 'hasAttribute', 'get', 'set', 'has', 'delete', 'getItem', 'setItem', 'removeItem',
        'startsWith', 'endsWith', 'includes', 'indexOf', 'split', 'join', 'replace', 'replaceAll', 'match', 'test', 'matches', 'closest',
        'getPropertyValue', 'setProperty', 'createElementNS', 'postMessage', 'dispatchEvent', 'invoke', 'send', 'on', 'emit', 'fetch',
        'RegExp', 'Symbol', 'for', 'defineProperty', 'toggle', 'add', 'remove', 'contains', 'mark', 'measure', 'localeCompare', 'padStart', 'padEnd',
        'q', 'useContext', 'createContext', 'encodeURIComponent', 'decodeURIComponent', 'atob', 'btoa', 'parse', 'stringify', 'Date', 'URL', 'Blob', 'File',
      ].includes(m)) return;
      if (LOG_METHODS.has(m) && obj && obj !== 'toast' && obj !== 'notify') { ctx = 'log:' + m; break; }
      if (m === 'Error' || m === 'TypeError' || m === 'RangeError') { ctx = 'error'; break; }
      ctx = 'arg:' + (m || '?');
      break;
    }
    case 'ReturnStatement': ctx = 'return'; break;
    case 'ArrowFunctionExpression': ctx = 'return'; break;
    case 'VariableDeclarator': ctx = 'var'; break;
    case 'AssignmentExpression': {
      const l = p.left;
      const n = l.type === 'MemberExpression' && !l.computed ? l.property.name : '';
      if (['className', 'id', 'src', 'href', 'type', 'cssText', 'innerHTML'].includes(n)) return;
      ctx = 'assign:' + n;
      break;
    }
    case 'BinaryExpression':
      if (['===', '!==', '==', '!=', 'in', 'instanceof'].includes(p.operator)) return;
      ctx = 'concat';
      break;
    case 'SwitchCase': return; // case "x":
    case 'TemplateLiteral': return;
    case 'MemberExpression': return; // obj["key"]
    case 'ImportExpression': case 'ExportNamedDeclaration': return;
    default: ctx = p.type;
  }
  add(s, kind, ctx);
});

// --- natural-language filter ---
const CSSY = /^[\w\-:\[\]\/\.%#!@()=,&>~+*'"]+$/;
function looksUI(s, kind) {
  const t = kind === 'pattern' ? s.replace(/\{\d+\}/g, 'X') : s;
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (t.length > 600) return false;
  if (/^(https?|file|data|blob|wss?|chrome|about|vscode|antigravity|mailto):/i.test(t)) return false;
  if (/^[.\/~]|\\\\|\.(js|ts|tsx|json|css|png|svg|md|py|go)$/i.test(t) && !/ /.test(t)) return false;
  if (/[{};]\s*$|^\s*[@.#][\w-]+\s*\{|:\s*[\w#-]+;/.test(t) && /[;{]/.test(t)) return false; // css / code
  if (/=>|function\s*\(|\bvar\b |\bconst\b |\breturn\b|\(\)\s*\{/.test(t)) return false;
  if (/^<[a-z!]/i.test(t)) return false; // html
  const words = t.split(' ');
  if (words.length === 1) {
    // single token: must be a Capitalized word (optionally with ...), not camelCase/snake/kebab identifiers
    if (/[a-z][A-Z]/.test(t) && !/^(GitHub|JavaScript|TypeScript|PowerShell|YouTube|LinkedIn|WebSocket|iPhone|macOS|iOS)$/.test(t)) return false;
    if (/_/.test(t)) return false;
    if (!/^[A-Z][A-Za-z'’\-]*[A-Za-z](\.\.\.|…|[.!?:])?$/.test(t)) return false;
    if (/^[A-Z0-9_\-]+$/.test(t)) return false; // CONSTANT / ACRONYM
    return true;
  }
  // multi word: reject class lists / identifier soups
  if (words.every(w => /^[a-z0-9\-:\[\]\/\.%#!_()]+$/.test(w)) && words.some(w => /[-:\[]/.test(w))) return false;
  const alpha = words.filter(w => /^[A-Za-z][A-Za-z'’\-]*[A-Za-z.,!?:;)"]*$|^[A-Za-z]$/.test(w)).length;
  if (alpha / words.length < 0.5) return false;
  if (words.filter(w => /[a-z][A-Z]|_[a-z]/.test(w)).length > 1) return false;
  return true;
}

const UIPROP = new Set(['label', 'title', 'aria-label', 'ariaLabel', 'placeholder', 'description', 'tooltip', 'text',
  'message', 'subtitle', 'header', 'heading', 'helperText', 'hint', 'caption', 'summary', 'emptyText', 'emptyMessage',
  'buttonText', 'buttonLabel', 'confirmText', 'cancelText', 'confirmLabel', 'cancelLabel', 'submitLabel', 'actionLabel',
  'alt', 'content', 'details', 'detail', 'subtext', 'statusText', 'chipLabel', 'tooltipText', 'displayName', 'errorMessage',
  'loadingText', 'body', 'footer', 'sidebarLabel', 'searchPlaceholder', 'accessibilityLabel', 'name', 'error', 'reason']);
function tier(ctx) {
  if (ctx.some((c) => c === 'child' || (c.startsWith('prop:') && UIPROP.has(c.slice(5))))) return 'A';
  if (ctx.every((c) => c.startsWith('log:') || c === 'error' || c === 'concat')) return 'X';
  return 'B';
}

const tr = createTranslator(loadLocale('zh-CN'));
const rows = [];
for (const e of found.values()) {
  if (!looksUI(e.s, e.kind)) continue;
  const ctx = [...e.ctx.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const t = tier(ctx);
  if (t === 'X') continue;
  // 句式用示例值试一下（{0} -> 3）
  // 紧跟在单词后的占位符是复数词尾，试成空；其余试成 3
  const probe = e.kind === 'pattern' ? e.s.replace(/([A-Za-z])\{\d+\}/g, '$1').replace(/\{\d+\}/g, '3') : e.s;
  if (tr.translate(probe) != null) continue;
  rows.push({ tier: t, kind: e.kind, s: e.s, ctx: ctx.slice(0, 4) });
}
rows.sort((a, b) => (a.tier + a.s).localeCompare(b.tier + b.s));
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const n = (x) => rows.filter((r) => r.tier === x).length;
console.log(`未翻译候选 ${rows.length} 条（A 类 ${n('A')}，B 类 ${n('B')}），已写入 ${outFile}`);
