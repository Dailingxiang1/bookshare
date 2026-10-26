'use strict';
const { createDocument, metadata, analyzeFile, publicAsset, validId, fail } = require('./domain.cjs');

function createRouter({store, translation, mode='local', writeToken='', readFile}) {
  return async function route({method, pathname, body, headers={}, query=new URLSearchParams()}) {
    const write = ['POST','PUT','PATCH','DELETE'].includes(method);
    if (writeToken && write) {
      const token = headers['x-write-token'] || '';
      const crypto = require('node:crypto');
      const a = Buffer.from(token), b = Buffer.from(writeToken);
      if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) fail(401,'write_access_required','请先输入共享空间的管理口令。');
    }
    const json = (status,data,extra={}) => ({status, json:data, headers:extra});
    if (pathname === '/api/access' && method === 'POST') return json(200,{allowed:true});
    if (pathname === '/api/config' && method === 'GET') return json(200,{mode, maxFileBytes:5*1024*1024, writeAccessRequired:!!writeToken, translationAvailable:!!translation});
    if (pathname === '/api/health' && method === 'GET') return json(200,{status:'ok', mode, crudBackend:mode==='azure'?'Azure Logic Apps':'Local filesystem', translationConfigured:!!translation});
    if (pathname === '/api/analyze' && method === 'POST') { const result=analyzeFile(body); return json(200,{file:result.file, verified:true}); }
    if (pathname === '/api/translate' && method === 'POST') {
      if (!translation) fail(503,'translator_unconfigured','翻译服务将在连接 Azure Translator 后启用。');
      return json(200,await translation(body));
    }
    if (pathname === '/api/assets') {
      if (method === 'GET') return json(200,{items:(await store.list()).map(publicAsset)});
      if (method === 'POST') {
        const {document,bytes} = createDocument(body);
        const saved = await store.create(document,bytes);
        return json(201,{asset:publicAsset(saved)},{Location:`/api/assets/${saved.id}`});
      }
      return {status:405,json:{error:{code:'method_not_allowed',message:'此地址支持 GET 和 POST。'}},headers:{Allow:'GET, POST'}};
    }
    const match = pathname.match(/^\/api\/assets\/([^/]+)(\/file)?$/u);
    if (match) {
      const id = validId(match[1]);
      if (match[2]) {
        if (method !== 'GET') return {status:405,json:{error:{code:'method_not_allowed',message:'文件地址只支持 GET。'}},headers:{Allow:'GET'}};
        const asset = await store.get(id);
        const download=query.get('download')==='1';
        if (readFile) return readFile(asset,{download});
        return {status:200,bytes:await store.file(asset),headers:{'Content-Type':asset.file.contentType,
          'Content-Disposition':`${download?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(asset.file.fileName)}`,'Cache-Control':'private, max-age=60'}};
      }
      if (method === 'GET') return json(200,{asset:publicAsset(await store.get(id))});
      if (method === 'PUT' || method === 'PATCH') return json(200,{asset:publicAsset(await store.update(id,metadata(body,true)))});
      if (method === 'DELETE') { await store.delete(id); return {status:204}; }
      return {status:405,json:{error:{code:'method_not_allowed',message:'此地址支持 GET、PUT、PATCH 和 DELETE。'}},headers:{Allow:'GET, PUT, PATCH, DELETE'}};
    }
    fail(404,'route_not_found','没有找到这个接口。');
  };
}
module.exports = { createRouter };
