'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {handle}=require('../server/azure-entry.cjs');
const request=(method='GET',body='',headers={})=>({method,url:'https://unit-test.invalid/api/assets',headers:new Headers(headers),text:async()=>body});
const context={error:()=>{throw new Error('Unexpected unhandled Function error.');}};
test('Function adapter is explicit when Azure workflow configuration is absent',async()=>{
  const keys=['IUPS','RAI','RIPS','UIPS','DIPS','FIPS'].map(k=>'WORKFLOW_'+k+'_URL');
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);
  try{const result=await handle(request(),context);assert.equal(result.status,503);assert.equal(result.jsonBody.error.code,'cloud_not_configured');assert.ok(!JSON.stringify(result).includes('sig='));}
  finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
test('Function CORS permits exactly the configured website and handles preflight',async()=>{
  const saved=process.env.ALLOWED_ORIGINS;process.env.ALLOWED_ORIGINS='https://website.test';
  try{
    const rejected=await handle(request('GET','',{Origin:'https://unapproved.test'}),context);assert.equal(rejected.status,403);assert.equal(rejected.headers['Access-Control-Allow-Origin'],undefined);
    const permitted=await handle(request('OPTIONS','',{Origin:'https://website.test'}),context);assert.equal(permitted.status,204);assert.equal(permitted.headers['Access-Control-Allow-Origin'],'https://website.test');assert.ok(permitted.headers['Access-Control-Allow-Headers'].includes('X-Write-Token'));
  }finally{if(saved===undefined)delete process.env.ALLOWED_ORIGINS;else process.env.ALLOWED_ORIGINS=saved;}
});
test('Function rejects invalid JSON, media type and chunked oversized input before invoking Azure',async()=>{
  assert.equal((await handle(request('POST','{}'),context)).status,415);
  assert.equal((await handle(request('POST','{',{'Content-Type':'application/json'}),context)).status,400);
  const large=await handle(request('POST','x'.repeat(7_010_509),{'Content-Type':'application/json'}),context);assert.equal(large.status,413);
});
