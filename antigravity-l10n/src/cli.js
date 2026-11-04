'use strict';
/*
 * Antigravity 本地化（简体中文 / 日语）· 命令行
 *
 *   apply    应用界面翻译（必要时先备份官方原版；已应用其他语言时直接切换）
 *   restore  还原官方英文原版
 *   status   查看当前状态
 *
 * 选项：
 *   --locale <zh-CN|ja> 界面语言，同时决定本程序输出用的语言。默认 zh-CN
 *   --dir <安装目录>   Antigravity 安装目录（含 resources 文件夹）。不给的话自动查找
 *   --log <文件>       把输出写进这个文件（UTF-8），不打印到控制台
 *   --dry-run          只生成并校验，不写入安装目录
 *
 * 在 Windows 上由 汉化.bat → scripts/agzh.ps1 调用，借 Antigravity.exe 自带的 Node 运行
 * （ELECTRON_RUN_AS_NODE=1），不需要另装 Node.js。也可以直接用 node 运行。
 * 本程序不做任何交互；关闭/重启 Antigravity 由启动脚本负责。
 */

// Electron 以 Node 模式运行时，fs 会把 .asar 当目录处理；关掉它，按普通文件读写
try { process.noAsar = true; } catch (_) { /* ignore */ }
let fs;
try { fs = require('original-fs'); } catch (_) { fs = require('fs'); }
const path = require('path');
const os = require('os');
const patch = require('./patch');
const asar = require('./asar');
const { AgzhError, LOCALES, messages } = require('./messages');

const BACKUP_NAME = 'app.asar.agzh-original';

// ---------- 输出 ----------
const lines = [];
let logFile = null;
function out(msg = '') {
  if (logFile) lines.push(msg);
  else process.stdout.write(msg + '\n');
}
function flush() {
  if (logFile) {
    try { fs.writeFileSync(logFile, lines.join('\r\n') + '\r\n', 'utf8'); } catch (_) { /* ignore */ }
  }
}

// ---------- 参数 ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--locale') args.locale = argv[++i];
    else if (a === '--log') args.log = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

// ---------- 找安装目录 ----------
function resourcesDirOf(installDir) {
  for (const sub of ['resources', 'Contents/Resources', 'Resources']) {
    const p = path.join(installDir, sub);
    if (fs.existsSync(path.join(p, 'app.asar')) || fs.existsSync(path.join(p, BACKUP_NAME))) return p;
  }
  return null;
}

function candidates() {
  const list = [];
  const exe = process.execPath;
  if (/antigravity(\.exe)?$/i.test(path.basename(exe))) list.push(path.dirname(exe));
  const env = process.env;
  if (process.platform === 'win32') {
    if (env.LOCALAPPDATA) {
      list.push(path.join(env.LOCALAPPDATA, 'Programs', 'antigravity'));
      list.push(path.join(env.LOCALAPPDATA, 'Programs', 'Antigravity'));
    }
    if (env.ProgramFiles) list.push(path.join(env.ProgramFiles, 'Antigravity'));
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Antigravity.app');
    list.push(path.join(os.homedir(), 'Applications', 'Antigravity.app'));
  } else {
    list.push('/opt/Antigravity', '/opt/antigravity', '/usr/share/antigravity', '/usr/lib/antigravity');
  }
  return list;
}

function findResources(dir) {
  if (dir) {
    const r = resourcesDirOf(dir) || (fs.existsSync(path.join(dir, 'app.asar')) ? dir : null);
    if (!r) throw new AgzhError('DIR_NO_ASAR', dir);
    return r;
  }
  for (const c of candidates()) {
    const r = resourcesDirOf(c);
    if (r) return r;
  }
  throw new AgzhError('NO_INSTALL');
}

// ---------- 文件操作 ----------
function writeAtomic(target, buf) {
  const tmp = target + '.agzh-tmp';
  fs.writeFileSync(tmp, buf);
  const back = fs.readFileSync(tmp);
  if (!back.equals(buf)) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw new AgzhError('WRITE_VERIFY', path.basename(target));
  }
  try {
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) {
      throw new AgzhError('LOCKED', path.basename(target));
    }
    throw e;
  }
}

function inspect(resDir) {
  const asarPath = path.join(resDir, 'app.asar');
  const backupPath = path.join(resDir, BACKUP_NAME);
  const st = { resDir, asarPath, backupPath, exists: fs.existsSync(asarPath), backup: null };
  if (st.exists) {
    const buf = fs.readFileSync(asarPath);
    const arc = asar.parse(buf);
    st.buf = buf;
    st.meta = patch.readMeta(arc);
    st.pkg = patch.appPackage(arc);
    st.sha256 = patch.sha256(buf);
  }
  if (fs.existsSync(backupPath)) {
    const bbuf = fs.readFileSync(backupPath);
    let bpkg = null;
    let bmeta = null;
    try {
      const barc = asar.parse(bbuf);
      bpkg = patch.appPackage(barc);
      bmeta = patch.readMeta(barc);
    } catch (_) { /* 备份损坏 */ }
    st.backup = { buf: bbuf, pkg: bpkg, patched: !!bmeta, sha256: patch.sha256(bbuf) };
  }
  return st;
}

