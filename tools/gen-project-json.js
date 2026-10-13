#!/usr/bin/env node
/**
 * 根据 sakura-wallpaper/js/params.js + config.js 生成 Wallpaper Engine 的 project.json。
 * 属性面板的默认值取自 config.js，保证两边一致。
 *
 * 用法：node tools/gen-project-json.js
 * 修改了 config.js 的默认值或 params.js 的参数清单后运行一次即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'sakura-wallpaper');
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const file of ['config.js', 'js/core/config.js', 'js/params.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const { SW, WALLPAPER_CONFIG: cfg } = sandbox.window;

const fmtColor = (c) => c.map((v) => Number(v.toFixed(3))).join(' ');

const properties = {
  schemecolor: {
    order: 0,
    text: 'ui_browse_properties_scheme_color',
    type: 'color',
    value: '0.937 0.651 0.761',
  },
};

let order = 100;
for (const p of SW.PARAMS) {
  if (p.we === false) continue;
  const prop = { order: order++, text: p.label, type: p.type };
  const v = p.path.startsWith('_') ? undefined : SW.config.getPath(cfg, p.path);
  switch (p.type) {
    case 'slider': {
      const decimals = (String(p.step).split('.')[1] || '').length;
      Object.assign(prop, { min: p.min, max: p.max, step: p.step, editable: true, fraction: decimals > 0, value: SW.params.toDisplay(p, v) });
      if (decimals > 0) prop.precision = decimals;
      break;
    }
    case 'bool':
      prop.value = !!v;
      break;
    case 'combo':
      prop.options = p.options.map((o) => ({ label: o.label, value: o.value }));
      prop.value = String(v);
      break;
    case 'color':
      prop.value = fmtColor(v);
      break;
    case 'file':
      prop.value = '';
      break;
  }
  properties[p.id] = prop;
}

const project = {
  contentrating: 'Everyone',
  description: '基于插画的春日樱花动态壁纸：花瓣分层飘落、镜头呼吸、鼠标视差、柔光 Bloom、光斑与光尘，可选头发/衣袖木偶摆动。',
  file: 'index.html',
  general: { properties },
  preview: 'preview.jpg',
  tags: ['Anime'],
  title: '樱梦 Sakura Dream',
  type: 'web',
};

const out = path.join(root, 'project.json');
fs.writeFileSync(out, JSON.stringify(project, null, 2) + '\n');
console.log('已生成 ' + out + '（' + Object.keys(properties).length + ' 个属性）');
