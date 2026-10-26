'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {LogicAppsStore,callbackUrl}=require('../server/azure-store.cjs');
const {makeWorkflows,connectorAction}=require('../infra/workflow-factory.cjs');
const {createDocument}=require('../server/domain.cjs');
const {originalPdf}=require('../server/seed.cjs');
const {createRouter}=require('../server/router.cjs');

const ids=()=>crypto.randomUUID();
const sample=()=>createDocument({title:'Cloud contract test',bookTitle:'Original worksheet',creatorName:'Test organiser',rights:'original',upload:{fileName:'notes.pdf',contentType:'application/pdf',dataBase64:originalPdf('Contract fixture',['Original integration test.']).toString('base64')}});
const urls=Object.fromEntries(['IUPS','RAI','RIPS','UIPS','DIPS','FIPS'].map(op=>[op,`https://unit-test.invalid/${op}/assets${['IUPS','RAI'].includes(op)?'':'/{id}'}?sig=private-test-signature`]));
test('Azure adapter delegates all CRUD and binary retrieval to signed Logic Apps callbacks (mock transport)',async()=>{
  const saved=new Map();const calls=[];
  const transport=async(url,options)=>{
    calls.push({url:new URL(url),method:options.method});
    assert.equal(new URL(url).searchParams.get('sig'),'private-test-signature');
    const [op,,id]=new URL(url).pathname.slice(1).split('/');const payload=options.body?JSON.parse(options.body):null;
    if(op==='IUPS'){saved.set(payload.asset.id,{...payload.asset,_rid:'internal',file:{...payload.asset.file,blobId:'opaque-blob-connector-id'},raw:payload.dataBase64});return Response.json({asset:saved.get(payload.asset.id)},{status:201});}
    if(op==='RAI')return Response.json({items:[...saved.values()],continuation:''});
    if(!saved.has(id))return new Response('not found',{status:404});
    if(op==='RIPS')return Response.json({asset:saved.get(id)});
    if(op==='UIPS'){saved.set(id,{...payload.asset,raw:saved.get(id).raw});return Response.json({asset:saved.get(id)});}
    if(op==='DIPS'){saved.delete(id);return new Response(null,{status:204});}
    if(op==='FIPS')return new Response(Buffer.from(saved.get(id).raw,'base64'),{headers:{'Content-Type':'application/pdf'}});
    throw new Error('Unexpected operation');
  };
  const store=new LogicAppsStore({urls,fetchImpl:transport});const route=createRouter({store,mode:'azure',writeToken:'test-token'});const {document,bytes}=sample();
  const asset=await store.create(document,bytes);assert.equal(asset.id,document.id);assert.equal(asset._rid,undefined);assert.equal(asset.raw,undefined);
  assert.equal((await store.list()).length,1);
  assert.deepEqual(await store.file(await store.get(asset.id)),bytes);
  const updated=await route({method:'PUT',pathname:'/api/assets/'+asset.id,body:{title:'Updated title'},headers:{'x-write-token':'test-token'}});
  assert.equal(updated.json.asset.title,'Updated title');assert.equal(updated.json.asset.file.blobId,'opaque-blob-connector-id');assert.equal(updated.json.asset.createdAt,asset.createdAt);
  await store.delete(asset.id);await assert.rejects(store.get(asset.id),{status:404});
  assert.deepEqual(new Set(calls.map(c=>c.url.pathname.split('/')[1])),new Set(['IUPS','RAI','RIPS','UIPS','DIPS','FIPS']));
  assert.ok(calls.some(c=>c.method==='PUT'));assert.ok(calls.some(c=>c.method==='DELETE'));
});
test('Azure list follows continuation tokens, normalises connector response and sorts without losing records',async()=>{
  const {document}=sample();let count=0;
  const store=new LogicAppsStore({urls,fetchImpl:async url=>{
    count++;const token=new URL(url).searchParams.get('continuation');
    return token?Response.json({items:{Documents:[{...document,id:ids(),createdAt:'2026-10-18T01:00:00Z'}]}}):Response.json({items:[{...document,createdAt:'2026-10-17T01:00:00Z'}],continuation:'next/page+token'});
  }});
  const all=await store.list();assert.equal(all.length,2);assert.equal(count,2);assert.equal(all[0].createdAt,'2026-10-18T01:00:00Z');
  const looping=new LogicAppsStore({urls,fetchImpl:async()=>Response.json({items:[document],continuation:'still-more'})});
  await assert.rejects(looping.list(),{code:'catalogue_limit',status:503});
});
test('Azure failures stay explicit, sanitised and distinct from missing data',async()=>{
  assert.throws(()=>callbackUrl('http://insecure.invalid'),/HTTPS/u);
  assert.throws(()=>callbackUrl(),{code:'cloud_not_configured'});
  for(const [status,expected] of [[404,404],[409,409],[500,503],[401,503]]){
    const store=new LogicAppsStore({urls,fetchImpl:async()=>new Response('private credential detail',{status})});
    await assert.rejects(store.get(ids()),error=>error.status===expected&&!error.message.includes('private'));
  }
  const broken=new LogicAppsStore({urls,fetchImpl:async()=>{throw new Error('secret socket detail');}});await assert.rejects(broken.list(),{status:503});
  const malformed=new LogicAppsStore({urls,fetchImpl:async()=>new Response('not json')});await assert.rejects(malformed.list(),{status:502});
  const wrong=new LogicAppsStore({urls,fetchImpl:async()=>Response.json({asset:{...sample().document,id:ids()}})});await assert.rejects(wrong.get(ids()),{status:502});
  const binary=new LogicAppsStore({urls,fetchImpl:async()=>Response.json({$content:Buffer.from('file').toString('base64')})});assert.equal((await binary.file(sample().document)).toString(),'file');
});

