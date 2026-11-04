<#
  Antigravity 本地化（简体中文 / 日本語）· Windows 启动脚本

  由 汉化.bat / 日本語化.bat 等入口调用，也可以直接运行：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\agzh.ps1 -Command apply -Locale zh-CN
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\agzh.ps1 -Command apply -Locale ja -InstallDir "D:\Apps\Antigravity"

  这个脚本负责：找到安装目录、需要时关闭正在运行的 Antigravity、
  借 Antigravity.exe 自带的 Node 运行 src\cli.js（不需要另装 Node.js）、显示结果、按需重新打开。
  真正改文件的只有 src\cli.js。

  注意：保持兼容 Windows 自带的 PowerShell 5.1（不用 ?? 、?. 、三元运算符）。
  本文件必须以 UTF-8 BOM 保存，否则 PowerShell 5.1 会读错中文。
#>
param(
  [ValidateSet('apply', 'restore', 'status')]
  [string]$Command = 'status',
  [ValidateSet('zh-CN', 'ja')]
  [string]$Locale = 'zh-CN',
  [string]$InstallDir = '',
  [switch]$Yes,
  [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$ToolRoot = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path (Join-Path $ToolRoot 'src') 'cli.js'
$FuseSentinel = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

$Messages = @{
  'zh-CN' = @{
    Title        = '==== Antigravity 中文界面 ===='
    NotFound     = '没找到 Antigravity 2.x 的安装目录。'
    NotFoundHint = '如果装在别的位置，可以手动指定（Antigravity.exe 所在的文件夹）：'
    Running1     = 'Antigravity 正在运行，需要先把它关掉。'
    Running2     = '正在进行的对话会被中断，没保存的内容可能会丢失。'
    AskClose     = '输入 Y 关闭 Antigravity 并继续，直接回车取消'
    Cancelled    = '已取消，没有做任何改动。'
    StillRunning = 'Antigravity 没能完全退出。请在任务管理器里结束 Antigravity 后再运行一次。'
    AskStart     = '现在打开 Antigravity 吗？输入 Y 打开，直接回车跳过'
    Started      = '已重新打开 Antigravity。'
    NoNode       = '这个版本的 Antigravity 不能借用内置的 Node 运行，系统里也没有找到 Node.js。请安装 Node.js 18 以上版本后再试。'
    Timeout      = '处理超时（超过 3 分钟），已中止。'
    NoLog        = '处理失败（退出码 {0}），没有输出日志。'
    Error        = '出错了：'
    DirExample   = 'D:\你的安装目录'
  }
  'ja' = @{
    Title        = '==== Antigravity 日本語化 ===='
    NotFound     = 'Antigravity 2.x のインストール先が見つかりません。'
    NotFoundHint = '別の場所にインストールしている場合は、Antigravity.exe があるフォルダーを指定してください：'
    Running1     = 'Antigravity が起動しています。先に終了する必要があります。'
    Running2     = '実行中の会話は中断され、保存していない内容は失われる可能性があります。'
    AskClose     = 'Y を入力すると Antigravity を終了して続行します（Enter のみでキャンセル）'
    Cancelled    = 'キャンセルしました。何も変更していません。'
    StillRunning = 'Antigravity を完全に終了できませんでした。タスク マネージャーで Antigravity を終了してから、もう一度実行してください。'
    AskStart     = 'Antigravity を起動しますか？Y で起動、Enter のみでスキップ'
    Started      = 'Antigravity を起動しました。'
    NoNode       = 'このバージョンの Antigravity は内蔵の Node で実行できず、Node.js も見つかりません。Node.js 18 以降をインストールしてから、もう一度お試しください。'
    Timeout      = '処理がタイムアウトしました（3 分以上）。中止しました。'
    NoLog        = '処理に失敗しました（終了コード {0}）。ログが出力されていません。'
    Error        = 'エラー：'
    DirExample   = 'D:\インストール先'
  }
}
$Msg = $Messages[$Locale]

function Write-Warn([string]$msg) { Write-Host $msg -ForegroundColor Yellow }
function Write-Err([string]$msg) { Write-Host $msg -ForegroundColor Red }

function Get-ExeInDir([string]$dir) {
  foreach ($name in @('Antigravity.exe', 'antigravity')) {
    $p = Join-Path $dir $name
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
  }
  return $null
}

function Test-InstallDir([string]$dir) {
  if (-not $dir) { return $false }
  try {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $false }
  } catch { return $false }
  $res = Join-Path $dir 'resources'
  $hasAsar = (Test-Path -LiteralPath (Join-Path $res 'app.asar')) -or
             (Test-Path -LiteralPath (Join-Path $res 'app.asar.agzh-original'))
  return ($hasAsar -and [bool](Get-ExeInDir $dir))
}

function Find-InstallDir {
  $cands = New-Object System.Collections.Generic.List[string]

  # 1) 正在运行的 Antigravity
  try {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Antigravity' } | ForEach-Object {
      if ($_.Path) { $cands.Add((Split-Path -Parent $_.Path)) }
    }
  } catch { }

  # 2) 卸载信息（注册表）
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    try {
      if (-not (Test-Path $root)) { continue }
      Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          $p = Get-ItemProperty $_.PSPath -ErrorAction Stop
          if ($p.DisplayName -and ($p.DisplayName -like 'Antigravity*')) {
            if ($p.InstallLocation) { $cands.Add(([string]$p.InstallLocation).Trim('"')) }
            if ($p.DisplayIcon) {
              $icon = (([string]$p.DisplayIcon) -replace ',\s*-?\d+$', '').Trim('"')
              if ($icon) { $cands.Add((Split-Path -Parent $icon)) }
            }
          }
        } catch { }
      }
    } catch { }
  }

  # 3) 默认位置（按用户安装 / 按机器安装）
  if ($env:LOCALAPPDATA) {
    $cands.Add((Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') 'antigravity'))
  }
  if ($env:ProgramFiles) { $cands.Add((Join-Path $env:ProgramFiles 'Antigravity')) }

  foreach ($c in $cands) {
    if (Test-InstallDir $c) { return (Resolve-Path -LiteralPath $c).Path }
  }
  return $null
}

# 安装目录下正在运行的进程（Antigravity 本体、language_server 等）
function Get-AppProcesses([string]$dir) {
  $full = [System.IO.Path]::GetFullPath($dir).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  $list = @()
  foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
    try {
      $path = $p.Path
      if ($path -and ([System.IO.Path]::GetFullPath($path)).StartsWith($full, [System.StringComparison]::OrdinalIgnoreCase)) {
        $list += $p
      }
    } catch { }
  }
  return $list
}

