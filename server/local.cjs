'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {LocalStore} = require('./local-store.cjs');
const {createRouter} = require('./router.cjs');
const {AppError,MAX_FILE_BYTES} = require('./domain.cjs');
const {createTranslator} = require('./translator.cjs');
const {seed} = require('./seed.cjs');

async function createServer({dataDir=path.join(__dirname,'../.local'),seedData=true,writeToken='',translation=null}={}) {
  const store = new LocalStore(dataDir); await store.initialize();
  if(seedData)await seed(store);
  const route=createRouter({store,mode:'local',translation,writeToken});
  const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml'};
  const staticFiles=new Set(['index.html','styles.css','app.js','config.js']);
  async function registerVendor(directory,relative='vendor'){
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries){const next=path.join(directory,entry.name);const name=relative+'/'+entry.name;if(entry.isDirectory())await registerVendor(next,name);else if(entry.isFile())staticFiles.add(name);}
  }
  await registerVendor(path.join(__dirname,'../web/vendor'));
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' https:; img-src 'self' blob: https:; font-src 'self' data: blob:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; frame-src 'self' blob: https:; object-src 'none'; base-uri 'self'");
    try{
      if(!['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+req.headers.host).hostname))throw new AppError(403,'host_denied','此演示服务只接受本机地址。');
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        if(req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)throw new AppError(403,'origin_denied','不允许来自其他网站的请求。');
        let body;
        if(['POST','PUT','PATCH'].includes(req.method)){
          if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw new AppError(415,'json_required','请使用 application/json。');
          const chunks=[];let size=0;let overflow=false;
          for await(const chunk of req){size+=chunk.length;if(size>Math.ceil(MAX_FILE_BYTES*4/3)+20000){overflow=true;chunks.length=0;}else if(!overflow)chunks.push(chunk);}
          if(overflow)throw new AppError(413,'file_too_large','请求超过 5 MB 文件大小限制。');
          try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(400,'invalid_json','JSON 内容格式错误。');}
        }
        const result=await route({method:req.method,pathname:url.pathname,body,headers:req.headers,query:url.searchParams});
        res.writeHead(result.status,{...(result.json?{'Content-Type':'application/json; charset=utf-8'}:{}),...result.headers});
        res.end(result.bytes || (result.json?JSON.stringify(result.json):undefined));return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      if(!staticFiles.has(name)){res.writeHead(404);res.end('Not found');return;}
      const content=await fs.readFile(path.join(__dirname,'../web',name));
      res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){
      const known=error instanceof AppError;
      res.writeHead(known?error.status:500,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:{code:known?error.code:'internal_error',message:known?error.message:'服务暂不可用，请重试。'}}));
      if(!known)console.error(error);
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,store};
}
if(require.main===module){
  const translation=createTranslator({key:process.env.AZURE_TRANSLATOR_KEY,region:process.env.AZURE_TRANSLATOR_REGION});
  createServer({translation}).then(({server})=>server.listen(Number(process.env.PORT||7073),'127.0.0.1',()=>console.log(`BookShare local preview: http://127.0.0.1:${server.address().port}`))).catch(e=>{console.error(e);process.exitCode=1;});
}
module.exports={createServer};
