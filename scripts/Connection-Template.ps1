# Constructs ARM configuration only. Azure resolves listKeys expressions.
function Get-ConnectionField {
    param($Object,[string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property=$Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}
function Get-ConnectionParameterDefault {
    param($Definition)
    $value=Get-ConnectionField $Definition 'defaultValue'
    if ($null -ne $value) { return $value }
    $constraints=Get-ConnectionField (Get-ConnectionField $Definition 'uiDefinition') 'constraints'
    $value=Get-ConnectionField $constraints 'defaultValue'
    if ($null -ne $value) { return $value }
    $allowed=@(Get-ConnectionField $constraints 'allowedValues')
    if ($allowed.Count -eq 1 -and $null -ne $allowed[0]) {
        if ($allowed[0] -is [string] -or $allowed[0] -is [bool]) { return $allowed[0] }
        return (Get-ConnectionField $allowed[0] 'value')
    }
    return $null
}
function New-BookShareConnectionTemplate {
    param([Parameter(Mandatory)]$State,[Parameter(Mandatory)]$BlobMetadata,[Parameter(Mandatory)]$CosmosMetadata)
    foreach($field in @('subscriptionId','resourceGroup','location','storageName','cosmosName','workflowPrefix')) {
        if (-not (Get-ConnectionField $State $field)) { throw ('Missing project setting: '+$field) }
    }
    $resources=@()
    foreach($pair in @(@('azureblob',$BlobMetadata,'blob'),@('documentdb',$CosmosMetadata,'cosmos'))) {
        $connector=$pair[0];$metadata=$pair[1];$suffix=$pair[2]
        $parameterSets=Get-ConnectionField (Get-ConnectionField $metadata.properties 'connectionParameterSets') 'values'
        $keySets=@($parameterSets | Where-Object { (Get-ConnectionField $_ 'name') -eq 'keyBasedAuth' })
        if ($keySets.Count -ne 1) { throw ('Expected one keyBasedAuth parameter set for '+$connector) }
        $definitions=Get-ConnectionField $keySets[0] 'parameters'
        $accountParameter=if($connector -eq 'azureblob'){'accountName'}else{'databaseAccount'}
        foreach($required in @('accessKey',$accountParameter)) {
            if ($null -eq (Get-ConnectionField $definitions $required)) { throw ('Missing connector parameter: '+$connector+'.'+$required) }
        }
        $values=[ordered]@{}
        if($connector -eq 'azureblob') {
            $values.accountName=@{value="[concat('https://', parameters('storageName'), '.blob.core.windows.net/')]"}
            $values.accessKey=@{value="[listKeys(resourceId('Microsoft.Storage/storageAccounts', parameters('storageName')), '2023-05-01').keys[0].value]"}
        } else {
            $values.databaseAccount=@{value="[parameters('cosmosName')]"}
            $values.accessKey=@{value="[listKeys(resourceId('Microsoft.DocumentDB/databaseAccounts', parameters('cosmosName')), '2024-05-15').primaryMasterKey]"}
        }
        if($null -ne (Get-ConnectionField $definitions 'authType')) {
            $authDefault=Get-ConnectionParameterDefault (Get-ConnectionField $definitions 'authType')
            if($null -eq $authDefault) { $authDefault='AccessKey' }
            if($authDefault -ne 'AccessKey') { throw ('Unexpected key authentication type for '+$connector) }
            $values.authType=@{value=$authDefault}
        }
        foreach($entry in $definitions.PSObject.Properties) {
            if($values.Contains($entry.Name)) { continue }
            $constraints=Get-ConnectionField (Get-ConnectionField $entry.Value 'uiDefinition') 'constraints'
            $required=Get-ConnectionField $constraints 'required'
            if($required -eq $true -or $required -eq 'true') {
                $default=Get-ConnectionParameterDefault $entry.Value
                if($null -eq $default) { throw ('No safe value for required connector parameter: '+$connector+'.'+$entry.Name) }
                $values[$entry.Name]=@{value=$default}
            }
        }
        $resources+=@{
            type='Microsoft.Web/connections';apiVersion='2016-06-01';kind='V1';name=($State.workflowPrefix+'-'+$suffix);location=$State.location
            properties=@{displayName=('BookShare '+$suffix);api=@{id=('/subscriptions/{0}/providers/Microsoft.Web/locations/{1}/managedApis/{2}' -f $State.subscriptionId,$State.location,$connector)};parameterValueSet=@{name='keyBasedAuth';values=$values}}
        }
    }
    return [ordered]@{
        '$schema'='https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#';contentVersion='1.0.0.0'
        parameters=@{storageName=@{type='string';defaultValue=$State.storageName};cosmosName=@{type='string';defaultValue=$State.cosmosName}}
        resources=$resources
    }
}
