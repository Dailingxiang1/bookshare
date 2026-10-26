param(
    [Parameter(Mandatory)][string]$BlobConnectionName,
    [Parameter(Mandatory)][string]$CosmosConnectionName,
    [switch]$Apply,
    [switch]$PrepareOnly
)
if($PrepareOnly -and $Apply) { throw 'Choose -PrepareOnly or -Apply, not both.' }
. (Join-Path $PSScriptRoot 'Azure-Common.ps1')
. (Join-Path $PSScriptRoot 'ManagedApi-Definition.ps1')
$projectRoot = Get-ProjectRoot
$state = Read-CloudState
Assert-CloudAccount $state
$cloudDirectory = Join-Path $projectRoot '.local/cloud'
New-Item -ItemType Directory -Force -Path $cloudDirectory | Out-Null
$connections = @{}
foreach ($pair in @(@('azureblob',$BlobConnectionName), @('documentdb',$CosmosConnectionName))) {
    $connectorName = $pair[0]
    $connectionName = $pair[1]
    $connectionId = '/subscriptions/{0}/resourceGroups/{1}/providers/Microsoft.Web/connections/{2}' -f $state.subscriptionId,$state.resourceGroup,$connectionName
    if(-not $PrepareOnly) {
        $connection = Invoke-AzJson -Arguments @('rest','--method','get','--uri',($connectionId + '?api-version=2016-06-01'))
        if (-not $connection.properties.api.id.EndsWith('/' + $connectorName)) { throw ('Wrong connector type for ' + $connectionName) }
    }
    $connections[$connectorName] = $connectionId
    # Without export=true Azure returns authentication metadata, with no paths
    # or Swagger URL. The export response in France Central is a root document.
    $managedApiUri = '/subscriptions/{0}/providers/Microsoft.Web/locations/{1}/managedApis/{2}?api-version=2016-06-01&export=true' -f $state.subscriptionId,$state.location,$connectorName
    $export = Invoke-AzJson -Arguments @('rest','--method','get','--uri',$managedApiUri)
    $swagger = Get-ManagedApiSwagger -Response $export -ConnectorName $connectorName
    Write-PrivateJson -Path (Join-Path $cloudDirectory ($connectorName + '.swagger.json')) -Value $swagger
}
$config = [ordered]@{}
foreach ($property in $state.PSObject.Properties) { $config[$property.Name] = $property.Value }
$config.blobConnectionId = $connections.azureblob
$config.cosmosConnectionId = $connections.documentdb
$config.blobSwagger = 'azureblob.swagger.json'
$config.cosmosSwagger = 'documentdb.swagger.json'
$configPath = Join-Path $cloudDirectory 'workflows.config.json'
$workflowPath = Join-Path $cloudDirectory 'workflows.generated.json'
Write-PrivateJson -Path $configPath -Value $config
& node (Join-Path $projectRoot 'infra/workflow-factory.cjs') $configPath $workflowPath
if ($LASTEXITCODE -ne 0) { throw 'Workflow generation failed. No template was deployed.' }
if($PrepareOnly) { Write-Host ('Prepared workflow template from actual connector definitions: '+$workflowPath+'. No cloud resources changed.'); return }
$null = Invoke-AzJson -Arguments @('deployment','group','validate','--resource-group',$state.resourceGroup,'--template-file',$workflowPath)
if (-not $Apply) { Write-Host ('Validated generated workflows: ' + $workflowPath + '. Review it, then repeat with -Apply.'); return }
$null = Invoke-AzJson -Arguments @('deployment','group','create','--resource-group',$state.resourceGroup,'--name','bookshare-workflows','--template-file',$workflowPath)
Write-Host 'Six workflows deployed. Inspect API connection status and run histories before the cloud CRUD test.'
