Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ManagedApi-Definition.ps1')
function Assert-True { param([bool]$Value,[string]$Message) if(-not $Value){throw $Message} }
function Expect-Failure { param($Value) $failed=$false;try{$null=Get-ManagedApiSwagger $Value 'azureblob'}catch{if($_.Exception.Message -notmatch 'export=true'){throw};$failed=$true};if(-not $failed){throw 'Invalid connector response was accepted.'} }
# The observed export is a root Swagger document. An ordinary metadata response
# has no paths; accepting it would generate incomplete Logic Apps definitions.
$document='{"swagger":"2.0","paths":{"/{connectionId}/files":{"get":{"operationId":"FixtureRead"}}},"parameters":{}}' | ConvertFrom-Json -Depth 20
$root=Get-ManagedApiSwagger $document 'azureblob'
Assert-True ([object]::ReferenceEquals($document,$root)) 'The complete exported root document must be retained.'
$wrapped=[pscustomobject]@{properties=[pscustomobject]@{apiDefinitions=[pscustomobject]@{value=$document}}}
Assert-True ([object]::ReferenceEquals($document,(Get-ManagedApiSwagger $wrapped 'azureblob'))) 'Inline resource definitions must be accepted.'
$legacy=[pscustomobject]@{properties=[pscustomobject]@{swagger=$document}}
Assert-True ([object]::ReferenceEquals($document,(Get-ManagedApiSwagger $legacy 'azureblob'))) 'Embedded Swagger must be accepted.'
Expect-Failure ('{"properties":{"capabilities":[],"connectionParameters":{},"runtimeUrls":[]}}' | ConvertFrom-Json)
Expect-Failure $null
Expect-Failure ('{"swagger":"2.0","paths":{}}' | ConvertFrom-Json)
Expect-Failure ('{"openapi":"3.0.0","paths":{"/files":{}}}' | ConvertFrom-Json)
Expect-Failure ('{"swagger":"2.0","paths":{"bad-path":{}}}' | ConvertFrom-Json)
Write-Output 'Managed API export checks passed. No Azure calls executed.'
