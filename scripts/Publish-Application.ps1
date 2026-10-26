param([Parameter(Mandatory)][string]$FunctionZip, [switch]$Apply, [switch]$SkipBuild)
. (Join-Path $PSScriptRoot 'Azure-Common.ps1')
. (Join-Path $PSScriptRoot 'Callback-Template.ps1')
$projectRoot = Get-ProjectRoot
$state = Read-CloudState
Assert-CloudAccount $state
if (-not (Test-Path -LiteralPath $FunctionZip -PathType Leaf)) { throw 'Create BookShare_Function.zip using scripts/Package.ps1, then pass its path.' }
if($SkipBuild) {
    foreach($file in @('dist/index.html','dist/app.js','dist/styles.css','dist/config.js','dist/vendor/pdf.mjs','dist/vendor/pdf.worker.mjs')) {
        if(-not (Test-Path -LiteralPath (Join-Path $projectRoot $file) -PathType Leaf)) { throw ('Missing prebuilt website file: '+$file) }
    }
}
if (-not $Apply) {
    Write-Host ('Target resource group: ' + $state.resourceGroup)
    Write-Host ('Function package: ' + [System.IO.Path]::GetFullPath($FunctionZip))
    Write-Host ('Static output: ' + (Join-Path $projectRoot 'dist'))
    Write-Host 'This command enables static website hosting, publishes the website including PDF.js, installs callback URLs and Translator credentials in Function settings, and deploys the Function package.'
    Write-Host 'Review the target and run with -Apply when ready.'
    return
}
$cloudDirectory = Join-Path $projectRoot '.local/cloud'
$callbackSettings = [ordered]@{}
foreach ($operation in @('IUPS','RAI','RIPS','UIPS','DIPS','FIPS')) {
    $workflowName = $state.workflowPrefix + '-' + $operation.ToLowerInvariant()
    $callbackUri = '/subscriptions/{0}/resourceGroups/{1}/providers/Microsoft.Logic/workflows/{2}/triggers/manual/listCallbackUrl?api-version=2016-06-01' -f $state.subscriptionId,$state.resourceGroup,$workflowName
    $callback = Invoke-AzJson -Arguments @('rest','--method','post','--uri',$callbackUri)
    $callbackSettings['WORKFLOW_' + $operation + '_URL'] = New-BookShareCallbackTemplate -Callback $callback -Operation $operation
}
Write-Host 'Validated six callback routes and preserved their signed queries. Callback URLs are kept private.'
$storageKeys = Invoke-AzJson -Arguments @('storage','account','keys','list','--account-name',$state.storageName,'--resource-group',$state.resourceGroup)
$savedStorageKey = [Environment]::GetEnvironmentVariable('AZURE_STORAGE_KEY','Process')
try {
    $env:AZURE_STORAGE_KEY = $storageKeys[0].value
    $null = Invoke-AzJson -Arguments @('storage','blob','service-properties','update','--account-name',$state.storageName,'--static-website','--index-document','index.html','--404-document','index.html')
    $storage = Invoke-AzJson -Arguments @('storage','account','show','--name',$state.storageName,'--resource-group',$state.resourceGroup)
    $siteOrigin = $storage.primaryEndpoints.web.TrimEnd('/')
    $settings = [ordered]@{ALLOWED_ORIGINS=$siteOrigin; AZURE_TRANSLATOR_REGION=$state.location}
    $translatorKeys = Invoke-AzJson -Arguments @('cognitiveservices','account','keys','list','--name',$state.translatorName,'--resource-group',$state.resourceGroup)
    $settings.AZURE_TRANSLATOR_KEY = $translatorKeys.key1
    $existingSettings = Invoke-AzJson -Arguments @('functionapp','config','appsettings','list','--name',$state.functionName,'--resource-group',$state.resourceGroup)
    $existingToken = @($existingSettings | Where-Object { $_.name -eq 'WRITE_TOKEN' })
    if ($existingToken.Count -gt 0 -and $existingToken[0].value.Length -ge 24) { $settings.WRITE_TOKEN = $existingToken[0].value }
    else { $settings.WRITE_TOKEN = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N') }
    foreach ($settingName in $callbackSettings.Keys) { $settings[$settingName] = $callbackSettings[$settingName] }
    $settingsPath = Join-Path $cloudDirectory 'function-settings.local.json'
    Write-PrivateJson -Path $settingsPath -Value $settings
    $null = Invoke-AzJson -Arguments @('functionapp','config','appsettings','set','--name',$state.functionName,'--resource-group',$state.resourceGroup,'--settings',('@'+$settingsPath))
    $null = Invoke-AzJson -Arguments @('functionapp','deployment','source','config-zip','--name',$state.functionName,'--resource-group',$state.resourceGroup,'--src',[System.IO.Path]::GetFullPath($FunctionZip),'--build-remote','true')
    if(-not $SkipBuild) {
        & node (Join-Path $projectRoot 'scripts/build.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Website build failed.' }
    }
    $siteConfig = 'window.BOOKSHARE_CONFIG = Object.freeze(' + (@{apiBase=$state.apiOrigin} | ConvertTo-Json -Compress) + ');'
    [System.IO.File]::WriteAllText((Join-Path $projectRoot 'dist/config.js'),$siteConfig,[System.Text.UTF8Encoding]::new($false))
    $null = Invoke-AzJson -Arguments @('storage','blob','upload-batch','--account-name',$state.storageName,'--destination','$web','--source',(Join-Path $projectRoot 'dist'),'--overwrite','true')
    $secretNote = Join-Path $cloudDirectory 'organiser-token.local.txt'
    [System.IO.File]::WriteAllText($secretNote,$settings.WRITE_TOKEN,[System.Text.UTF8Encoding]::new($false))
    Write-Host ('Website: ' + $siteOrigin)
    Write-Host ('API: ' + $state.apiOrigin + '/api/health')
    Write-Host ('Read the management token locally from ' + $secretNote + '. Do not publish it or show it in the video.')
    Write-Host 'Deployment commands completed. Live CRUD, previews, translation and the GitHub/Pipelines build still require verification.'
} finally { [Environment]::SetEnvironmentVariable('AZURE_STORAGE_KEY',$savedStorageKey,'Process') }
