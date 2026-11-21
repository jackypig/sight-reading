<#
  serve.ps1 - tiny static file server, no Node or Python needed.

    .\serve.ps1                 # http://localhost:8787
    .\serve.ps1 -Port 9000
    .\serve.ps1 -AllowLan       # also reachable from a tablet on the same wifi
                                # (needs an elevated PowerShell window)

  Opening index.html straight from Explorer also works; the server is only
  needed when another device, like an iPad, has to reach the app.
#>
param(
  [int]$Port = 8787,
  [switch]$AllowLan
)

$Root = $PSScriptRoot
$prefix = if ($AllowLan) { "http://+:$Port/" } else { "http://localhost:$Port/" }

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Could not listen on $prefix" -ForegroundColor Red
  if ($AllowLan) { Write-Host "-AllowLan needs an elevated PowerShell window." -ForegroundColor Yellow }
  exit 1
}

Write-Host "Sight Reader is serving $Root" -ForegroundColor Green
Write-Host "  $prefix" -ForegroundColor Green
if ($AllowLan) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } |
    Select-Object -First 1).IPAddress
  if ($ip) { Write-Host "  http://${ip}:$Port  <- open this on the tablet" -ForegroundColor Green }
}
Write-Host "Ctrl+C to stop."

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
  } catch {
    break
  }
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $candidate = Join-Path $Root ($rel -replace '/', '\')
    $full = [System.IO.Path]::GetFullPath($candidate)

    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($Root), [System.StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
      $res.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 - $rel")
      $res.ContentType = 'text/plain; charset=utf-8'
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      $res.Close()
      continue
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.Close() } catch {}
  }
}