// Synthetic Swagger fixtures test the generator contract only. They are never deployment inputs.
function syntheticSwagger(kind){
  const paths={};
  const param=(name,where,required=false)=>({name,in:where,required,type:'string'});
  if(kind==='cosmos'){
    const common=[param('cosmosDbAccountName','path',true),param('databaseId','path',true),param('collectionId','path',true)];
    for(const [id,method,item,body] of [['CreateDocument_V3','post',false,true],['GetDocuments_V3','get',false,false],['GetDocument_V2','get',true,false],['ReplaceDocument_V2','put',true,true],['DeleteDocument_V2','delete',true,false]]){
      const route='/synthetic/'+id+'/{cosmosDbAccountName}/{databaseId}/{collectionId}'+(item?'/{documentId}':'');
      paths[route]={[method]:{operationId:id,parameters:[...common,...(item?[param('documentId','path',true)]:[]),param('x-ms-documentdb-raw-partitionkey','header'),param('x-ms-documentdb-is-upsert','header'),param('x-ms-max-item-count','header'),param('x-ms-continuation','header'),...(body?[param('body','body',true)]:[])]}};
    }
  }else for(const [id,method,body] of [['CreateFile_V2','post',true],['GetFileContent_V2','get',false],['DeleteFile_V2','delete',false]]){
    paths['/synthetic/'+id+'/{dataset}'+(body?'':'/{id}')]={[method]:{operationId:id,parameters:[param('dataset','path',true),...(body?[param('folderPath','query',true),param('name','query',true),param('body','body',true)]:[param('id','path',true)]),param('inferContentType','query')]}};
  }
  return {swagger:'2.0',paths};
}
const config={subscriptionId:ids(),resourceGroup:'unit-test',location:'eastus',storageName:'syntheticstorage',cosmosName:'synthetic-cosmos',workflowPrefix:'synthetic',blobConnectionId:'/synthetic/connections/blob',cosmosConnectionId:'/synthetic/connections/cosmos'};
test('workflow generation produces complete managed-connector CRUD, compensation and private file retrieval',()=>{
  const generated=makeWorkflows(config,syntheticSwagger('cosmos'),syntheticSwagger('blob'));
  assert.equal(generated.resources.length,6);
  const get=op=>generated.resources.find(r=>r.name==='synthetic-'+op.toLowerCase());
  for(const [op,method] of [['IUPS','POST'],['RAI','GET'],['RIPS','GET'],['UIPS','PUT'],['DIPS','DELETE'],['FIPS','GET']]){
    const resource=get(op);const def=resource.properties.definition;assert.equal(def.triggers.manual.inputs.method,method);
    assert.ok(def.actions.Try.actions.Success_response);assert.deepEqual(def.actions.Catch.runAfter.Try,['Failed','TimedOut']);
    assert.equal(resource.properties.parameters.$connections.value.documentdb.connectionId,config.cosmosConnectionId);
  }
  const upload=get('IUPS').properties.definition;
  assert.equal(upload.actions.Try.actions.Create_blob.type,'ApiConnection');assert.ok(upload.actions.Try.actions.Create_blob.inputs.body.includes('base64ToBinary'));
  assert.equal(upload.actions.Try.actions.Create_document.inputs.headers['x-ms-documentdb-is-upsert'],false);
  assert.ok(upload.actions.Try.actions.Asset_with_blob.inputs.includes('blobId'));assert.ok(upload.actions.Catch.actions.Rollback_if_created.actions.Delete_orphan);
  const deletion=get('DIPS').properties.definition.actions.Try.actions;assert.deepEqual(deletion.Delete_blob.runAfter,{Delete_document:['Succeeded']});assert.equal(deletion.Success_response.inputs.statusCode,204);
  assert.equal(get('FIPS').properties.definition.actions.Try.actions.Get_blob.type,'ApiConnection');
  assert.match(get('RIPS').properties.definition.actions.Try.actions.Get_document.inputs.headers['x-ms-documentdb-raw-partitionkey'],/concat\('"'/u);
  assert.equal(get('RAI').properties.definition.actions.Try.actions.Get_documents.inputs.headers['x-ms-max-item-count'],100);
  assert.ok(get('RAI').properties.definition.actions.Try.actions.Success_response.inputs.body.continuation.includes('x-ms-continuation'));
});
test('generator uses supplied connector routes and fails instead of inventing missing operations',()=>{
  assert.throws(()=>makeWorkflows(config,{paths:{}},syntheticSwagger('blob')),/Expected one connector operation/u);
  const swagger=syntheticSwagger('blob');const action=connectorAction(swagger,'azureblob','GetFileContent_V2',{dataset:'https://example.blob.core.windows.net/',id:'@variables(\'id\')'});
  assert.ok(action.inputs.path.startsWith('/synthetic/GetFileContent_V2/'));
  assert.ok(action.inputs.path.includes("encodeURIComponent(encodeURIComponent(variables('id')))"));
  assert.throws(()=>connectorAction(swagger,'azureblob','GetFileContent_V2',{}),/required parameter/u);
});
test('exported connector transport prefix is supplied by the host while operation paths and encodings are retained',()=>{
  const swagger={swagger:'2.0',parameters:{connection:{name:'connectionId',in:'path',required:true,type:'string'}},paths:{
    '/{connectionId}/v2/datasets/{dataset}/files/{id}/content':{
      parameters:[{$ref:'#/parameters/connection'}],
      get:{operationId:'GetFileContent_V2',parameters:[
        {name:'dataset',in:'path',required:true,type:'string'},
        {name:'id',in:'path',required:true,type:'string','x-ms-url-encoding':'single'},
        {name:'inferContentType',in:'query',type:'boolean'}
      ]}
    }
  }};
  const action=connectorAction(swagger,'azureblob','GetFileContent_V2',{dataset:'https://sample.blob.core.windows.net/',id:"@variables('blobId')",inferContentType:true});
  assert.equal(action.inputs.host.connection.name,"@parameters('$connections')['azureblob']['connectionId']");
  assert.equal(action.inputs.path,"/v2/datasets/@{encodeURIComponent(encodeURIComponent('https://sample.blob.core.windows.net/'))}/files/@{encodeURIComponent(variables('blobId'))}/content");
  assert.deepEqual(action.inputs.queries,{inferContentType:true});
  assert.throws(()=>connectorAction(swagger,'azureblob','GetFileContent_V2',{dataset:'sample'}),/required parameter GetFileContent_V2.id/u);
});

test('ARM resources use private blobs, NoSQL /id partitioning, Consumption and no secret outputs',()=>{
  const arm=JSON.parse(fs.readFileSync(path.join(__dirname,'../infra/main.json'),'utf8'));
  const find=type=>arm.resources.find(r=>r.type===type);
  assert.equal(find('Microsoft.Storage/storageAccounts').properties.allowBlobPublicAccess,false);
  assert.equal(find('Microsoft.Storage/storageAccounts/blobServices/containers').properties.publicAccess,'None');
  assert.deepEqual(find('Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers').properties.resource.partitionKey.paths,['/id']);
  assert.equal(find('Microsoft.DocumentDB/databaseAccounts').properties.capabilities[0].name,'EnableServerless');
  assert.equal(find('Microsoft.Web/serverfarms').sku.tier,'Dynamic');
  assert.equal(find('Microsoft.CognitiveServices/accounts').kind,'TextTranslation');
  assert.ok(!/listKeys|password|secret|sig=/iu.test(JSON.stringify(arm.outputs)));
});
