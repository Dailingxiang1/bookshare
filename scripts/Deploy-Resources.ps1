param(
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9._()-]+$')][string]$ResourceGroup,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]+$')][string]$Location,
    [ValidatePattern('^[a-z][a-z0-9]{2,9}$')][string]$Prefix = 'bookshare',
    [ValidateSet('F0','S1')][string]$TranslatorSku = 'F0',
    [switch]$Apply
)
. (Join-Path $PSScriptRoot 'Azure-Common.ps1')
$projectRoot = Get-ProjectRoot
$account = Invoke-AzJson -Arguments @('account','show')
$templatePath = Join-Path $projectRoot 'infra/main.json'
$templateParameters = @(('location=' + $Location), ('prefix=' + $Prefix), ('translatorSku=' + $TranslatorSku))
$existsResult = Invoke-AzJson -Arguments @('group','exists','--name',$ResourceGroup)
if (-not $existsResult) {
    if (-not $Apply) { throw 'The resource group does not exist. Review infra/main.json and the budget, then use -Apply to create this named project group.' }
    $null = Invoke-AzJson -Arguments @('group','create','--name',$ResourceGroup,'--location',$Location)
}
if (-not $Apply) {
    $null = Invoke-AzJson -Arguments (@('deployment','group','validate','--resource-group',$ResourceGroup,'--template-file',$templatePath,'--parameters') + $templateParameters)
    & az deployment group what-if --resource-group $ResourceGroup --template-file $templatePath --parameters @templateParameters --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw 'Azure what-if failed.' }
    Write-Host 'Validation / what-if completed. No resources were deployed by this run.'
    return
}
$deployment = Invoke-AzJson -Arguments (@('deployment','group','create','--resource-group',$ResourceGroup,'--name','bookshare-resources','--template-file',$templatePath,'--parameters') + $templateParameters)
$state = [ordered]@{ subscriptionId=$account.id; resourceGroup=$ResourceGroup; location=$Location }
foreach ($property in $deployment.properties.outputs.PSObject.Properties) { $state[$property.Name] = $property.Value.value }
Write-PrivateJson -Path (Join-Path $projectRoot '.local/cloud/resources.json') -Value $state
Write-Host 'Resources created. Next: create Blob and Cosmos DB API connections in Azure Portal, then run Configure-Workflows.ps1.'
Write-Host 'Set an Azure Cost Management budget alert for this resource group. Student credit does not make every resource free.'
