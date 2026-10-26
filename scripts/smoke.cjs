'use strict';
// Creates and deletes only its own disposable test record. Never deletes an existing asset.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {originalPdf}=require('../server/seed.cjs');
(async()=>{
  const raw=process.env.BOOKSHARE_BASE_URL;if(!raw)throw new Error('Set BOOKSHARE_BASE_URL to the deployed Function origin, or http://127.0.0.1:7073 for an explicitly local run.');
  const base=new URL(raw);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)))throw new Error('Only HTTPS or loopback test origins are allowed.');
  const local=base.protocol==='http:';const report={startedAt:new Date().toISOString(),mode:local?'local':'azure',base:base.origin,checks:[],completed:false};
  const request=async(route,method='GET',body)=>{
    const response=await fetch(new URL(route,base),{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(process.env.BOOKSHARE_WRITE_TOKEN?{'X-Write-Token':process.env.BOOKSHARE_WRITE_TOKEN}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
    return response;
  };
  const check=(label,condition)=>{assert.ok(condition,label);report.checks.push(label);};
  const configResponse=await request('/api/config');check('config HTTP 200',configResponse.status===200);const config=await configResponse.json();check('expected deployment mode',config.mode===(local?'local':'azure'));
  const bytes=originalPdf('BookShare deployment smoke test',['Disposable original test material.']);let id;
  try{
    const upload={fileName:'bookshare-smoke.pdf',contentType:'application/pdf',dataBase64:bytes.toString('base64')};
    const inspection=await request('/api/analyze','POST',upload);check('Function file inspection HTTP 200',inspection.status===200);const inspected=await inspection.json();check('actual SHA-256',inspected.file.sha256===crypto.createHash('sha256').update(bytes).digest('hex'));
    const created=await request('/api/assets','POST',{title:'Disposable deployment test',bookTitle:'Original smoke worksheet',creatorName:'BookShare smoke test',description:'An original worksheet used to verify the deployment.',language:'en',tags:['deployment-test'],rights:'original',upload});check('create HTTP 201',created.status===201);id=(await created.json()).asset.id;
    const listed=await(await request('/api/assets')).json();check('created record appears in catalogue',listed.items.some(a=>a.id===id));
    const read=await request('/api/assets/'+id);check('individual HTTP 200',read.status===200);
    const file=await request('/api/assets/'+id+'/file');check('download bytes match upload',Buffer.from(await file.arrayBuffer()).equals(bytes));
    const updated=await request('/api/assets/'+id,'PUT',{title:'Updated disposable deployment test'});check('update HTTP 200',updated.status===200);check('updated title persisted',(await updated.json()).asset.title==='Updated disposable deployment test');
    if(!local){
      check('Translator configured',config.translationAvailable===true);
      const translated=await request('/api/translate','POST',{text:'Original reading notes.',to:'zh-Hans'});check('live Translator HTTP 200',translated.status===200);const translation=await translated.json();check('live Translator result present',translation.provider==='Azure AI Translator'&&typeof translation.text==='string'&&translation.text.length>0);
    }
    const removed=await request('/api/assets/'+id,'DELETE');check('delete HTTP 204',removed.status===204);check('deleted record returns HTTP 404',(await request('/api/assets/'+id)).status===404);id=null;
    report.completed=true;
  }finally{
    if(id){try{await request('/api/assets/'+id,'DELETE');}catch{console.error('The disposable test record could not be cleaned up. Check this id in the catalogue: '+id);}}
    report.finishedAt=new Date().toISOString();await fs.mkdir(path.join(__dirname,'../reports'),{recursive:true});await fs.writeFile(path.join(__dirname,'../reports',local?'local-smoke.json':'cloud-smoke.json'),JSON.stringify(report,null,2)+'\n');
  }
  console.log((local?'LOCAL':'AZURE')+' smoke checks passed: '+report.checks.length+'. '+(local?'This is not cloud deployment evidence.':'Also inspect actual Cosmos / Blob deletion, workflow runs and Pipeline in Azure Portal.'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