// ---------- 命令 ----------
let T = messages(patch.DEFAULT_LOCALE);

function cmdStatus(resDir) {
  const st = inspect(resDir);
  out(T.t('installDir', path.dirname(resDir)));
  if (!st.exists) {
    out(T.t('statusNoAsar'));
    return 1;
  }
  out(T.t('appVersion', st.pkg ? st.pkg.version : T.t('unknown')));
  if (st.meta) {
    out(T.t('statusPatched', T.localeName(st.meta.locale || 'zh-CN'), st.meta.toolVersion, st.meta.entries, st.meta.patchedAt));
  } else {
    out(T.t('statusOfficial'));
  }
  if (st.backup) {
    out(T.t('backup', BACKUP_NAME, st.backup.pkg ? st.backup.pkg.version : T.t('unknown')));
  } else {
    out(T.t('backupNone'));
  }
  out(T.t('toolVersion', patch.toolVersion()));
  return 0;
}

function cmdApply(resDir, args, locale) {
  const st = inspect(resDir);
  if (!st.exists) throw new AgzhError('NO_ASAR', st.asarPath);

  let original;
  if (!st.meta) {
    // 当前就是官方原版（第一次应用，或官方更新后变回英文）
    patch.checkTarget(asar.parse(st.buf));
    original = st.buf;
    out(T.t('detectedOfficial', st.pkg.version));
  } else {
    // 已经应用过（同一种或另一种语言）：用备份重新生成
    if (!st.backup || st.backup.patched) throw new AgzhError('NO_BACKUP_REGEN');
    if (st.backup.sha256 !== st.meta.originalSha256) throw new AgzhError('BACKUP_MISMATCH');
    original = st.backup.buf;
    out(T.t('regenerate', T.localeName(st.meta.locale || 'zh-CN'), st.backup.pkg.version));
  }

  const { buf, meta } = patch.buildPatched(original, { locale });
  out(T.t('built', T.localeName(locale), meta.entries));

  if (args.dryRun) {
    const p = path.join(os.tmpdir(), 'app.asar.agzh-dryrun');
    fs.writeFileSync(p, buf);
    out(T.t('dryRun', p));
    return 0;
  }

  // 备份：只备份官方原版；已有同一份就不重复写
  const origSha = patch.sha256(original);
  if (!st.backup || st.backup.sha256 !== origSha) {
    writeAtomic(st.backupPath, original);
    out(T.t('backedUp', BACKUP_NAME));
  }
  writeAtomic(st.asarPath, buf);
  out(T.t('applied', T.localeName(locale)));
  return 0;
}

function cmdRestore(resDir, args) {
  const st = inspect(resDir);
  if (st.exists && !st.meta) {
    out(T.t('alreadyOfficial'));
    if (st.backup && !args.dryRun) {
      // 当前已是官方原版，留着的备份没用了
      fs.unlinkSync(st.backupPath);
      out(T.t('removedBackup', BACKUP_NAME));
    }
    return 0;
  }
  if (!st.backup || st.backup.patched || !st.backup.pkg) throw new AgzhError('NO_BACKUP_RESTORE');
  if (st.meta && st.backup.sha256 !== st.meta.originalSha256) throw new AgzhError('RESTORE_MISMATCH');
  if (args.dryRun) {
    out(T.t('restoreDryRun'));
    return 0;
  }
  writeAtomic(st.asarPath, st.backup.buf);
  fs.unlinkSync(st.backupPath);
  out(T.t('restored', st.backup.pkg.version));
  return 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.log) logFile = args.log;
  const locale = args.locale || patch.DEFAULT_LOCALE;
  T = messages(LOCALES[locale] ? locale : patch.DEFAULT_LOCALE);
  if (!LOCALES[locale]) throw new AgzhError('UNKNOWN_LOCALE', locale);
  const cmd = args._[0] || 'status';
  if (args.help || !['apply', 'restore', 'status'].includes(cmd)) {
    out(T.t('usage'));
    return args.help ? 0 : 2;
  }
  const resDir = findResources(args.dir);
  if (cmd === 'status') return cmdStatus(resDir);
  if (cmd === 'apply') return cmdApply(resDir, args, locale);
  return cmdRestore(resDir, args);
}

let code = 1;
try {
  code = main();
} catch (e) {
  out(T.t('error', T.error(e)));
  code = 1;
}
flush();
process.exitCode = code;
