param([int]$Port=7073)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$nodeCommand=Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Install Node.js 22.13 or later, then run npm ci in this project.' }
Push-Location -LiteralPath $projectRoot
try {
    & $nodeCommand.Source scripts/prepare-vendor.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Run npm ci to prepare dependencies.' }
    $env:PORT=[string]$Port
    Write-Host ('Open http://127.0.0.1:'+$Port+' in your browser. Keep this terminal open while using BookShare.')
    & $nodeCommand.Source server/local.cjs
} finally { Pop-Location }
