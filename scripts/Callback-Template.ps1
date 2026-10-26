# listCallbackUrl returns value/basePath and relativePath separately in the
# Consumption API. Keep its signed query verbatim when appending the route.
function Get-CallbackField {
    param($Value,[string]$Name)
    if($null -eq $Value) { return $null }
    if($Value -is [System.Collections.IDictionary]) { return $Value[$Name] }
    $property=$Value.PSObject.Properties[$Name]
    if($null -ne $property) { return $property.Value }
    return $null
}
function New-BookShareCallbackTemplate {
    param(
        [Parameter(Mandatory)]$Callback,
        [Parameter(Mandatory)][ValidateSet('IUPS','RAI','RIPS','UIPS','DIPS','FIPS')][string]$Operation
    )
    $contracts=@{
        IUPS=@{method='POST';path='assets'}
        RAI=@{method='GET';path='assets'}
        RIPS=@{method='GET';path='assets/{id}'}
        UIPS=@{method='PUT';path='assets/{id}'}
        DIPS=@{method='DELETE';path='assets/{id}'}
        FIPS=@{method='GET';path='assets/{id}/file'}
    }
    $contract=$contracts[$Operation]
    $method=[string](Get-CallbackField $Callback 'method')
    $relativePath=[string](Get-CallbackField $Callback 'relativePath')
    $relativePath=[Uri]::UnescapeDataString($relativePath.Trim('/'))
    if($method -cne $contract.method -or $relativePath -cne $contract.path) { throw ('Unexpected trigger method or relativePath for '+$Operation+'. No callback URL was configured.') }
    $parameterNames=@(foreach($parameterName in (Get-CallbackField $Callback 'relativePathParameters')) { if($null -ne $parameterName) { [string]$parameterName } })
    $needsId=$contract.path.Contains('{id}')
    if(($needsId -and ($parameterNames.Count -ne 1 -or $parameterNames[0] -cne 'id')) -or (-not $needsId -and $parameterNames.Count -ne 0)) { throw ('Unexpected relativePathParameters for '+$Operation+'.') }
    $raw=[string](Get-CallbackField $Callback 'value')
    $base=[string](Get-CallbackField $Callback 'basePath')
    $valueUri=$null; $baseUri=$null
    foreach($uriText in @($raw,$base)) {
        $parsed=$null
        if(-not [Uri]::TryCreate($uriText,[UriKind]::Absolute,[ref]$parsed) -or $parsed.Scheme -ne 'https' -or $parsed.UserInfo -or $parsed.Fragment) { throw ('Invalid HTTPS callback metadata for '+$Operation+'.') }
    }
    $valueUri=[Uri]$raw; $baseUri=[Uri]$base
    if($valueUri.Authority -cne $baseUri.Authority -or $baseUri.Query) { throw ('Callback value/basePath mismatch for '+$Operation+'.') }
    $queryStart=$raw.IndexOf('?')
    if($queryStart -lt 0) { throw ('Missing signed callback query for '+$Operation+'.') }
    $query=$raw.Substring($queryStart)
    $queryKeys=@{}
    foreach($part in $query.Substring(1).Split('&')) {
        $separator=$part.IndexOf('=')
        if($separator -le 0 -or $separator -eq $part.Length-1) { throw ('Invalid signed callback query for '+$Operation+'.') }
        $key=[Uri]::UnescapeDataString($part.Substring(0,$separator))
        if($queryKeys.ContainsKey($key)) { throw ('Duplicate callback query field for '+$Operation+'.') }
        $queryKeys[$key]=$true
    }
    foreach($key in @('api-version','sp','sv','sig')) { if(-not $queryKeys.ContainsKey($key)) { throw ('Missing callback authentication field for '+$Operation+'.') } }
    $baseRoute=[Uri]::UnescapeDataString($baseUri.AbsolutePath).TrimEnd('/')
    $valueRoute=[Uri]::UnescapeDataString($valueUri.AbsolutePath).TrimEnd('/')
    $fullRoute=$baseRoute+'/'+$relativePath
    if($valueRoute -ceq $fullRoute) { return $raw }
    if($valueRoute -cne $baseRoute) { throw ('Unexpected callback value path for '+$Operation+'.') }
    return $raw.Substring(0,$queryStart).TrimEnd('/')+'/'+$relativePath+$query
}
