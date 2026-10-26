Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-AzJson {
    param([Parameter(Mandatory)][string[]]$Arguments)
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Azure CLI is required. Use Azure Cloud Shell (PowerShell), or install the official Azure CLI. See docs/Account-and-Deployment.html.' }
    $azOutput = & az @Arguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw 'Azure CLI failed. Review its error and the selected subscription before continuing.' }
    if ($azOutput) { return (($azOutput -join "`n") | ConvertFrom-Json) }
}
function Write-PrivateJson {
    param([string]$Path, $Value)
    $parentPath = Split-Path -Parent $Path
    if ($parentPath) { New-Item -ItemType Directory -Force -Path $parentPath | Out-Null }
    $jsonText = ConvertTo-Json -InputObject $Value -Depth 100
    [System.IO.File]::WriteAllText($Path, $jsonText, [System.Text.UTF8Encoding]::new($false))
}
function Get-ProjectRoot { return (Split-Path -Parent $PSScriptRoot) }
function Read-CloudState {
    $statePath = Join-Path (Get-ProjectRoot) '.local/cloud/resources.json'
    if (-not (Test-Path -LiteralPath $statePath)) { throw 'Run Deploy-Resources.ps1 -Apply first, then create the two API connections described in the guide.' }
    return (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json)
}
function Assert-CloudAccount {
    param($State)
    $currentAccount = Invoke-AzJson -Arguments @('account', 'show')
    if ($currentAccount.id -ne $State.subscriptionId) { throw 'The active Azure subscription differs from the saved project subscription. Select the correct account before proceeding.' }
}
