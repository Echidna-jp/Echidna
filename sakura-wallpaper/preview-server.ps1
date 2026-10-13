# Sakura Dream - local preview server (no installation required)
# Double-click preview.bat, or run:
#   powershell -NoProfile -ExecutionPolicy Bypass -File preview-server.ps1
# Why: browsers block WebGL from reading local images when index.html is opened via file://.
# Serving the folder over http://localhost gives the full effect (bloom, puppet warp, depth).
param([int]$Port = 8765, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
if (-not $root.EndsWith([string][IO.Path]::DirectorySeparatorChar)) {
  $root += [IO.Path]::DirectorySeparatorChar
}

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.mp4'  = 'video/mp4'
  '.webm' = 'video/webm'
}

# Find a free port
$listener = $null
for ($p = $Port; $p -lt ($Port + 20); $p++) {
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$p/")
  try {
    $candidate.Start()
    $listener = $candidate
    $Port = $p
    break
  } catch {
    $candidate.Close()
  }
}
if ($null -eq $listener) {
  Write-Host "Could not start the preview server (ports $Port and above are busy)."
  exit 1
}

$url = "http://localhost:$Port/index.html"
Write-Host ""
Write-Host "  Sakura Dream preview:  $url"
Write-Host "  Press E in the page to open the tuning panel."
Write-Host "  Close this window to stop the server."
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $rel))
      if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($full)) {
        $type = $mime[[IO.Path]::GetExtension($full).ToLowerInvariant()]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.ContentType = $type
        $res.AddHeader('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      try { $res.StatusCode = 500 } catch { }
    } finally {
      try { $res.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
