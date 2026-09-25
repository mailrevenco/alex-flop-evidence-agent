$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$watcher = Join-Path $projectRoot "src\mailbox-watch.mjs"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = "FLOP Mailbox Responder"

if (-not (Test-Path -LiteralPath $watcher -PathType Leaf)) {
  throw "Mailbox watcher is missing."
}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  throw "Task already exists; inspect it before changing its action."
}

$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $watcher) -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State
