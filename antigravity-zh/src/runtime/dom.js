'use strict';
/*
 * Antigravity 中文界面 · 页面翻译
 *
 * 在 preload（隔离世界）里运行：DOM 是和页面共享的，所以可以直接改文字，
 * 但页面脚本碰不到这里的变量。
 *
 * 规则：
 *   - 只改文本节点的内容和少数几个可见属性（placeholder、title、alt），
 *     不移动、不增删任何节点，不碰 aria-label（官方代码会读它来判断按钮）。
 *   - 输入框、编辑器、终端、代码块、Markdown 正文（智能体回复、产物）、
 *     用户自己发的消息都不翻译。
 *   - React 之后再改回英文时，MutationObserver 会再翻一次。
 */

function startDomTranslator(tr, opts) {
  const doc = document;
  const ATTRS = ['placeholder', 'title', 'alt'];
  // 这些区域里的文字不翻（整棵子树跳过）
  const SKIP_TEXT = [
    'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option',
    'pre', 'code', 'kbd', 'samp', 'var',
    '[contenteditable]:not([contenteditable="false"])',
    '.monaco-editor', '.monaco-diff-editor', '.xterm', '.cm-editor',
    '[data-markdown-root]',
    '[data-testid="user-input-step"]',
    '[translate="no"]', '.notranslate', '[data-agzh-skip]',
  ].join(',');
  // 这些区域里连属性也不翻
  const SKIP_ATTR = [
    'script', 'style', '.monaco-editor', '.xterm', '.cm-editor', '[data-markdown-root]',
    '[translate="no"]', '.notranslate', '[data-agzh-skip]',
  ].join(',');

  const written = new WeakMap(); // 文本节点 -> 我们最后写入的值，用来识别自己触发的变动
  const originals = new WeakMap(); // 文本节点 -> 翻译前的英文
  let observer = null;
  let enabled = true;

  // 父元素“翻译前”的完整文字（已翻过的片段换回英文），用于整句规则
  function origText(el, depth) {
    let s = '';
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === 3) {
        const v = k.nodeValue || '';
        s += written.get(k) === v && originals.has(k) ? originals.get(k) : v;
      } else if (k.nodeType === 1 && depth < 4) {
        s += origText(k, depth + 1);
      }
      if (s.length > 2000) break;
    }
    return s;
  }

  function translateValue(node, v) {
    const parent = node.parentNode;
    if (tr.hasSentences && parent && parent.nodeType === 1 && parent.childNodes.length > 1) {
      const frag = tr.translateFragment(origText(parent, 0), v);
      if (frag !== undefined) return frag;
    }
    return tr.translate(v);
  }

  function applyText(node) {
    const v = node.nodeValue;
    if (!v || written.get(node) === v) return;
    const zh = translateValue(node, v);
    if (zh != null && zh !== v) {
      originals.set(node, v);
      written.set(node, zh);
      node.nodeValue = zh;
    }
  }

  function translateTextNode(node) {
    const v = node.nodeValue;
    if (!v || written.get(node) === v) return;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP_TEXT)) return;
    applyText(node);
  }

  function translateAttrs(el) {
    for (let i = 0; i < ATTRS.length; i++) {
      const name = ATTRS[i];
      const v = el.getAttribute(name);
      if (!v) continue;
      const zh = tr.translate(v);
      if (zh != null && zh !== v) {
        if (el.closest(SKIP_ATTR)) return;
        el.setAttribute(name, zh);
      }
    }
  }

  function hasAnyAttr(el) {
    return el.hasAttribute('placeholder') || el.hasAttribute('title') || el.hasAttribute('alt');
  }

  // 遍历一棵子树：跳过禁区，翻译文本节点和属性
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (hasAnyAttr(root)) translateAttrs(root);
      if (root.closest(SKIP_TEXT)) {
        // 禁区内部只处理属性
        attrsOnly(root);
        return;
      }
    }
    const w = doc.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (hasAnyAttr(n)) translateAttrs(n);
          if (n.matches(SKIP_TEXT)) {
            attrsOnly(n);
            return 2; // FILTER_REJECT：跳过整棵子树
          }
          return 3; // FILTER_SKIP：不收集元素本身，但继续进入子节点
        }
        return 1; // 文本节点
      },
    });
    let n;
    while ((n = w.nextNode())) applyText(n);
  }

  function attrsOnly(root) {
    if (root.closest && root.closest(SKIP_ATTR)) return;
    const list = root.querySelectorAll('[placeholder],[title],[alt]');
    for (let i = 0; i < list.length; i++) {
      if (!list[i].closest(SKIP_ATTR)) translateAttrs(list[i]);
    }
  }

  function onMutations(records) {
    if (!enabled) return;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === 'childList') {
        const added = r.addedNodes;
        for (let j = 0; j < added.length; j++) walk(added[j]);
      } else if (r.type === 'characterData') {
        translateTextNode(r.target);
      } else if (r.type === 'attributes') {
        const el = r.target;
        if (el.nodeType === 1 && !el.closest(SKIP_ATTR)) {
          const v = el.getAttribute(r.attributeName);
          if (v) {
            const zh = tr.translate(v);
            if (zh != null && zh !== v) el.setAttribute(r.attributeName, zh);
          }
        }
      }
    }
  }

  function setLang() {
    const html = doc.documentElement;
    // 让 Chromium 按简体中文挑选字形（日文系统上默认会用日文字体显示汉字）
    if (html && html.getAttribute('lang') !== 'zh-CN') html.setAttribute('lang', 'zh-CN');
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(doc, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    if (doc.documentElement) {
      setLang();
      walk(doc.documentElement);
    }
  }

  start();
  doc.addEventListener('DOMContentLoaded', () => {
    setLang();
    walk(doc.body || doc.documentElement);
  }, { once: true });

  // 调试用：在 DevTools 的 preload 上下文里可以调用
  const api = {
    translate: tr.translate,
    pause() { enabled = false; },
    resume() { enabled = true; walk(doc.documentElement); },
    stats: () => ({ text: tr.size, patterns: tr.patternCount, version: opts && opts.version }),
  };
  try { globalThis.__agzh = api; } catch (_) { /* ignore */ }
  return api;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startDomTranslator };
}
