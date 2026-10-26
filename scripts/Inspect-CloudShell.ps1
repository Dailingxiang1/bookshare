param(
    [string]$ResourceGroup = 'bookshare-coursework',
    [string]$SubscriptionId,
    [string]$WorkspaceDirectory = (Join-Path $HOME 'bookshare-deploy')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { throw 'Run this script in Azure Cloud Shell with PowerShell selected.' }

function Invoke-ReadAzJson {
    param([Parameter(Mandatory)][string[]]$CommandArguments)
    $result = & az @CommandArguments --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw ('Azure inspection failed: az ' + ($CommandArguments -join ' ')) }
    if (-not $result) { return $null }
    return (($result -join "`n") | ConvertFrom-Json -Depth 100)
}
function Read-Property {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}
function Property-Names {
    param($Object)
    if ($null -eq $Object) { return @() }
    return @($Object.PSObject.Properties | ForEach-Object { $_.Name })
}

# Select only the student's own subscription. This changes the CLI context,
# and does not create or modify an Azure resource.
if (-not $SubscriptionId) {
    $subscriptions = @(Invoke-ReadAzJson -CommandArguments @('account','list'))
    $students = @($subscriptions | Where-Object { $_.name -eq 'Azure for Students' -and $_.state -eq 'Enabled' })
    if ($students.Count -ne 1) { throw 'Expected one enabled Azure for Students subscription. Run again with -SubscriptionId for the intended student subscription.' }
    $SubscriptionId = $students[0].id
}
& az account set --subscription $SubscriptionId --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Could not select the student subscription.' }
$account = Invoke-ReadAzJson -CommandArguments @('account','show')
if ($account.id -ne $SubscriptionId) { throw 'Azure CLI is using a different subscription.' }

$deployments = @(Invoke-ReadAzJson -CommandArguments @('deployment','group','list','--resource-group',$ResourceGroup))
$succeeded = @($deployments | Where-Object { $_.properties.provisioningState -eq 'Succeeded' } | Sort-Object { $_.properties.timestamp } -Descending)
$deployment = $null
foreach ($candidate in $succeeded) {
    $item = Invoke-ReadAzJson -CommandArguments @('deployment','group','show','--resource-group',$ResourceGroup,'--name',$candidate.name)
    $outputs = Read-Property $item.properties 'outputs'
    if ((Read-Property $outputs 'storageName') -and (Read-Property $outputs 'cosmosName') -and (Read-Property $outputs 'functionName')) { $deployment = $item; break }
}
if (-not $deployment) { throw 'No successful BookShare resource deployment with the expected outputs was found in this resource group.' }
$state = [ordered]@{ subscriptionId=$SubscriptionId; resourceGroup=$ResourceGroup }
foreach ($name in @('storageName','cosmosName','functionName','translatorName','workflowPrefix','apiOrigin')) {
    $output = Read-Property $deployment.properties.outputs $name
    if (-not $output -or -not $output.value) { throw ('Missing deployment output: ' + $name) }
    $state[$name] = $output.value
}
$storage = Invoke-ReadAzJson -CommandArguments @('storage','account','show','--resource-group',$ResourceGroup,'--name',$state.storageName)
$state.location = $storage.location
$deployDirectory = [System.IO.Path]::GetFullPath($WorkspaceDirectory)
$cloudDirectory = Join-Path $deployDirectory '.local/cloud'
New-Item -ItemType Directory -Force -Path $cloudDirectory | Out-Null
$statePath = Join-Path $cloudDirectory 'resources.json'
[System.IO.File]::WriteAllText($statePath,($state | ConvertTo-Json -Depth 30),[System.Text.UTF8Encoding]::new($false))

# Return only connector parameter names. Never retrieve or print storage keys,
# Cosmos keys, workflow callback signatures or authentication tokens.
$schemas = [ordered]@{}
foreach ($connector in @('azureblob','documentdb')) {
    $uri = 'https://management.azure.com/subscriptions/{0}/providers/Microsoft.Web/locations/{1}/managedApis/{2}?api-version=2016-06-01' -f $SubscriptionId,$state.location,$connector
    $metadata = Invoke-ReadAzJson -CommandArguments @('rest','--method','get','--url',$uri)
    $setsObject = Read-Property $metadata.properties 'connectionParameterSets'
    $setSummaries = @()
    foreach ($set in @(Read-Property $setsObject 'values')) {
        if ($null -eq $set) { continue }
        $setSummaries += [ordered]@{ name=(Read-Property $set 'name'); parameters=@(Property-Names (Read-Property $set 'parameters')) }
    }
    $schemas[$connector] = [ordered]@{ legacyParameters=@(Property-Names (Read-Property $metadata.properties 'connectionParameters')); parameterSets=$setSummaries }
    [System.IO.File]::WriteAllText((Join-Path $cloudDirectory ($connector + '.managedapi.json')),($metadata | ConvertTo-Json -Depth 100),[System.Text.UTF8Encoding]::new($false))
}
$connections = @(Invoke-ReadAzJson -CommandArguments @('resource','list','--resource-group',$ResourceGroup,'--resource-type','Microsoft.Web/connections'))
$connectionSummary = @($connections | ForEach-Object { [ordered]@{name=$_.name;location=$_.location} })
Write-Output 'BOOKSHARE_INSPECTION_RESULT'
[ordered]@{ resourceGroup=$state.resourceGroup;location=$state.location;deployment=$deployment.name;storageName=$state.storageName;cosmosName=$state.cosmosName;functionName=$state.functionName;translatorName=$state.translatorName;workflowPrefix=$state.workflowPrefix;apiOrigin=$state.apiOrigin;connectorSchemas=$schemas;existingConnections=$connectionSummary;cloudResourcesChanged=$false } | ConvertTo-Json -Depth 20
Write-Output ('Saved non-secret deployment configuration: ' + $statePath)
