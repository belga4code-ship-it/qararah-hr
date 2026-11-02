$ErrorActionPreference = 'Stop'
$taskName = 'Qararah HR - ZKBio attendance sync'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task: $taskName"
