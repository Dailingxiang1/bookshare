Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/Connection-Template.ps1')
function Assert-True { param([bool]$Value,[string]$Message) if(-not $Value){throw $Message} }
function Expect-Failure { param([scriptblock]$Work,[string]$Pattern) $failed=$false;try{&$Work}catch{if($_.Exception.Message -notmatch $Pattern){throw};$failed=$true};if(-not $failed){throw 'Expected template construction to fail.'} }
$state=[pscustomobject]@{subscriptionId='11111111-1111-4111-8111-111111111111';resourceGroup='bookshare-coursework';location='francecentral';storageName='samplebookshare';cosmosName='sample-cosmos';workflowPrefix='sample-bookshare'}
$blob='{"properties":{"connectionParameterSets":{"values":[{"name":"managedIdentityAuth","parameters":{"token":{"type":"oauthSetting"}}},{"name":"keyBasedAuth","parameters":{"accessKey":{"type":"securestring"},"accountName":{"type":"string"},"authType":{"type":"string","defaultValue":"AccessKey"},"privacySetting":{"type":"string","uiDefinition":{"constraints":{"required":false}}}}}]}}}' | ConvertFrom-Json -Depth 30
$cosmos='{"properties":{"connectionParameterSets":{"values":[{"name":"keyBasedAuth","parameters":{"accessKey":{"type":"securestring"},"databaseAccount":{"type":"string"}}}]}}}' | ConvertFrom-Json -Depth 30
$plan=New-BookShareConnectionTemplate $state $blob $cosmos
Assert-True ($plan.resources.Count -eq 2) 'Expected exactly two connections.'
$b=$plan.resources[0];$c=$plan.resources[1]
Assert-True ($b.name -eq 'sample-bookshare-blob') 'Connection name must use the project prefix.'
Assert-True ($b.kind -eq 'V1' -and $c.kind -eq 'V1') 'Connections must target Consumption workflows.'
Assert-True ($b.properties.parameterValueSet.name -eq 'keyBasedAuth') 'Only keyBasedAuth is selected.'
Assert-True ($b.properties.parameterValueSet.values.accountName.value -match "https://.*blob.core.windows.net/") 'Blob V2 requires a full HTTPS endpoint.'
Assert-True ($b.properties.parameterValueSet.values.accessKey.value -match '^\[listKeys\(') 'Storage key must be resolved by Azure.'
Assert-True ($c.properties.parameterValueSet.values.accessKey.value -match 'primaryMasterKey\]$') 'Cosmos key must use Azure listKeys.'
Assert-True (-not $b.properties.parameterValueSet.values.Contains('token')) 'OAuth client credentials must not be added.'
Assert-True (-not $b.properties.parameterValueSet.values.Contains('privacySetting')) 'Optional privacy setting must stay at its default.'
$required=($blob | ConvertTo-Json -Depth 30 | ConvertFrom-Json -Depth 30)
$required.properties.connectionParameterSets.values[1].parameters | Add-Member -NotePropertyName unknownMandatory -NotePropertyValue ([pscustomobject]@{type='string';uiDefinition=[pscustomobject]@{constraints=[pscustomobject]@{required=$true}}})
Expect-Failure { New-BookShareConnectionTemplate $state $required $cosmos } 'unknownMandatory'
$wrong=($blob | ConvertTo-Json -Depth 30 | ConvertFrom-Json -Depth 30)
$wrong.properties.connectionParameterSets.values[1].parameters.authType.defaultValue='OAuth'
Expect-Failure { New-BookShareConnectionTemplate $state $wrong $cosmos } 'Unexpected key authentication'
Expect-Failure { New-BookShareConnectionTemplate $state ([pscustomobject]@{properties=[pscustomobject]@{}}) $cosmos } 'Expected one keyBasedAuth'
Write-Output 'Connection template checks passed. No Azure calls executed.'
