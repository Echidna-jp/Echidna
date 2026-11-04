'use strict';
/*
 * Antigravity 中文界面 · 翻译核心
 *
 * 渲染进程（preload）和主进程（main-hook）共用这一份逻辑。
 * 只做“整句精确匹配”：一段文字要么整段命中词典，要么原样保留，
 * 不做子串替换，避免把一句话切成中英混杂的碎片。
 *
 * 词典格式（locales/zh-CN/*.json，合并后传进来）：
 *   text:      { "英文原文": "中文" }
 *   patterns:  { "Thought for {0}": "思考了 {0}" }   {n} 是占位符，译文里可以调换顺序
 *   sentences: { "整句原文": { "片段": "译法", ... } }  句中夹着按钮、代码等元素时使用
 */

function createTranslator(data) {
  const TEXT = new Map();
  const LOWER = new Map(); // 小写 -> 译文；同一小写对应多个译文时记为 null（不确定就不翻）
  const textData = (data && data.text) || {};
  for (const k of Object.keys(textData)) {
    const v = textData[k];
    if (typeof v !== 'string' || !v) continue;
    const key = norm(k);
    TEXT.set(key, v);
  }
  for (const [k, v] of TEXT) {
    const l = k.toLowerCase();
    if (!LOWER.has(l)) LOWER.set(l, v);
    else if (LOWER.get(l) !== v) LOWER.set(l, null);
  }

  const PATTERNS = [];
  const patData = (data && data.patterns) || {};
  for (const k of Object.keys(patData)) {
    const zh = patData[k];
    if (typeof zh !== 'string' || !zh) continue;
    const key = norm(k);
    const parts = key.split(/(\{\d+\})/);
    let src = '^';
    let lit = '';
    let literalLen = 0;
    const slots = [];
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      const m = /^\{(\d+)\}$/.exec(p);
      if (m) {
        slots.push(Number(m[1]));
        // 紧贴在单词后面的占位符是复数词尾（"step{1}" 里的 s），只允许 s/es 或空，
        // 否则 "{0} question{1}" 会把整段长文吞进 {1}。
        const prev = parts[pi - 1] || '';
        src += /[A-Za-z]$/.test(prev) ? '((?:e?s)?)' : '(.+?)';
      } else if (p) {
        src += escapeRe(p);
        literalLen += p.length;
        if (p.trim().length > lit.length) lit = p.trim();
      }
    }
    if (!slots.length || literalLen < 2) continue;
    src += '$';
    // 字面部分字母太少的句式（"{0} of {1}"、"{0} and {1}"、"{0} ago"）很容易误伤普通文字，
    // 比如把 "Terms of Service" 变成 "Terms/Service"。这类“弱句式”只在每个占位符
    // 都是数字、或本身能被翻译时才生效。
    const letters = parts.filter((x) => !/^\{\d+\}$/.test(x)).join('').replace(/[^A-Za-z]/g, '').length;
    try {
      PATTERNS.push({ re: new RegExp(src), slots, zh, lit, literalLen, weak: letters < 4 });
    } catch (_) { /* 坏的模式直接忽略 */ }
  }
  // 字面部分越长越具体，优先匹配
  PATTERNS.sort((a, b) => b.literalLen - a.literalLen);

  // 句中夹着按钮、代码等元素的句子：按父元素的完整原文定位，再分别指定每个文字片段的译法
  //   "Type / and select plan to have the agent generate a plan.": {
  //     "Type": "输入", "and select": "并选择", "to have the agent generate a plan.": "，让智能体生成计划。" }
  //   整句里的动态部分写成 {0}、{1}（比如按钮上的变量名），按通配处理。
  const SEQ = new Map();
  const SEQ_RE = [];
  const seqData = (data && data.sentences) || {};
  for (const k of Object.keys(seqData)) {
    const frags = seqData[k];
    if (!frags || typeof frags !== 'object') continue;
    const m = new Map();
    for (const f of Object.keys(frags)) {
      if (typeof frags[f] === 'string') m.set(norm(f), frags[f]);
    }
    if (!m.size) continue;
    const key = norm(k);
    if (/\{\d+\}/.test(key)) {
      // 动态部分可能为空（比如复数的 "s"），所以用 .*?
      const src = '^' + key.split(/\{\d+\}/).map(escapeRe).join('(.*?)') + '$';
      try { SEQ_RE.push({ re: new RegExp(src), frags: m, lit: key.replace(/\{\d+\}/g, '').length }); } catch (_) { /* ignore */ }
    } else {
      SEQ.set(key, m);
    }
  }
  SEQ_RE.sort((a, b) => b.lit - a.lit);
  const seqCache = new Map();
  function sentenceFrags(sentence) {
    const key = norm(sentence);
    const hit = SEQ.get(key);
    if (hit) return hit;
    if (!SEQ_RE.length) return null;
    if (seqCache.has(key)) return seqCache.get(key);
    let found = null;
    for (const s of SEQ_RE) {
      if (s.re.test(key)) { found = s.frags; break; }
    }
    if (seqCache.size > 5000) seqCache.clear();
    seqCache.set(key, found);
    return found;
  }

  const cache = new Map();
  const CACHE_MAX = 20000;

  function lookupExact(key, anyCase) {
    const v = TEXT.get(key);
    if (v !== undefined) return v;
    // 忽略大小写只用于 "Sort by" / "Sort By" 这种标题大小写差异；
    // 单独一个全小写的词（name、type、string…）多半是代码或标识符，不做模糊匹配。
    // 句式占位符里的词（"{0} 以外的对话" 里的 projects）除外。
    if (!anyCase && !/[A-Z\s]/.test(key)) return null;
    const lv = LOWER.get(key.toLowerCase());
    return lv == null ? null : lv;
  }

  function lookup(key, depth = 0) {
    let v = lookupExact(key, depth > 0);
    if (v != null) return v;

    // 末尾标点变体："Model:" -> "模型：" / "Loading" + "…"
    let m = /^(.*?[A-Za-z)\]])\s*([:：])$/.exec(key);
    if (m) {
      v = lookupExact(m[1]);
      if (v != null) return v + '：';
    }
    m = /^(.*?[A-Za-z)\]])\s*(\.\.\.|…)$/.exec(key);
    if (m) {
      v = lookupExact(m[1]);
      if (v != null) return v + '…';
    }

    for (const p of PATTERNS) {
      if (p.lit && key.indexOf(p.lit) === -1) continue;
      const mm = p.re.exec(key);
      if (!mm) continue;
      const caps = mm.slice(1);
      const byIndex = {};
      const tr = {};
      let ok = true;
      p.slots.forEach((slot, i) => {
        const c = caps[i];
        byIndex[slot] = c;
        if (c == null || NUMERIC.test(c)) return;
        // 占位符里的内容如果本身是界面词（比如状态名），顺手翻译；数字、路径等保持原样。
        // 再查一层（含句式），例如 "{0} ago" 里的 "about 3 hours"。
        const t = depth < 1 ? lookup(norm(c), depth + 1) : lookupExact(norm(c), true);
        if (t != null) tr[slot] = t;
        else if (p.weak && c.trim()) ok = false;
      });
      if (!ok) continue;
      return fill(p.zh, (n) => {
        const c = byIndex[n];
        if (c == null) return '';
        return tr[n] != null ? tr[n] : c;
      });
    }
    return null;
  }

  /** 只做整句精确匹配（含末尾标点变体），不用句式。用于对话标题等内容区域。 */
  function translateExact(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > 4000 || !/[A-Za-z]/.test(raw)) return null;
    const key = norm(raw);
    let zh = lookupExact(key);
    if (zh == null) {
      const m = /^(.*?[A-Za-z)\]])\s*(\.\.\.|…)$/.exec(key);
      if (m && lookupExact(m[1]) != null) zh = lookupExact(m[1]) + '…';
    }
    if (zh == null || zh === key) return null;
    return /^\s*/.exec(raw)[0] + zh + /\s*$/.exec(raw)[0];
  }

  // 把值填进译文模板，并按中文排版习惯处理占位符两侧的空格：
  // 汉字和英文/数字相邻时留一个空格，汉字和汉字、标点相邻时不留。
  function fill(tpl, valueOf) {
    const parts = tpl.split(/(\{\d+\})/);
    let outStr = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const m = /^\{(\d+)\}$/.exec(part);
      if (!m) {
        outStr += part;
        continue;
      }
      const v = String(valueOf(m[1]));
      // 左侧
      outStr = joinSpace(outStr, v);
      // 右侧：下一段模板文字
      const next = parts[i + 1] || '';
      const trimmedNext = next.replace(/^ +/, '');
      const vEnd = v ? v[v.length - 1] : outStr.slice(-1);
      const nextChar = trimmedNext[0];
      if (vEnd && nextChar && isWord(vEnd) && isWord(nextChar)) {
        parts[i + 1] = (needsSpace(vEnd, nextChar) ? ' ' : '') + trimmedNext;
      }
    }
    return outStr;
  }

  // 只有两侧都是“字”（汉字或英文数字）时才调整空格；遇到标点保持模板原样
  function joinSpace(left, v) {
    if (!v) return left;
    const trimmed = left.replace(/ +$/, '');
    const a = trimmed.slice(-1);
    const b = v[0];
    if (a && isWord(a) && isWord(b)) return trimmed + (needsSpace(a, b) ? ' ' : '') + v;
    return left + v;
  }

  /**
   * 翻译一段界面文字。命中时返回译文（保留原文首尾空白），否则返回 null。
   */
  function translate(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4000) return null;
    const cached = cache.get(raw);
    if (cached !== undefined) return cached;
    let res = null;
    if (/[A-Za-z]/.test(raw)) {
      const key = norm(raw);
      if (key) {
        const zh = lookup(key);
        if (zh != null && zh !== key) {
          const lead = /^\s*/.exec(raw)[0];
          const trail = /\s*$/.exec(raw)[0];
          res = lead + zh + trail;
        }
      }
    }
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(raw, res);
    return res;
  }

  /**
   * 在整句上下文里翻译一个片段。sentence 是父元素的完整原文。
   * 片段在规则里有译法就用它（可以是空字符串，表示这一段并进别处了），否则返回 undefined。
   */
  function translateFragment(sentence, raw) {
    if ((!SEQ.size && !SEQ_RE.length) || typeof sentence !== 'string') return undefined;
    const frags = sentenceFrags(sentence);
    if (!frags) return undefined;
    const key = norm(raw);
    if (!frags.has(key)) return undefined;
    const zh = frags.get(key);
    const lead = /^\s*/.exec(raw)[0];
    const trail = /\s*$/.exec(raw)[0];
    // 中文片段之间不需要英文那样的空格；只在译文两端是拉丁字母/数字时保留
    const keepLead = lead && /^[A-Za-z0-9]/.test(zh) ? ' ' : '';
    const keepTrail = trail && /[A-Za-z0-9]$/.test(zh) ? ' ' : '';
    return keepLead + zh + keepTrail;
  }

  return {
    translate,
    translateExact,
    translateFragment,
    hasSentences: SEQ.size > 0 || SEQ_RE.length > 0,
    size: TEXT.size,
    patternCount: PATTERNS.length,
  };
}

function norm(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const NUMERIC = /^[\d\s.,:%+\-/]*$/;
const LATIN = /[A-Za-z0-9]/;
function needsSpace(a, b) {
  if (!a || !b) return false;
  return (CJK.test(a) && LATIN.test(b)) || (LATIN.test(a) && CJK.test(b));
}
function isWord(ch) {
  return CJK.test(ch) || LATIN.test(ch);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTranslator, norm };
}