# Antigravity.exe 能不能当 Node 用（Electron 的 RunAsNode 开关）
function Test-RunAsNodeFuse([string]$exe) {
  $latin1 = [System.Text.Encoding]::GetEncoding(28591)
  $chunk = 16MB
  $fs = [System.IO.File]::OpenRead($exe)
  try {
    $buf = New-Object byte[] ($chunk + 64)
    $offset = [long]0
    while ($true) {
      $fs.Position = $offset
      $n = $fs.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      $i = $latin1.GetString($buf, 0, $n).IndexOf($FuseSentinel, [System.StringComparison]::Ordinal)
      if ($i -ge 0) {
        # 哨兵之后：[版本][开关个数][RunAsNode][...]，'1' 表示开启
        $fs.Position = $offset + $i + $FuseSentinel.Length
        $b = New-Object byte[] 3
        [void]$fs.Read($b, 0, 3)
        return ($b[2] -eq 0x31)
      }
      if ($n -lt $buf.Length) { break }
      $offset += $chunk
    }
  } finally {
    $fs.Dispose()
  }
  return $false
}

function Invoke-Cli([string]$exe, [string]$cmd, [string]$dir) {
  $log = Join-Path ([System.IO.Path]::GetTempPath()) ('agzh-' + [guid]::NewGuid().ToString('N') + '.log')
  $argLine = '"{0}" {1} --locale {2} --dir "{3}" --log "{4}"' -f $Cli, $cmd, $Locale, $dir, $log

  $useElectron = Test-RunAsNodeFuse $exe
  if ($useElectron) {
    $runner = $exe
  } else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      throw $Msg.NoNode
    }
    $runner = $node.Source
  }

  $old = $env:ELECTRON_RUN_AS_NODE
  if ($useElectron) { $env:ELECTRON_RUN_AS_NODE = '1' }
  try {
    $p = Start-Process -FilePath $runner -ArgumentList $argLine -NoNewWindow -PassThru
    $null = $p.Handle # 先取句柄，进程结束后才能拿到退出码
    if (-not $p.WaitForExit(180000)) {
      try { $p.Kill() } catch { }
      throw $Msg.Timeout
    }
    $code = $p.ExitCode
  } finally {
    if ($useElectron) {
      if ($null -eq $old) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
      else { $env:ELECTRON_RUN_AS_NODE = $old }
    }
  }

  if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log -Encoding UTF8 | ForEach-Object { Write-Host $_ }
    Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
  } elseif ($code -ne 0) {
    Write-Err ($Msg.NoLog -f $code)
  }
  return $code
}

try {
  Write-Host ''
  Write-Host $Msg.Title -ForegroundColor Cyan

  if ($InstallDir) { $dir = $InstallDir } else { $dir = Find-InstallDir }
  if (-not $dir -or -not (Test-InstallDir $dir)) {
    Write-Err $Msg.NotFound
    Write-Host $Msg.NotFoundHint
    Write-Host ('  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\agzh.ps1 -Command apply -Locale {0} -InstallDir "{1}"' -f $Locale, $Msg.DirExample)
    exit 1
  }
  $dir = (Resolve-Path -LiteralPath $dir).Path
  $exe = Get-ExeInDir $dir

  $wasRunning = $false
  if ($Command -ne 'status') {
    $procs = @(Get-AppProcesses $dir)
    if ($procs.Count -gt 0) {
      $wasRunning = $true
      Write-Warn $Msg.Running1
      Write-Warn $Msg.Running2
      if (-not $Yes) {
        $ans = Read-Host $Msg.AskClose
        if ($ans -notmatch '^\s*[Yy]') {
          Write-Host $Msg.Cancelled
          exit 2
        }
      }
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      $deadline = (Get-Date).AddSeconds(20)
      while ((@(Get-AppProcesses $dir).Count -gt 0) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 300 }
      if (@(Get-AppProcesses $dir).Count -gt 0) {
        Write-Err $Msg.StillRunning
        exit 1
      }
      Start-Sleep -Milliseconds 500
    }
  }

  $code = Invoke-Cli $exe $Command $dir

  if ($code -eq 0 -and $Command -ne 'status' -and -not $NoRestart) {
    $start = $wasRunning
    if (-not $start -and -not $Yes) {
      $ans = Read-Host $Msg.AskStart
      $start = ($ans -match '^\s*[Yy]')
    }
    if ($start) {
      Start-Process -FilePath $exe -WorkingDirectory $dir | Out-Null
      Write-Host $Msg.Started
    }
  }
  exit $code
} catch {
  Write-Err ($Msg.Error + $_.Exception.Message)
  exit 1
}
