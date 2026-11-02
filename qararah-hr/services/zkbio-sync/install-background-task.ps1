$ErrorActionPreference = 'Stop'
$taskName = 'Qararah HR - ZKBio attendance sync'
$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $serviceDir '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Copy .env.example to .env and fill the ZKBio values first.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' }
$node = (Get-Command node -ErrorAction Stop).Source
$version = (& $node --version).Trim().TrimStart('v')
if ([version]$version -lt [version]'24.19.0') { throw "Node.js 24.19 or newer is required (found $version)." }

$mode = (Select-String -LiteralPath $envFile -Pattern '^\s*SYNC_MODE\s*=\s*(\S+)' | Select-Object -Last 1).Matches.Groups[1].Value
if ($mode -ne 'push') { throw 'Set SYNC_MODE=push only after a successful staging trial; installer refused to schedule dry-run mode.' }
& $node (Join-Path $serviceDir 'src/live-sync.ts') --validate-config
if ($LASTEXITCODE -ne 0) { throw 'Service configuration validation failed.' }

# Protect the machine token and ZKBio credentials from ordinary local accounts.
& icacls $envFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict .env permissions.' }

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$runner = Join-Path $serviceDir 'run-sync.ps1'
$escapedRunner = [Security.SecurityElement]::Escape($runner)
$escapedPowerShell = [Security.SecurityElement]::Escape($powershell)
$escapedWorkingDir = [Security.SecurityElement]::Escape($serviceDir)
$start = (Get-Date).AddMinutes(2).ToString('s')
$interval = [int]((Select-String -LiteralPath $envFile -Pattern '^\s*SYNC_INTERVAL_MINUTES\s*=\s*(\d+)' | Select-Object -Last 1).Matches.Groups[1].Value)
if ($interval -lt 1 -or $interval -gt 1440) { throw 'SYNC_INTERVAL_MINUTES must be between 1 and 1440.' }
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Read-only ZKBio Time attendance synchronization to the configured Supabase Edge Function.</Description><URI>\$taskName</URI></RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger>
    <TimeTrigger><Repetition><Interval>PT${interval}M</Interval><Duration>P3650D</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled></TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT10M</ExecutionTimeLimit><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><Priority>7</Priority></Settings>
  <Actions Context="Author"><Exec><Command>${escapedPowerShell}</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File &quot;${escapedRunner}&quot;</Arguments><WorkingDirectory>${escapedWorkingDir}</WorkingDirectory></Exec></Actions>
</Task>
"@
$tempXml = Join-Path $env:TEMP 'qararah-zkbio-sync-task.xml'
$xml | Set-Content -LiteralPath $tempXml -Encoding Unicode
try {
    Register-ScheduledTask -TaskName $taskName -Xml (Get-Content -LiteralPath $tempXml -Raw) -Force | Out-Null
} finally { Remove-Item -LiteralPath $tempXml -Force -ErrorAction SilentlyContinue }
Write-Host "Task installed: $taskName. First run is scheduled in about 2 minutes; interval is $interval minutes."
Write-Host "Logs: $(Join-Path $serviceDir 'logs')"
