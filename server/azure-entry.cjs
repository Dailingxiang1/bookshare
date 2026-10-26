'use strict';
const {app}=require('@azure/functions');
const {createRouter}=require('./router.cjs');
const {LogicAppsStore}=require('./azure-store.cjs');
const {createTranslator}=require('./translator.cjs');
const {AppError}=require('./domain.cjs');

let handler;
function runtime(){
  if(handler)return handler;
  const urls=Object.fromEntries(['IUPS','RAI','RIPS','UIPS','DIPS','FIPS'].map(op=>[op,process.env['WORKFLOW_'+op+'_URL']]));
  if(Object.values(urls).some(value=>!value)||!process.env.WRITE_TOKEN||process.env.WRITE_TOKEN.length<24)throw new AppError(503,'cloud_not_configured','云端接口和管理口令尚未配置。');
  const store=new LogicAppsStore({urls});
  const translation=createTranslator({key:process.env.AZURE_TRANSLATOR_KEY,region:process.env.AZURE_TRANSLATOR_REGION});
  handler=createRouter({store,translation,mode:'azure',writeToken:process.env.WRITE_TOKEN});
  return handler;
}
async function handle(request,context){
  const origins=String(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean);
  const origin=request.headers.get('origin');
  const cors=origin&&origins.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Write-Token'}:{};
  const headers={...cors,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
  try{
    if(origin&&!origins.includes(origin))throw new AppError(403,'origin_denied','此网站尚未加入允许访问的列表。');
    if(request.method==='OPTIONS')return {status:204,headers};
    const url=new URL(request.url);
    let body;
    if(['POST','PUT','PATCH'].includes(request.method)){
      if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw new AppError(415,'json_required','请使用 application/json。');
      if(Number(request.headers.get('content-length')||0)>7_010_508)throw new AppError(413,'file_too_large','请求超过大小限制。');
      const raw=await request.text();
      if(Buffer.byteLength(raw,'utf8')>7_010_508)throw new AppError(413,'file_too_large','请求超过大小限制。');
      try{body=JSON.parse(raw);}catch{throw new AppError(400,'invalid_json','JSON 内容格式错误。');}
    }
    const result=await runtime()({method:request.method,pathname:url.pathname,query:url.searchParams,body,headers:{'x-write-token':request.headers.get('x-write-token')||''}});
    return {status:result.status,headers:{...headers,...result.headers},...(result.json?{jsonBody:result.json}:result.bytes?{body:result.bytes}:{})};
  }catch(error){
    const known=error instanceof AppError;
    if(!known)context.error('BookShare request failed: '+error.name);
    return {status:known?error.status:500,headers,jsonBody:{error:{code:known?error.code:'internal_error',message:known?error.message:'云端服务暂不可用。'}}};
  }
}
app.http('bookshare',{route:'{*path}',methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],authLevel:'anonymous',handler:handle});
module.exports={handle};
