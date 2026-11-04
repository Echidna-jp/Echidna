'use strict';
/*
 * 命令行输出的文字（简体中文 / 日本語）。
 * 出错时由各模块抛出带 code 的 AgzhError，这里按语言格式化。
 */

const LOCALES = {
  'zh-CN': { lang: 'zh-CN' },
  ja: { lang: 'ja' },
};

const M = {
  'zh-CN': {
    localeName: { 'zh-CN': '简体中文', ja: '日语' },
    installDir: '安装目录：{0}',
    appVersion: 'Antigravity 版本：{0}',
    unknown: '未知',
    statusNoAsar: '状态：找不到 app.asar',
    statusPatched: '状态：已应用{0}界面（工具 {1}，词条 {2} 条，{3}）',
    statusOfficial: '状态：官方英文原版',
    backup: '原版备份：{0}（{1}）',
    backupNone: '原版备份：无',
    toolVersion: '本工具：{0}',
    detectedOfficial: '检测到官方原版 {0}。',
    regenerate: '当前已应用{0}界面，用原版备份（{1}）重新生成。',
    built: '已生成{0}版：{1} 条词条，校验通过。',
    dryRun: '（--dry-run）结果写到了 {0}，安装目录没有改动。',
    backedUp: '已备份官方原版到 resources\\{0}',
    applied: '完成。重新打开 Antigravity 即可看到{0}界面。',
    alreadyOfficial: '当前已经是官方英文原版，不需要还原。',
    removedBackup: '已删除多余的备份 {0}。',
    restoreDryRun: '（--dry-run）可以还原，安装目录没有改动。',
    restored: '已还原官方英文原版 {0}。',
    error: '出错了：{0}',
    usage: '用法：cli.js <apply|restore|status> [--locale zh-CN|ja] [--dir 安装目录] [--log 文件] [--dry-run]',
    errors: {
      DIR_NO_ASAR: '在 {0} 下没找到 resources\\app.asar',
      NO_INSTALL: '没找到 Antigravity 的安装目录，请用 --dir 指定（含 resources 文件夹的那一层）',
      NO_ASAR: '找不到 {0}',
      LOCKED: '{0} 正被占用或没有写权限。请先完全退出 Antigravity（包括托盘图标）再试。',
      WRITE_VERIFY: '写入 {0} 后回读不一致，已放弃',
      NO_BACKUP_REGEN: '当前是修改版，但找不到可用的原版备份，无法重新生成。请先重新安装官方 Antigravity，再运行本工具。',
      BACKUP_MISMATCH: '原版备份和当前修改版对不上（可能被别的工具改过）。请重新安装官方 Antigravity，再运行本工具。',
      NO_BACKUP_RESTORE: '找不到可用的原版备份。可以直接重新安装官方 Antigravity 来恢复英文。',
      RESTORE_MISMATCH: '原版备份和当前修改版对不上，为安全起见没有还原。可以直接重新安装官方 Antigravity。',
      ALREADY_PATCHED: '传入的 app.asar 已经是修改版，需要官方原版',
      NO_PACKAGE: 'app.asar 里没有 package.json',
      NOT_ANTIGRAVITY: '这不是 Antigravity 2.x 桌面应用（name={0}, main={1}）',
      MISSING_FILE: 'app.asar 里缺少 {0}，可能是不支持的版本',
      FOREIGN_PATCH: '这个 app.asar 已经被其他汉化/本地化工具改过（不是官方原版）。请先重新安装官方 Antigravity，再运行本工具。',
      SYNTAX: '生成的 {0} 语法检查没通过：{1}',
      VERIFY: '回读校验失败：{0}',
      UNKNOWN_LOCALE: '不支持的语言：{0}（可用：zh-CN、ja）',
      LOCALE_EMPTY: '词典目录是空的：{0}',
      LOCALE_JSON: '词典文件 {0} 不是有效的 JSON：{1}',
      ASAR_INVALID: '不是有效的 asar 文件（{0}）',
    },
  },
  ja: {
    localeName: { 'zh-CN': '簡体字中国語', ja: '日本語' },
    installDir: 'インストール先：{0}',
    appVersion: 'Antigravity のバージョン：{0}',
    unknown: '不明',
    statusNoAsar: '状態：app.asar が見つかりません',
    statusPatched: '状態：{0}化パッチ適用済み（ツール {1}、{2} 項目、{3}）',
    statusOfficial: '状態：公式の英語版',
    backup: 'バックアップ：{0}（{1}）',
    backupNone: 'バックアップ：なし',
    toolVersion: 'このツール：{0}',
    detectedOfficial: '公式版 {0} を検出しました。',
    regenerate: '現在は{0}化パッチが適用されています。バックアップ（{1}）から作り直します。',
    built: '{0}版を生成しました：{1} 項目、検証 OK。',
    dryRun: '（--dry-run）結果を {0} に書き出しました。インストール先は変更していません。',
    backedUp: '公式版を resources\\{0} にバックアップしました',
    applied: '完了しました。Antigravity を起動し直すと{0}で表示されます。',
    alreadyOfficial: 'すでに公式の英語版です。元に戻す必要はありません。',
    removedBackup: '不要になったバックアップ {0} を削除しました。',
    restoreDryRun: '（--dry-run）元に戻せます。インストール先は変更していません。',
    restored: '公式の英語版 {0} に戻しました。',
    error: 'エラー：{0}',
    usage: '使い方：cli.js <apply|restore|status> [--locale zh-CN|ja] [--dir インストール先] [--log ファイル] [--dry-run]',
    errors: {
      DIR_NO_ASAR: '{0} に resources\\app.asar が見つかりません',
      NO_INSTALL: 'Antigravity のインストール先が見つかりません。--dir で指定してください（resources フォルダーがある場所）',
      NO_ASAR: '{0} が見つかりません',
      LOCKED: '{0} が使用中か、書き込み権限がありません。Antigravity を完全に終了してから（タスクトレイのアイコンも含む）もう一度お試しください。',
      WRITE_VERIFY: '{0} の書き込み後の検証に失敗したため中止しました',
      NO_BACKUP_REGEN: 'パッチ適用済みですが、元のファイルのバックアップが見つからないため作り直せません。公式の Antigravity を入れ直してから、もう一度実行してください。',
      BACKUP_MISMATCH: 'バックアップと現在のファイルが一致しません（他のツールで変更された可能性があります）。公式の Antigravity を入れ直してから、もう一度実行してください。',
      NO_BACKUP_RESTORE: '元のファイルのバックアップが見つかりません。公式の Antigravity を入れ直せば英語版に戻せます。',
      RESTORE_MISMATCH: 'バックアップと現在のファイルが一致しないため、安全のため元に戻しませんでした。公式の Antigravity を入れ直してください。',
      ALREADY_PATCHED: '渡された app.asar はすでにパッチ適用済みです。公式版が必要です',
      NO_PACKAGE: 'app.asar に package.json がありません',
      NOT_ANTIGRAVITY: 'Antigravity 2.x デスクトップアプリではありません（name={0}, main={1}）',
      MISSING_FILE: 'app.asar に {0} がありません。対応していないバージョンの可能性があります',
      FOREIGN_PATCH: 'この app.asar は他の日本語化・中国語化ツールで変更されています（公式版ではありません）。公式の Antigravity を入れ直してから、もう一度実行してください。',
      SYNTAX: '生成した {0} の構文チェックに失敗しました：{1}',
      VERIFY: '書き込み後の検証に失敗しました：{0}',
      UNKNOWN_LOCALE: '対応していない言語です：{0}（使用可能：zh-CN、ja）',
      LOCALE_EMPTY: '辞書フォルダーが空です：{0}',
      LOCALE_JSON: '辞書ファイル {0} が正しい JSON ではありません：{1}',
      ASAR_INVALID: '正しい asar ファイルではありません（{0}）',
    },
  },
};

class AgzhError extends Error {
  constructor(code, ...params) {
    super(format(M['zh-CN'].errors[code] || code, params));
    this.code = code;
    this.params = params;
  }
}

function format(tpl, params) {
  return String(tpl).replace(/\{(\d+)\}/g, (_, i) => (params[i] == null ? '' : String(params[i])));
}

function messages(locale) {
  const table = M[locale] || M['zh-CN'];
  return {
    t: (key, ...params) => format(table[key] != null ? table[key] : M['zh-CN'][key], params),
    localeName: (l) => table.localeName[l] || l,
    error: (e) => {
      if (e && e.code && table.errors[e.code]) return format(table.errors[e.code], e.params || []);
      return e && e.message ? e.message : String(e);
    },
  };
}

module.exports = { LOCALES, AgzhError, messages };
