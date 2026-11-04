'use strict';
/*
 * 极简 asar 读写（不依赖任何 npm 包）。
 *
 * 文件结构（与 @electron/asar 一致）：
 *   [UInt32 4][UInt32 headerBufSize]              ← size pickle
 *   [UInt32 payloadSize][UInt32 jsonLen][json][pad] ← header pickle（长度 headerBufSize）
 *   [文件数据...]                                   ← 偏移从 8 + headerBufSize 开始
 * header.files 是目录树；文件节点 {size, offset, integrity, executable?, unpacked?}，
 * unpacked 的文件数据放在旁边的 app.asar.unpacked 目录里，不在包内。
 */

const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024;

function parse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw new Error('不是有效的 asar 文件（太短）');
  if (buf.readUInt32LE(0) !== 4) throw new Error('不是有效的 asar 文件（文件头不对）');
  const headerBufSize = buf.readUInt32LE(4);
  const payloadSize = buf.readUInt32LE(8);
  const jsonLen = buf.readInt32LE(12);
  if (8 + headerBufSize > buf.length || jsonLen <= 0 || jsonLen > payloadSize) {
    throw new Error('不是有效的 asar 文件（头部长度异常）');
  }
  const headerString = buf.toString('utf8', 16, 16 + jsonLen);
  const header = JSON.parse(headerString);
  if (!header || typeof header.files !== 'object') throw new Error('asar 头部缺少 files');
  return { buf, header, headerString, dataOffset: 8 + headerBufSize };
}

function splitPath(p) {
  return String(p).replace(/\\/g, '/').split('/').filter(Boolean);
}

function getNode(archive, p) {
  let node = archive.header;
  for (const part of splitPath(p)) {
    if (!node.files || !Object.prototype.hasOwnProperty.call(node.files, part)) return null;
    node = node.files[part];
  }
  return node;
}

function readFile(archive, p) {
  const node = getNode(archive, p);
  if (!node || node.files || node.link) throw new Error(`asar 内没有文件：${p}`);
  if (node.unpacked) throw new Error(`文件在 app.asar.unpacked 里，不在包内：${p}`);
  const start = archive.dataOffset + Number(node.offset);
  return archive.buf.subarray(start, start + node.size);
}

function listFiles(archive) {
  const out = [];
  (function rec(node, prefix) {
    for (const name of Object.keys(node.files)) {
      const child = node.files[name];
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) rec(child, p);
      else out.push(p);
    }
  })(archive.header, '');
  return out;
}

function integrityOf(data) {
  const blocks = [];
  for (let i = 0; i < data.length; i += BLOCK_SIZE) {
    blocks.push(crypto.createHash('sha256').update(data.subarray(i, i + BLOCK_SIZE)).digest('hex'));
  }
  if (blocks.length === 0) blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
  return {
    algorithm: 'SHA256',
    hash: crypto.createHash('sha256').update(data).digest('hex'),
    blockSize: BLOCK_SIZE,
    blocks,
  };
}

/**
 * 以原包为底，替换/新增若干文件，生成新的 asar Buffer。
 * changes: Map<路径, Buffer>（路径用 / 分隔）
 */
function rebuild(archive, changes) {
  const header = JSON.parse(archive.headerString); // 深拷贝，保持原有键顺序
  // 新增文件：先在目录树里建好节点
  for (const [p, data] of changes) {
    const parts = splitPath(p);
    let node = header;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.files[parts[i]]) node.files[parts[i]] = { files: {} };
      node = node.files[parts[i]];
      if (!node.files) throw new Error(`路径冲突：${p}`);
    }
    const leaf = parts[parts.length - 1];
    const old = node.files[leaf];
    if (old && (old.files || old.link || old.unpacked)) throw new Error(`不能替换这个节点：${p}`);
    node.files[leaf] = { size: data.length, offset: '0', integrity: integrityOf(data) };
    if (old && old.executable) node.files[leaf].executable = true;
  }

  const chunks = [];
  let offset = 0;
  (function rec(node, prefix) {
    for (const name of Object.keys(node.files)) {
      const child = node.files[name];
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.files) { rec(child, p); continue; }
      if (child.link || child.unpacked) continue;
      const data = changes.has(p) ? changes.get(p) : readFile(archive, p);
      child.offset = String(offset);
      child.size = data.length;
      chunks.push(data);
      offset += data.length;
    }
  })(header, '');

  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = (json.length + 3) & ~3;
  const headerBuf = Buffer.alloc(8 + padded);
  headerBuf.writeUInt32LE(4 + padded, 0); // payload size
  headerBuf.writeInt32LE(json.length, 4);
  json.copy(headerBuf, 8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeUInt32LE(4, 0);
  sizeBuf.writeUInt32LE(headerBuf.length, 4);
  return Buffer.concat([sizeBuf, headerBuf, ...chunks]);
}

module.exports = { parse, getNode, readFile, listFiles, rebuild, integrityOf };
