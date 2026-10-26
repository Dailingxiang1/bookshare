'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('../server/local.cjs');
const {originalPdf}=require('../server/seed.cjs');
const {analyzeFile,metadata}=require('../server/domain.cjs');
const {createTranslator}=require('../server/translator.cjs');

const payload=()=>({title:'我的原创笔记',bookTitle:'示例书名',creatorName:'测试读者',description:'测试阅读材料',tags:['文学','文学'],language:'zh-Hans',rights:'original',upload:{fileName:'original-notes.pdf',contentType:'application/pdf',dataBase64:originalPdf('Test notes',['Original test material.']).toString('base64')}});
for(const [name,type] of [['tiny.png','image/png'],['tiny.jpg','image/jpeg']])test('image upload, dimensions, download and deletion: '+type,async t=>{
  const {request,directory}=await fixture(t);const bytes=await fs.readFile(path.join(__dirname,'fixtures',name));const body=payload();
  body.upload={fileName:name,contentType:type,dataBase64:bytes.toString('base64')};
  const inspected=await request('/api/analyze','POST',body.upload);assert.equal(inspected.status,200);assert.equal((await inspected.json()).file.width,8);
  const created=await request('/api/assets','POST',body);assert.equal(created.status,201);const asset=(await created.json()).asset;
  assert.equal(asset.mediaType,'cover');assert.equal(asset.file.width,8);assert.equal(asset.file.height,6);assert.equal(asset.file.contentType,type);
  const downloaded=await request(asset.fileUrl);assert.equal(downloaded.headers.get('Content-Type'),type);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
  assert.equal((await request('/api/assets/'+asset.id,'DELETE')).status,204);assert.deepEqual(await fs.readdir(path.join(directory,'blobs')),[]);
});
async function fixture(t,options={}){
  const parent=path.resolve(__dirname,'../.local/test-data');await fs.mkdir(parent,{recursive:true});
  const directory=await fs.mkdtemp(path.join(parent,'run-'));
  const {server,store}=await createServer({dataDir:directory,seedData:false,...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const target=path.resolve(directory);assert.ok(target.startsWith(parent+path.sep));await fs.rm(target,{recursive:true,force:true});});
  const request=(url,method='GET',body,headers={})=>fetch(base+url,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {base,request,store,directory};
}
test('full asset CRUD, actual file download, partial update and cascade deletion',async t=>{
  const {request,directory}=await fixture(t);
  let response=await request('/api/assets','POST',payload());assert.equal(response.status,201);
  const asset=(await response.json()).asset;assert.equal(asset.file.contentType,'application/pdf');assert.equal(asset.mediaType,'notes');assert.deepEqual(asset.tags,['文学']);
  assert.equal(response.headers.get('Location'),'/api/assets/'+asset.id);
  const root='/api/assets/'+asset.id;
  assert.equal((await(await request(root)).json()).asset.title,'我的原创笔记');
  assert.equal((await(await request('/api/assets')).json()).items.length,1);
  response=await request(root+'/file');assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.ok((await response.text()).startsWith('%PDF-1.4'));
  response=await request(root+'/file?download=1');assert.ok(response.headers.get('Content-Disposition').startsWith('attachment;'));
  response=await request(root,'PUT',{title:'修改后的标题'});assert.equal(response.status,200);const updated=(await response.json()).asset;assert.equal(updated.title,'修改后的标题');assert.equal(updated.bookTitle,'示例书名');assert.equal(updated.file.sha256,asset.file.sha256);
  assert.equal((await request(root,'PATCH',{id:crypto.randomUUID()})).status,400);
  response=await request(root,'DELETE');assert.equal(response.status,204);assert.equal(await response.text(),'');
  assert.equal((await request(root)).status,404);assert.equal((await request(root+'/file')).status,404);
  assert.deepEqual(await fs.readdir(path.join(directory,'blobs')),[]);
});
test('local preview has actual seed PDFs, no fictional Azure deployment status',async t=>{
  const {request}=await fixture(t,{seedData:true});
  const config=await(await request('/api/config')).json();assert.equal(config.mode,'local');assert.equal(config.translationAvailable,false);
  const health=await(await request('/api/health')).json();assert.equal(health.crudBackend,'Local filesystem');
  const assets=(await(await request('/api/assets')).json()).items;assert.equal(assets.length,3);
  for(const asset of assets)assert.ok((await(await request(asset.fileUrl)).text()).includes('Original demonstration notes'));
});
test('writes require the configured token and secrets never appear in public config',async t=>{
  const secret=crypto.randomBytes(24).toString('hex');const {request}=await fixture(t,{writeToken:secret});
  assert.equal((await request('/api/assets','POST',payload())).status,401);
  assert.equal((await request('/api/assets','POST',payload(),{'X-Write-Token':'wrong'})).status,401);
  assert.equal((await request('/api/assets','POST',payload(),{'X-Write-Token':secret})).status,201);
  assert.equal((await request('/api/access','POST',{}, {'X-Write-Token':secret})).status,200);
  assert.equal((await request('/api/analyze','POST',payload().upload)).status,401);
  const config=await(await request('/api/config')).text();assert.ok(!config.includes(secret));assert.equal(JSON.parse(config).writeAccessRequired,true);
});
for(const [name,change] of [
  ['blank title',p=>p.title=' '],['missing book',p=>delete p.bookTitle],['too many tags',p=>p.tags=Array.from({length:7},(_,i)=>'tag'+i)],
  ['bad rights',p=>p.rights='pirated'],['wrong language',p=>p.language='xx'],['server identity injection',p=>p.id='forged'],
  ['invalid content',p=>p.upload.dataBase64=Buffer.from('hello').toString('base64')],['invalid base64',p=>p.upload.dataBase64='$$$='],
  ['path in filename',p=>p.upload.fileName='../notes.pdf'],['mismatched extension',p=>p.upload.fileName='notes.png'],
  ['boolean title',p=>p.title=true],['empty payload',p=>Object.keys(p).forEach(k=>delete p[k])],
])test('rejects '+name,async t=>{const {request}=await fixture(t);const body=payload();change(body);const response=await request('/api/assets','POST',body);assert.equal(response.status,400);assert.ok((await response.json()).error.code);assert.equal((await(await request('/api/assets')).json()).items.length,0);});
test('rejects unsupported types, overlarge bodies and malformed JSON',async t=>{
  const {base,request}=await fixture(t);const p=payload();p.upload.contentType='image/svg+xml';assert.equal((await request('/api/assets','POST',p)).status,415);
  let response=await fetch(base+'/api/assets',{method:'POST',body:'hello'});assert.equal(response.status,415);
  response=await fetch(base+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(response.status,400);
  response=await fetch(base+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(7_100_000)});assert.equal(response.status,413);
  assert.equal((await request('/api/assets','POST',payload(),{Origin:'https://other.example'})).status,403);
});
test('identifiers, absent resources, methods and static file boundaries',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/api/assets/not-a-uuid')).status,400);
  const absent='/api/assets/'+crypto.randomUUID();
  assert.equal((await request(absent)).status,404);assert.equal((await request(absent,'PUT',{title:'Valid'})).status,404);assert.equal((await request(absent,'DELETE')).status,404);
  const wrong=await request('/api/assets','PUT',{});assert.equal(wrong.status,405);assert.equal(wrong.headers.get('Allow'),'GET, POST');
  assert.equal((await request('/.local/assets.json')).status,404);
  assert.equal((await request('/server/local.cjs')).status,404);
  const page=await request('/');assert.equal(page.status,200);assert.ok((await page.text()).includes('BookShare'));assert.ok(page.headers.get('Content-Security-Policy').includes("script-src 'self'"));
});
test('parallel uploads do not lose records or share file names',async t=>{
  const {request,store}=await fixture(t);
  const results=await Promise.all(Array.from({length:8},(_,i)=>request('/api/assets','POST',{...payload(),title:'Note '+i})));
  assert.deepEqual(results.map(r=>r.status),Array(8).fill(201));
  const assets=await store.list();assert.equal(assets.length,8);assert.equal(new Set(assets.map(a=>a.file.blobName)).size,8);
});
test('binary inspection returns the real SHA-256, file size and PDF type',()=>{
  const p=payload().upload;const result=analyzeFile(p);assert.equal(result.file.sizeBytes,result.bytes.length);assert.equal(result.file.sha256,crypto.createHash('sha256').update(result.bytes).digest('hex'));
  const fields=metadata({title:' One ',bookTitle:'Book',creatorName:'Reader',rights:'original'});assert.equal(fields.title,'One');assert.deepEqual(fields.tags,[]);
});
test('local PDF renderer assets are served as modules while arbitrary dependency files stay private',async t=>{
  const {request}=await fixture(t);
  const module=await request('/vendor/pdf.mjs');assert.equal(module.status,200);assert.ok(module.headers.get('Content-Type').includes('javascript'));
  const worker=await request('/vendor/pdf.worker.mjs');assert.equal(worker.status,200);
  assert.equal((await request('/node_modules/pdfjs-dist/package.json')).status,404);
});
test('disabled translation returns an honest service-unavailable response',async t=>{const {request}=await fixture(t);const response=await request('/api/translate','POST',{text:'hello',to:'zh-Hans'});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'translator_unconfigured');});
test('Azure Translator adapter makes an authenticated API request and returns only the result',async()=>{
  let seen;
  const translate=createTranslator({key:'test-only-key',region:'westeurope',fetchImpl:async(url,options)=>{seen={url:String(url),...options};return {ok:true,json:async()=>[{translations:[{text:'Hello',to:'en'}]}]};}});
  assert.deepEqual(await translate({text:'你好',to:'en'}),{text:'Hello',to:'en',provider:'Azure AI Translator'});
  assert.ok(seen.url.includes('api-version=3.0'));assert.ok(seen.url.includes('to=en'));assert.equal(seen.headers['Ocp-Apim-Subscription-Key'],'test-only-key');assert.deepEqual(JSON.parse(seen.body),[{Text:'你好'}]);
  await assert.rejects(()=>translate({text:'你好',to:'invalid'}),e=>e.status===400);
});
test('translation failures are reported without exposing Azure keys',async()=>{
  const translate=createTranslator({key:'private-test-key',fetchImpl:async()=>({ok:false})});
  await assert.rejects(()=>translate({text:'hello',to:'zh-Hans'}),e=>e.status===503&&!e.message.includes('private-test-key'));
});
