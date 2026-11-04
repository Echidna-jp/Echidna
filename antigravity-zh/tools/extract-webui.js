'use strict';
/*
 * 从 Antigravity 的 language_server（.exe）里取出内嵌的界面文件（main.js 等）。
 * 界面以 zip 形式嵌在这个 Go 程序里；这里按 zip 结尾记录找到它并解压，不依赖任何 npm 包。
 *
 *   node tools/extract-webui.js "<安装目录>\resources\bin\language_server.exe" <输出目录>
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [, , bin, outDir] = process.argv;
if (!bin || !outDir) {
  console.log('用法：node tools/extract-webui.js <language_server 路径> <输出目录>');
  process.exit(2);
}
const d = fs.readFileSync(bin);
const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
let found = 0;
for (let e = d.indexOf(EOCD); e >= 0; e = d.indexOf(EOCD, e + 4)) {
  const entries = d.readUInt16LE(e + 10);
  const cdSize = d.readUInt32LE(e + 12);
  const cdOff = d.readUInt32LE(e + 16);
  const cdStart = e - cdSize;
  if (cdStart < 0 || d.readUInt32LE(cdStart) !== 0x02014b50) continue;
  const base = cdStart - cdOff;
  // 只要包含 index.html + main.js 的那个包
  const names = [];
  let p = cdStart;
  for (let i = 0; i < entries; i++) {
    const nl = d.readUInt16LE(p + 28), el = d.readUInt16LE(p + 30), cl = d.readUInt16LE(p + 32);
    names.push({
      name: d.toString('utf8', p + 46, p + 46 + nl),
      method: d.readUInt16LE(p + 10),
      csize: d.readUInt32LE(p + 20),
      lho: d.readUInt32LE(p + 42),
    });
    p += 46 + nl + el + cl;
  }
  if (!names.some((n) => n.name === 'main.js') || !names.some((n) => n.name === 'index.html')) continue;
  for (const n of names) {
    if (n.name.endsWith('/')) continue;
    const lh = base + n.lho;
    const start = lh + 30 + d.readUInt16LE(lh + 26) + d.readUInt16LE(lh + 28);
    const raw = d.subarray(start, start + n.csize);
    const data = n.method === 8 ? zlib.inflateRawSync(raw) : raw;
    const dst = path.join(outDir, n.name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, data);
  }
  found++;
  console.log(`已解出 ${names.length} 个文件到 ${outDir}（main.js ${fs.statSync(path.join(outDir, 'main.js')).size} 字节）`);
}
if (!found) {
  console.log('没找到内嵌的界面包，可能是官方改了打包方式。');
  process.exit(1);
}
