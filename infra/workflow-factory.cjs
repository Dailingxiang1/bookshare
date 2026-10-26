'use strict';
// Managed connector routes come from the live Managed API Swagger, not guessed URLs.
// No storage or Cosmos SDK bypasses the Logic Apps coursework CRUD layer.
const fs=require('node:fs/promises');
const path=require('node:path');
function operation(swagger,id){
  const matches=[];
  for(const [route,methods] of Object.entries(swagger.paths||{}))for(const [method,spec] of Object.entries(methods))if(spec&&spec.operationId===id)matches.push({route,method,spec,shared:methods.parameters||[]});
  if(matches.length!==1)throw new Error('Expected one connector operation '+id+'; found '+matches.length+'. Check the downloaded connector metadata.');
  return matches[0];
}
function resolveParameter(swagger,parameter){
  if(!parameter.$ref)return parameter;
  const prefix='#/parameters/';if(!parameter.$ref.startsWith(prefix))throw new Error('Unsupported external Swagger parameter.');
  const resolved=swagger.parameters?.[parameter.$ref.slice(prefix.length)];if(!resolved)throw new Error('Unresolved connector parameter.');return resolved;
}
function expr(value){return typeof value==='string'&&value.startsWith('@')?value.slice(1):"'"+String(value).replaceAll("'","''")+"'";}
function connectorAction(swagger,connection,id,values={},runAfter={}){
  const op=operation(swagger,id);const connectionPrefix=op.route.startsWith('/{connectionId}/')||op.route==='/{connectionId}';
  // Exported connector routes include a connectionId supplied by inputs.host.
  // Remove that exact transport prefix, keeping every operation path intact.
  let route=connectionPrefix?op.route.slice('/{connectionId}'.length)||'/':op.route;const inputs={host:{connection:{name:`@parameters('$connections')['${connection}']['connectionId']`}},method:op.method.toUpperCase(),path:'',retryPolicy:{type:'none'}};
  const params=[...op.shared,...op.spec.parameters||[]].map(p=>resolveParameter(swagger,p));
  for(const param of params){
    if(connectionPrefix&&param.in==='path'&&param.name==='connectionId')continue;
    const value=values[param.name];
    if(value===undefined){if(param.required)throw new Error('No value for required parameter '+id+'.'+param.name);continue;}
    if(param.in==='path'){
      const escaped=param['x-ms-url-encoding']==='single'?`encodeURIComponent(${expr(value)})`:`encodeURIComponent(encodeURIComponent(${expr(value)}))`;
      route=route.replaceAll('{'+param.name+'}','@{'+escaped+'}');
    }else if(param.in==='query') (inputs.queries??={})[param.name]=value;
    else if(param.in==='header') (inputs.headers??={})[param.name]=value;
    else if(param.in==='body')inputs.body=value;
  }
  if(/\{(?!@)[\w-]+\}/u.test(route.replace(/@\{[^}]+\}/gu,'')))throw new Error('Unresolved connector route for '+id);
  // Several Swagger versions omit Content-Type as a parameter. It remains a valid connector header.
  if(values['Content-Type']) (inputs.headers??={})['Content-Type']=values['Content-Type'];
  inputs.path=route;
  return {type:'ApiConnection',inputs,runAfter};
}
const ok=name=>({[name]:['Succeeded']});
function response(code,body,runAfter={}){return {type:'Response',kind:'Http',inputs:{statusCode:code,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body})},runAfter};}
function makeWorkflows(config,cosmosSwagger,blobSwagger){
  for(const name of ['subscriptionId','resourceGroup','location','storageName','cosmosName','workflowPrefix','blobConnectionId','cosmosConnectionId'])if(!config[name])throw new Error('Missing workflow config: '+name);
  const dbBase={cosmosDbAccountName:config.cosmosName,databaseId:'bookshare',collectionId:'assets'};
  const requestId="@triggerOutputs()['relativePathParameters']['id']";
  const partition=id=>`@concat('"', ${id.slice(1)}, '"')`;
  const db=(id,values={},after={})=>connectorAction(cosmosSwagger,'documentdb',id,{...dbBase,...values},after);
  const blob=(id,values={},after={})=>connectorAction(blobSwagger,'azureblob',id,{dataset:`https://${config.storageName}.blob.core.windows.net/`,...values},after);
  const getDoc=()=>db('GetDocument_V2',{documentId:requestId,'x-ms-documentdb-raw-partitionkey':partition(requestId)});
  const blobId="@body('Get_document')?['file']?['blobId']";
  const connections={};
  for(const [api,connectionId] of [['documentdb',config.cosmosConnectionId],['azureblob',config.blobConnectionId]])connections[api]={connectionId,connectionName:connectionId.split('/').pop(),id:`/subscriptions/${config.subscriptionId}/providers/Microsoft.Web/locations/${config.location}/managedApis/${api}`};
  function workflow(code,method,relativePath,actions,create=false){
    const schema={type:'object',properties:{asset:{type:'object',required:['id','file','title','bookTitle','creatorName','rights','createdAt','updatedAt']},...(create?{dataBase64:{type:'string'}}:{})},required:['asset',...(create?['dataBase64']:[])]};
    const failure=code==='IUPS'?503:"@if(equals(outputs('Get_document')?['statusCode'], 404), 404, 503)";
    const catchActions={};
    if(create){
      catchActions.Rollback_if_created={type:'If',expression:"@not(empty(body('Create_blob')?['Id']))",actions:{Delete_orphan:blob('DeleteFile_V2',{id:"@body('Create_blob')?['Id']"})},else:{actions:{}},runAfter:{}};
    }
    catchActions.Error_response=response(failure,{error:{code:'workflow_failed',message:'The requested workflow could not complete.'}},create?{Rollback_if_created:['Succeeded','Failed','TimedOut']}:{});
    // RAI has no Get_document action, so its failure code must be a literal.
    if(code==='RAI')catchActions.Error_response.inputs.statusCode=503;
    return {
      type:'Microsoft.Logic/workflows',apiVersion:'2019-05-01',name:config.workflowPrefix+'-'+code.toLowerCase(),location:config.location,
      properties:{state:'Enabled',parameters:{$connections:{value:connections}},definition:{
        $schema:'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',contentVersion:'1.0.0.0',parameters:{$connections:{type:'Object',defaultValue:{}}},
        triggers:{manual:{type:'Request',kind:'Http',inputs:{method,relativePath,...(['POST','PUT'].includes(method)?{schema}:{})}}},
        actions:{Try:{type:'Scope',actions,runAfter:{}},Catch:{type:'Scope',actions:catchActions,runAfter:{Try:['Failed','TimedOut']}}},outputs:{}
      }}
    };
  }
  const upload={
    Create_blob:blob('CreateFile_V2',{folderPath:'/assets',name:"@triggerBody()?['asset']?['file']?['blobName']",body:"@base64ToBinary(triggerBody()?['dataBase64'])",'Content-Type':"@triggerBody()?['asset']?['file']?['contentType']"}),
    Asset_with_blob:{type:'Compose',inputs:"@setProperty(triggerBody()?['asset'], 'file', setProperty(triggerBody()?['asset']?['file'], 'blobId', body('Create_blob')?['Id']))",runAfter:ok('Create_blob')},
    Create_document:db('CreateDocument_V3',{body:"@outputs('Asset_with_blob')",document:"@outputs('Asset_with_blob')",'x-ms-documentdb-is-upsert':false,'x-ms-documentdb-raw-partitionkey':partition("@triggerBody()?['asset']?['id']")},ok('Asset_with_blob')),
    Success_response:response(201,{asset:"@outputs('Asset_with_blob')"},ok('Create_document'))
  };
  const list={
    Get_documents:db('GetDocuments_V3',{'x-ms-max-item-count':100,'x-ms-continuation':"@coalesce(triggerOutputs()?['queries']?['continuation'], '')"}),
    Success_response:response(200,{items:"@coalesce(body('Get_documents')?['Documents'], body('Get_documents')?['documents'], body('Get_documents')?['value'], json('[]'))",continuation:"@coalesce(outputs('Get_documents')?['headers']?['x-ms-continuation'], outputs('Get_documents')?['headers']?['X-MS-Continuation'], body('Get_documents')?['ContinuationToken'], '')"},ok('Get_documents'))
  };
  const read={Get_document:getDoc(),Success_response:response(200,{asset:"@body('Get_document')"},ok('Get_document'))};
  const update={Get_document:getDoc(),Replace_document:db('ReplaceDocument_V2',{documentId:requestId,'x-ms-documentdb-raw-partitionkey':partition(requestId),body:"@triggerBody()?['asset']",document:"@triggerBody()?['asset']"},ok('Get_document')),Success_response:response(200,{asset:"@triggerBody()?['asset']"},ok('Replace_document'))};
  const remove={Get_document:getDoc(),Delete_document:db('DeleteDocument_V2',{documentId:requestId,'x-ms-documentdb-raw-partitionkey':partition(requestId)},ok('Get_document')),Delete_blob:blob('DeleteFile_V2',{id:blobId},ok('Delete_document')),Success_response:response(204,undefined,ok('Delete_blob'))};
  const file={Get_document:getDoc(),Get_blob:blob('GetFileContent_V2',{id:blobId,inferContentType:true},ok('Get_document')),Success_response:{type:'Response',kind:'Http',inputs:{statusCode:200,headers:{'Content-Type':"@body('Get_document')?['file']?['contentType']"},body:"@body('Get_blob')"},runAfter:ok('Get_blob')}};
  const resources=[workflow('IUPS','POST','assets',upload,true),workflow('RAI','GET','assets',list),workflow('RIPS','GET','assets/{id}',read),workflow('UIPS','PUT','assets/{id}',update),workflow('DIPS','DELETE','assets/{id}',remove),workflow('FIPS','GET','assets/{id}/file',file)];
  return {$schema:'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',contentVersion:'1.0.0.0',resources};
}
if(require.main===module)(async()=>{
  const [configPath,outputPath]=process.argv.slice(2);if(!configPath||!outputPath)throw new Error('Usage: node infra/workflow-factory.cjs <config.json> <output.json>');
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const base=path.dirname(configPath);const cosmos=JSON.parse(await fs.readFile(path.resolve(base,config.cosmosSwagger),'utf8'));const blob=JSON.parse(await fs.readFile(path.resolve(base,config.blobSwagger),'utf8'));
  await fs.writeFile(outputPath,JSON.stringify(makeWorkflows(config,cosmos,blob),null,2)+'\n');console.log('Generated six Logic Apps from the subscription connector definitions.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={operation,connectorAction,makeWorkflows};
