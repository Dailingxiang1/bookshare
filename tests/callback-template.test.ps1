Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/Callback-Template.ps1')
function Assert-True { param([bool]$Value,[string]$Message) if(-not $Value){throw $Message} }
function Expect-Failure { param($Callback,[string]$Operation,[string]$Pattern) $failed=$false;try{$null=New-BookShareCallbackTemplate $Callback $Operation}catch{if($_.Exception.Message -notmatch $Pattern){throw};if($_.Exception.Message -match 'fixture-signature'){throw 'A diagnostic exposed a signed URL.'};$failed=$true};if(-not $failed){throw 'Invalid callback was accepted.'} }
$base='https://fixture.invalid/workflows/fixture/triggers/manual/paths/invoke'
$query='?api-version=2016-10-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=fixture-signature%2B%2F%3D'
$cases=@(
    @('IUPS','POST','assets'),@('RAI','GET','assets'),
    @('RIPS','GET','assets/{id}'),@('UIPS','PUT','assets/{id}'),
    @('DIPS','DELETE','assets/{id}'),@('FIPS','GET','assets/{id}/file')
)
foreach($case in $cases) {
    $parameters=@();if($case[2].Contains('{id}')){$parameters=@('id')}
    $callback=[pscustomobject]@{value=$base+$query;basePath=$base;method=$case[1];relativePath=$case[2];relativePathParameters=$parameters}
    $result=New-BookShareCallbackTemplate $callback $case[0]
    Assert-True ($result -ceq ($base+'/'+$case[2]+$query)) ('Split callback metadata was not combined correctly for '+$case[0])
    Assert-True ($result.Substring($result.IndexOf('?')) -ceq $query) 'The original signed query must stay byte-for-byte intact.'
    # Complete callback values must be idempotent instead of duplicating assets.
    $callback.value=$result
    Assert-True ((New-BookShareCallbackTemplate $callback $case[0]) -ceq $result) 'Complete callback route was duplicated.'
    $callback.value=$result.Replace('{id}','%7Bid%7D')
    Assert-True ((New-BookShareCallbackTemplate $callback $case[0]) -ceq $callback.value) 'Encoded path placeholders must be retained.'
}
$sample=[pscustomobject]@{value=$base+$query;basePath=$base;method='GET';relativePath='assets/{id}';relativePathParameters=@('id')}
foreach($mutation in @(
    @{name='method';value='DELETE';pattern='method or relativePath'},
    @{name='relativePath';value='assets/{other}';pattern='method or relativePath'},
    @{name='relativePathParameters';value=@();pattern='relativePathParameters'},
    @{name='value';value=$base+'/unexpected'+$query;pattern='value path'},
    @{name='basePath';value=$base.Replace('fixture.invalid','other.invalid');pattern='mismatch'},
    @{name='value';value=$base.Replace('https:','http:')+$query;pattern='HTTPS'},
    @{name='value';value=$base+$query+'#fragment';pattern='HTTPS'},
    @{name='value';value=$base+'?api-version=2016-10-01&sp=scope&sv=1.0';pattern='authentication'},
    @{name='value';value=$base+$query+'&sig=duplicate';pattern='Duplicate'}
)) {
    $copy=$sample | ConvertTo-Json -Depth 10 | ConvertFrom-Json -Depth 10
    $copy.($mutation.name)=$mutation.value
    Expect-Failure $copy 'RIPS' $mutation.pattern
}
Write-Output 'Callback template checks passed: all six routes, split/full/encoded formats, signed query preservation and invalid metadata rejection. No Azure calls executed.'
