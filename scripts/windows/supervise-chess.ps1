<#
.SYNOPSIS
  Makes sure OnlineChess is up on this Windows PC, starting it only if it isn't.

.DESCRIPTION
  Run by the "OnlineChess" scheduled task at logon and every 5 minutes
  (register it once with .\scripts\windows\register-task.ps1). Safe to run by
  hand: a running server is left alone and nothing is stopped.

    Live checkout   %USERPROFILE%\.jodhpur-studio\apps\onlinechess, a detached
                    git worktree of main (see docs/DEPLOY.md)
    Server          node server/index.js on 127.0.0.1:3200
    Public address  https://onlinechess.preetbohra.com, through the shared
                    Cloudflare tunnel "applyai" (~/.cloudflared/config.yml).
                    MemoryTimeline's supervisor keeps that tunnel running.

  Status: %USERPROFILE%\.jodhpur-studio\logs\chess\status.txt
  Events (started or failed): %USERPROFILE%\.jodhpur-studio\logs\chess\supervisor.log
  Server output: chess.log and chess.err.log in the same folder.
#>

[CmdletBinding()]
param(
  [string]$Live = (Join-Path $env:USERPROFILE '.jodhpur-studio\apps\onlinechess'),
  [int]$Port = 3200,
  [string]$PublicHost = 'onlinechess.preetbohra.com'
)

$ErrorActionPreference = 'Stop'
$logs = Join-Path $env:USERPROFILE '.jodhpur-studio\logs\chess'
New-Item -ItemType Directory -Force $logs | Out-Null

function Write-Status($state, $detail = '') {
  $stamp = Get-Date -Format 'u'
  $line = '{0,-16} {1,-8} {2}' -f "server :$Port", $state, $detail
  [System.IO.File]::WriteAllText("$logs\status.txt", "$stamp`r`n$line`r`n", [System.Text.UTF8Encoding]::new($false))
  if ($state -in 'STARTED', 'FAILED') { Add-Content -Path "$logs\supervisor.log" -Value "$stamp  $line" -Encoding utf8 }
  Write-Output $line
}

# The weekly reboot (TallyDocumentTranslator\scripts\weekly-reboot.ps1) writes an
# expiring marker before it shuts things down; stand down so nothing restarts mid-shutdown.
# A marker from before the last boot is ignored: the reboot it announced is already over.
$rebootMarker = 'C:\Users\preet\Desktop\Repositories\TallyDocumentTranslator\logs\reboot.pending'
if ((Test-Path $rebootMarker) -and (Get-Item $rebootMarker).LastWriteTime -gt (Get-CimInstance Win32_OperatingSystem).LastBootUpTime) {
  try { $until = [datetime]::Parse((Get-Content $rebootMarker -Raw).Trim()) } catch { $until = Get-Date }
  if ((Get-Date) -lt $until) { Write-Status 'WAITING' "reboot pending until $until"; exit 0 }
}

$isUp = { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }

if (& $isUp) { Write-Status 'OK'; exit 0 }
if (-not (Test-Path "$Live\node_modules\ws")) { Write-Status 'FAILED' "no live checkout with dependencies at $Live"; exit 1 }

# Start-Process passes this environment on to the server.
$env:PORT = "$Port"
$env:HOST = '127.0.0.1'
$env:ALLOWED_HOSTS = $PublicHost
$env:PUBLIC_ORIGIN = "https://$PublicHost"
Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' `
  -WorkingDirectory $Live -WindowStyle Hidden `
  -RedirectStandardOutput "$logs\chess.log" -RedirectStandardError "$logs\chess.err.log"
for ($i = 0; $i -lt 20 -and -not (& $isUp); $i++) { Start-Sleep -Seconds 1 }
if (& $isUp) { Write-Status 'STARTED'; exit 0 }
Write-Status 'FAILED' "see $logs\chess.err.log"
exit 1
