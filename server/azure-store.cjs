'use strict';
const {AppError,fail}=require('./domain.cjs');

function callbackUrl(raw,id){
  if(!raw)fail(503,'cloud_not_configured','Azure Logic Apps 地址尚未配置。');
  const encoded=raw.replace(/%7Bid%7D/ig,'{id}');
  const url=new URL(id?encoded.replaceAll('{id}',encodeURIComponent(id)):encoded);
  if(url.protocol!=='https:')throw new Error('Logic Apps callbacks must use HTTPS.');
  return url;
}
function cleanDocument(asset){
  if(!asset||typeof asset!=='object'||Array.isArray(asset)||typeof asset.id!=='string'||!asset.file||typeof asset.createdAt!=='string')fail(502,'invalid_workflow_response','云端资料格式不正确，请检查工作流响应。');
  const fields=['id','title','bookTitle','creatorName','description','tags','language','rights','mediaType','file','createdAt','updatedAt'];
  return Object.fromEntries(fields.filter(k=>Object.hasOwn(asset,k)).map(k=>[k,asset[k]]));
}
class LogicAppsStore{
  constructor({urls,fetchImpl=fetch}){this.urls=urls;this.fetch=fetchImpl;}
  async call(operation,{id,method='GET',body,continuation,binary=false}={}){
    const url=callbackUrl(this.urls[operation],id);
    if(continuation)url.searchParams.set('continuation',continuation);
    let response;
    try{response=await this.fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});}
    catch{fail(503,'workflow_unavailable','Azure 工作流暂时无法连接，请稍后重试。');}
    if(!response.ok){
      if(response.status===404)fail(404,'asset_not_found','这份资料不存在或已被删除。');
      if(response.status===409)fail(409,'asset_conflict','资料已存在，请刷新后重试。');
      fail(503,'workflow_failed','Azure 工作流未能完成操作，请检查云端运行记录。');
    }
    if(response.status===204)return null;
    if(binary){
      const bytes=Buffer.from(await response.arrayBuffer());
      if(response.headers.get('content-type')?.includes('application/json')){
        try{const content=JSON.parse(bytes.toString('utf8'));if(typeof content.$content==='string')return Buffer.from(content.$content,'base64');}catch{}
      }
      return bytes;
    }
    try{return await response.json();}catch{fail(502,'invalid_workflow_response','云端接口未返回有效 JSON，请检查工作流响应。');}
  }
  async list(){
    const all=[];let continuation='';
    for(let page=0;page<20;page++){
      const result=await this.call('RAI',{continuation});
      const body=result.items??result;
      const items=Array.isArray(body)?body:body.Documents??body.documents??body.value??body.items;
      if(!Array.isArray(items))fail(502,'invalid_workflow_response','云端列表格式不正确，请检查 RAI 工作流。');
      all.push(...items.map(cleanDocument));
      continuation=result.continuation||result.ContinuationToken||body.ContinuationToken||'';
      if(!continuation)return all.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    }
    fail(503,'catalogue_limit','当前演示目录超出读取上限，需要启用分页检索。');
  }
  async get(id){const result=await this.call('RIPS',{id});const asset=cleanDocument(result.asset??result);if(asset.id!==id)fail(502,'invalid_workflow_response','云端资料编号与请求不一致。');return asset;}
  async create(document,bytes){const result=await this.call('IUPS',{method:'POST',body:{asset:document,dataBase64:bytes.toString('base64')}});const saved=cleanDocument(result.asset??result);if(saved.id!==document.id)fail(502,'invalid_workflow_response','云端资料编号与上传请求不一致。');return saved;}
  async update(id,changes){const asset=await this.get(id);const next={...asset,...changes,updatedAt:new Date().toISOString()};const result=await this.call('UIPS',{id,method:'PUT',body:{asset:next}});return cleanDocument(result.asset??result);}
  async delete(id){await this.call('DIPS',{id,method:'DELETE'});}
  async file(asset){return this.call('FIPS',{id:asset.id,binary:true});}
}
module.exports={LogicAppsStore,callbackUrl,cleanDocument};
