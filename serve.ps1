<#
  serve.ps1 - tiny static file server, no Node or Python needed.

    .\serve.ps1                 # http://localhost:8787
    .\serve.ps1 -Port 9000
    .\serve.ps1 -AllowLan       # also reachable from a tablet on the same wifi
                                # (needs an elevated PowerShell window)
    .\serve.ps1 -Https -AllowLan  # https, so the tablet can use the microphone
                                  # (elevated; makes a self-signed certificate)

  Opening index.html straight from Explorer also works; the server is only
  needed when another device, like an iPad, has to reach the app.

  Why -Https exists: browsers only hand out the microphone on a secure origin.
  localhost counts as secure, so "Listen while I play" works on this computer
  over plain http. A tablet reaching http://192.168.x.x does NOT count, and the
  microphone prompt never appears. -Https fixes that with a self-signed
  certificate; the tablet shows a warning the first time, which you accept once.
#>
param(
  [int]$Port = 8787,
  [switch]$AllowLan,
  [switch]$Https
)

$Root = $PSScriptRoot

# A fixed GUID so repeated runs reuse the same certificate binding.
$AppId = '{0f3b7a16-2f8c-4f6e-9a4d-7c2b1d5e8a90}'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LanAddress {
  (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } |
    Select-Object -First 1).IPAddress
}

# Make sure a self-signed certificate exists and is bound to this port.
function Initialize-HttpsBinding {
  param([int]$Port)

  if (-not (Test-IsAdmin)) {
    Write-Host "-Https needs an elevated PowerShell window (Run as administrator)." -ForegroundColor Yellow
    Write-Host "Without it, listening still works on this computer at http://localhost:$Port" -ForegroundColor Yellow
    exit 1
  }

  $names = @('localhost', $env:COMPUTERNAME)
  $lan = Get-LanAddress
  if ($lan) { $names += $lan }

  $cert = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object { $_.FriendlyName -eq 'Sight Reader dev' -and $_.NotAfter -gt (Get-Date) } |
    Select-Object -First 1

  if (-not $cert) {
    Write-Host "Creating a self-signed certificate for $($names -join ', ')" -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate -DnsName $names `
      -CertStoreLocation 'Cert:\LocalMachine\My' `
      -FriendlyName 'Sight Reader dev' `
      -NotAfter (Get-Date).AddYears(3)
    $cerPath = Join-Path $Root 'sight-reader-dev.cer'
    try {
      Export-Certificate -Cert $cert -FilePath $cerPath -ErrorAction Stop | Out-Null
      Write-Host "Saved $cerPath - optional: install it on the tablet to stop the warning." -ForegroundColor Cyan
    } catch {
      Write-Host "Certificate made, but it could not be exported to a .cer file." -ForegroundColor Yellow
    }
  }

  $thumb = $cert.Thumbprint
  $show = netsh http show sslcert ipport=0.0.0.0:$Port
  $alreadyBound = $false
  if ($LASTEXITCODE -eq 0) {
    if ($show | Select-String -SimpleMatch $thumb -Quiet) {
      $alreadyBound = $true
    } else {
      netsh http delete sslcert ipport=0.0.0.0:$Port | Out-Null
    }
  }
  if (-not $alreadyBound) {
    netsh http add sslcert ipport=0.0.0.0:$Port certhash=$thumb appid=$AppId | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Could not bind the certificate to port $Port." -ForegroundColor Red
      Write-Host "To start over: netsh http delete sslcert ipport=0.0.0.0:$Port" -ForegroundColor Yellow
      exit 1
    }
  }
}

if ($Https) { Initialize-HttpsBinding -Port $Port }

$scheme = if ($Https) { 'https' } else { 'http' }
$prefix = if ($Https -or $AllowLan) { "${scheme}://+:$Port/" } else { "http://localhost:$Port/" }

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
  if ($AllowLan -or $Https) {
    Write-Host "-AllowLan and -Https need an elevated PowerShell window." -ForegroundColor Yellow
  }
  exit 1
}

Write-Host "Sight Reader is serving $Root" -ForegroundColor Green
Write-Host "  ${scheme}://localhost:$Port" -ForegroundColor Green
if ($Https -or $AllowLan) {
  $ip = Get-LanAddress
  if ($ip) { Write-Host "  ${scheme}://${ip}:$Port  <- open this on the tablet" -ForegroundColor Green }
}
if ($Https) {
  Write-Host "The tablet will warn about the certificate the first time:" -ForegroundColor Cyan
  Write-Host "  Safari: Show Details -> visit this website. Chrome: Advanced -> Proceed." -ForegroundColor Cyan
  Write-Host "After that the page counts as secure and can ask for the microphone." -ForegroundColor Cyan
} else {
  Write-Host "Microphone listening works on this computer (localhost). For the tablet," -ForegroundColor DarkGray
  Write-Host "restart with -Https -AllowLan in an elevated window." -ForegroundColor DarkGray
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
