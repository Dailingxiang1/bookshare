param([string]$Destination)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path (Split-Path -Parent $projectRoot) 'output/azure' }
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
$stagingParent = Join-Path $projectRoot '.local/packages'
New-Item -ItemType Directory -Force -Path $stagingParent | Out-Null
$staging = Join-Path $stagingParent ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$functionFiles = @('host.json','server')
foreach ($file in $functionFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $staging -Recurse }
& node (Join-Path $projectRoot 'scripts/prepare-function-package.cjs') $staging
if ($LASTEXITCODE -ne 0) { throw 'Function package preparation failed.' }
$functionZip = Join-Path $destinationPath 'BookShare_Function.zip'
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $functionZip -Force
$sourceFiles = @('package.json','package-lock.json','host.json','.gitignore','azure-pipelines.yml','README.txt','web','server','scripts','infra','tests','docs')
$sourceStaging = Join-Path $stagingParent ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $sourceStaging | Out-Null
foreach ($file in $sourceFiles) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $sourceStaging -Recurse }
$sourceZip = Join-Path $destinationPath 'BookShare_CW2_Source.zip'
Compress-Archive -Path (Join-Path $sourceStaging '*') -DestinationPath $sourceZip -Force
Write-Host $sourceZip
Write-Host $functionZip
# Staging directories stay under ignored .local. No existing source or user data is deleted.
