# Registers the "OnlineChess" scheduled task: runs supervise-chess.ps1 at logon
# and every 5 minutes, so the server comes back after a crash or a restart.
#   powershell -ExecutionPolicy Bypass -File .\scripts\windows\register-task.ps1
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'supervise-chess.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$logon.Delay = 'PT30S'
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
# No run limit: a 72-hour limit would stop the task, and with it the check, mid-week.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'OnlineChess' -Action $action -Trigger $logon, $every5 -Settings $settings `
  -Description 'Keeps OnlineChess (onlinechess.preetbohra.com, port 3200) running.' -Force | Out-Null
Write-Output "Registered task OnlineChess -> $script"
