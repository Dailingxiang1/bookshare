# Azure's regional managedApis export endpoint can return Swagger directly or
# inside the API resource. These helpers only inspect data; they make no calls.
function Get-ManagedApiField {
    param($Value,[string]$Name)
    if($null -eq $Value) { return $null }
    if($Value -is [System.Collections.IDictionary]) { return $Value[$Name] }
    $property=$Value.PSObject.Properties[$Name]
    if($null -ne $property) { return $property.Value }
    return $null
}
function Get-ManagedApiSwagger {
    param($Response,[string]$ConnectorName)
    $properties=Get-ManagedApiField $Response 'properties'
    $definitions=Get-ManagedApiField $properties 'apiDefinitions'
    $candidates=@(
        $Response
        (Get-ManagedApiField $properties 'swagger')
        (Get-ManagedApiField $definitions 'value')
    )
    foreach($candidate in $candidates) {
        if((Get-ManagedApiField $candidate 'swagger') -ne '2.0') { continue }
        $paths=Get-ManagedApiField $candidate 'paths'
        $pathNames=@()
        if($paths -is [System.Collections.IDictionary]) { $pathNames=@($paths.Keys) }
        elseif($null -ne $paths) { $pathNames=@($paths.PSObject.Properties | ForEach-Object { $_.Name }) }
        if($pathNames.Count -gt 0 -and @($pathNames | Where-Object { $_ -notlike '/*' }).Count -eq 0) { return $candidate }
    }
    throw ('No non-empty Swagger 2.0 paths returned for '+$ConnectorName+'. The managedApis request must use export=true. No template was deployed.')
}
