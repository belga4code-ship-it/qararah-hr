$ErrorActionPreference = 'Stop'
$serviceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$logDir = Join-Path $serviceDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$stamp] Sync started" | Add-Content -LiteralPath (Join-Path $logDir 'sync.log') -Encoding UTF8
Push-Location $serviceDir
try {
    & $node 'src/live-sync.ts' 2>&1 | Out-File -FilePath (Join-Path $logDir 'sync.log') -Append -Encoding utf8
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Sync exited with code $exitCode" | Add-Content -LiteralPath (Join-Path $logDir 'sync-error.log') -Encoding UTF8 }
    exit $exitCode
}
catch {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Runner failed: $($_.Exception.Message)" | Add-Content -LiteralPath (Join-Path $logDir 'sync-error.log') -Encoding UTF8
    exit 1
}
finally { Pop-Location }
