param([ValidateSet('Workflows','Publish','Verify')][string]$Stage='Workflows',[switch]$Apply)
. (Join-Path $PSScriptRoot 'Azure-Common.ps1')
. (Join-Path $PSScriptRoot 'Connection-Template.ps1')
$projectRoot=Get-ProjectRoot
if(-not (Test-Path -LiteralPath (Join-Path $projectRoot '.local/cloud/resources.json'))) {
    & (Join-Path $PSScriptRoot 'Inspect-CloudShell.ps1') -WorkspaceDirectory $projectRoot
}
$state=Read-CloudState
Assert-CloudAccount $state
if($state.resourceGroup -ne 'bookshare-coursework') { throw 'This package targets bookshare-coursework only.' }
$cloudDirectory=Join-Path $projectRoot '.local/cloud'
if($Stage -eq 'Workflows') {
    if(-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found in this Cloud Shell session.' }
    $metadata=@{}
    foreach($connector in @('azureblob','documentdb')) {
        $uri='/subscriptions/{0}/providers/Microsoft.Web/locations/{1}/managedApis/{2}?api-version=2016-06-01' -f $state.subscriptionId,$state.location,$connector
        $metadata[$connector]=Invoke-AzJson -Arguments @('rest','--method','get','--url',$uri)
    }
    $template=New-BookShareConnectionTemplate -State $state -BlobMetadata $metadata.azureblob -CosmosMetadata $metadata.documentdb
    $templatePath=Join-Path $cloudDirectory 'connections.generated.json'
    Write-PrivateJson -Path $templatePath -Value $template
    $blobName=$state.workflowPrefix+'-blob';$cosmosName=$state.workflowPrefix+'-cosmos'
    & (Join-Path $PSScriptRoot 'Configure-Workflows.ps1') -BlobConnectionName $blobName -CosmosConnectionName $cosmosName -PrepareOnly
    if(-not $?) { throw 'Workflow preparation failed.' }
    Write-Host ('Target: '+$state.resourceGroup+' / '+$state.location)
    Write-Host ('API connections: '+$blobName+', '+$cosmosName)
    Write-Host ('Workflows: '+$state.workflowPrefix+'-{iups,rai,rips,uips,dips,fips}')
    Write-Host 'Existing resources are reused. Azure resolves connector keys using listKeys expressions.'
    if(-not $Apply) { Write-Host 'Plan prepared. Add -Apply to create the two connections and six Consumption workflows.'; return }
    $provider=Invoke-AzJson -Arguments @('provider','show','--namespace','Microsoft.Logic')
    if($provider.registrationState -ne 'Registered') {
        Write-Host 'Registering Microsoft.Logic for this subscription...'
        $null=Invoke-AzJson -Arguments @('provider','register','--namespace','Microsoft.Logic','--wait')
    }
    $null=Invoke-AzJson -Arguments @('deployment','group','validate','--resource-group',$state.resourceGroup,'--template-file',$templatePath)
    Write-Host 'Creating two managed API connections...'
    $null=Invoke-AzJson -Arguments @('deployment','group','create','--resource-group',$state.resourceGroup,'--name','bookshare-connections','--template-file',$templatePath)
    $connectionStates=@()
    foreach($name in @($blobName,$cosmosName)) {
        $id='/subscriptions/{0}/resourceGroups/{1}/providers/Microsoft.Web/connections/{2}' -f $state.subscriptionId,$state.resourceGroup,$name
        $statuses=@()
        for($attempt=0;$attempt -lt 10;$attempt++) {
            $connection=Invoke-AzJson -Arguments @('rest','--method','get','--url',($id+'?api-version=2016-06-01'))
            $statuses=@((Get-ConnectionField $connection.properties 'statuses') | ForEach-Object { Get-ConnectionField $_ 'status' })
            if($statuses -contains 'Connected') { break }
            if($attempt -lt 9) { Start-Sleep -Seconds 2 }
        }
        $connectionStates+=@{name=$name;statuses=$statuses}
        if($statuses -notcontains 'Connected') {
            Write-Host ($connectionStates | ConvertTo-Json -Depth 10)
            throw ('Connection not confirmed Connected: '+$name+'. Check its Azure Portal status before deploying workflows.')
        }
    }
    $workflowPath=Join-Path $cloudDirectory 'workflows.generated.json'
    $null=Invoke-AzJson -Arguments @('deployment','group','validate','--resource-group',$state.resourceGroup,'--template-file',$workflowPath)
    Write-Host 'Deploying six Logic Apps workflows...'
    $null=Invoke-AzJson -Arguments @('deployment','group','create','--resource-group',$state.resourceGroup,'--name','bookshare-workflows','--template-file',$workflowPath)
    $actual=@()
    foreach($operation in @('iups','rai','rips','uips','dips','fips')) {
        $name=$state.workflowPrefix+'-'+$operation
        $id='/subscriptions/{0}/resourceGroups/{1}/providers/Microsoft.Logic/workflows/{2}' -f $state.subscriptionId,$state.resourceGroup,$name
        $workflow=Invoke-AzJson -Arguments @('rest','--method','get','--url',($id+'?api-version=2019-05-01'))
        if($workflow.properties.provisioningState -ne 'Succeeded') { throw ('Workflow provisioning incomplete: '+$name) }
        $actual+=@{name=$name;state=$workflow.properties.state;provisioningState=$workflow.properties.provisioningState}
    }
    Write-Host 'BOOKSHARE_WORKFLOWS_RESULT'
    [ordered]@{resourceGroup=$state.resourceGroup;location=$state.location;connections=$connectionStates;workflows=$actual;applicationCodePublished=$false;liveCrudVerified=$false} | ConvertTo-Json -Depth 15
} elseif($Stage -eq 'Publish') {
    & (Join-Path $PSScriptRoot 'Publish-Application.ps1') -FunctionZip (Join-Path $projectRoot 'BookShare_Function.zip') -SkipBuild -Apply:$Apply
} else {
    if(-not $Apply) { Write-Host 'Verify creates and deletes its own disposable guide and calls Translator. Add -Apply to run it.'; return }
    $tokenPath=Join-Path $cloudDirectory 'organiser-token.local.txt'
    if(-not (Test-Path -LiteralPath $tokenPath)) { throw 'Run the Publish stage first.' }
    $oldBase=[Environment]::GetEnvironmentVariable('BOOKSHARE_BASE_URL','Process')
    $oldToken=[Environment]::GetEnvironmentVariable('BOOKSHARE_WRITE_TOKEN','Process')
    try {
        $env:BOOKSHARE_BASE_URL=$state.apiOrigin
        $env:BOOKSHARE_WRITE_TOKEN=([System.IO.File]::ReadAllText($tokenPath)).Trim()
        & node (Join-Path $projectRoot 'scripts/smoke.cjs')
        if($LASTEXITCODE -ne 0) { throw 'Live verification failed. Inspect the error and workflow run history.' }
    } finally {
        [Environment]::SetEnvironmentVariable('BOOKSHARE_BASE_URL',$oldBase,'Process')
        [Environment]::SetEnvironmentVariable('BOOKSHARE_WRITE_TOKEN',$oldToken,'Process')
    }
}
