$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactDir = Join-Path $repo 'deliverables'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$archive = Join-Path $artifactDir 'qararah-zkbio-sync-windows-v0.2.2-2026-10-31.zip'
if (Test-Path -LiteralPath $archive) { throw "Refusing to overwrite existing archive: $archive" }
$stage = Join-Path $env:TEMP ('qararah-zkbio-package-' + [guid]::NewGuid().ToString('N'))
$root = Join-Path $stage 'qararah-zkbio-sync'
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'services'), (Join-Path $root 'supabase/migrations'), (Join-Path $root 'supabase/functions/zkbio-attendance-ingest') | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'services/zkbio-sync') -Destination (Join-Path $root 'services/zkbio-sync') -Recurse
    $demoState = Join-Path $root 'services/zkbio-sync/state/demo-state.json'
    if (Test-Path -LiteralPath $demoState) { Remove-Item -LiteralPath $demoState -Force }
    Get-ChildItem -LiteralPath (Join-Path $root 'services/zkbio-sync') -Filter '.env' -Recurse -File | Remove-Item -Force
    Copy-Item -LiteralPath (Join-Path $repo 'supabase/config.toml') -Destination (Join-Path $root 'supabase/config.toml')
    Copy-Item -LiteralPath (Join-Path $repo 'supabase/migrations/20261031_zkbio_attendance_ingest.sql') -Destination (Join-Path $root 'supabase/migrations/20261031_zkbio_attendance_ingest.sql')
    Copy-Item -LiteralPath (Join-Path $repo 'supabase/functions/zkbio-attendance-ingest/index.ts') -Destination (Join-Path $root 'supabase/functions/zkbio-attendance-ingest/index.ts')
    if (Get-ChildItem -LiteralPath $root -Filter '.env' -Recurse -File) { throw 'A .env file must never be packaged.' }
    Compress-Archive -Path (Join-Path $root '*') -DestinationPath $archive -CompressionLevel Optimal
    Get-Item -LiteralPath $archive | Select-Object FullName, Length
}
finally {
    $tempRoot = (Resolve-Path $env:TEMP).Path.TrimEnd('\') + '\'
    if ($stage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
