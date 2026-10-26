'use strict';
const $ = id => document.getElementById(id);
const base = String(window.BOOKSHARE_CONFIG?.apiBase || '').replace(/\/$/u,'');
const state = {assets:[],filter:'all',search:'',sort:'newest',config:null,selected:null,editing:null,upload:null,uploadEpoch:0,accessResolve:null};
let token = sessionStorage.getItem('bookshare-write-token') || '';
let toastTimer;
let pdfLoadingTask=null,pdfLibraryPromise=null,pdfEpoch=0;
const absolute = path => base + path;
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
async function api(path,{method='GET',body}={}){
  const response=await fetch(absolute(path),{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{'X-Write-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',signal:AbortSignal.timeout(55000)});
  const data=response.status===204?null:await response.json();
  if(!response.ok){if(response.status===401){token='';sessionStorage.removeItem('bookshare-write-token');updateManage();}throw new Error(data?.error?.message || '操作未完成，请稍后重试。');}
  return data;
}
function element(tag,className,content){const e=document.createElement(tag);if(className)e.className=className;if(content!==undefined)e.textContent=content;return e;}
function formatSize(bytes){return bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1024))+' KB';}
function formatDate(iso){return new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric'}).format(new Date(iso));}
function tagsList(tags){const e=element('div','tag-list');for(const tag of tags)e.append(element('span','tag',tag));return e;}
function closePdf(){pdfEpoch++;if(pdfLoadingTask){pdfLoadingTask.destroy().catch(()=>{});pdfLoadingTask=null;}}
async function renderPdf(asset,container){
  const epoch=pdfEpoch;const status=element('p','pdf-status','正在渲染 PDF…');
  const paper=element('div','pdf-paper');const canvas=element('canvas','pdf-canvas');canvas.setAttribute('aria-label',asset.file.fileName+' 的页面预览');paper.append(canvas);
  const controls=element('div','pdf-controls');const previous=element('button','button button-secondary','上一页');previous.type='button';const next=element('button','button button-secondary','下一页');next.type='button';const pageLabel=element('span','pdf-page-label');controls.append(previous,pageLabel,next);container.append(status,paper,controls);controls.hidden=true;paper.hidden=true;
  try{
    const lib=await(pdfLibraryPromise??=import('./vendor/pdf.mjs'));
    if(epoch!==pdfEpoch)return;
    lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',location.href).href;
    const task=lib.getDocument({url:absolute(asset.fileUrl),cMapUrl:new URL('./vendor/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',location.href).href,wasmUrl:new URL('./vendor/wasm/',location.href).href,withCredentials:false,isEvalSupported:false,enableXfa:false,useSystemFonts:true});pdfLoadingTask=task;
    const pdf=await task.promise;if(epoch!==pdfEpoch){await task.destroy();return;}
    let pageNumber=1,busy=false;
    async function draw(){
      busy=true;previous.disabled=true;next.disabled=true;
      try{
        const page=await pdf.getPage(pageNumber);if(epoch!==pdfEpoch)return;
        const initial=page.getViewport({scale:1});const available=Math.max(180,container.clientWidth-32);const scale=Math.min(1.45,available/initial.width);const viewport=page.getViewport({scale});const ratio=Math.min(devicePixelRatio||1,2);
        canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);
        await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
        if(epoch!==pdfEpoch)return;
        canvas.setAttribute('aria-label',asset.file.fileName+'，第 '+pageNumber+' 页，共 '+pdf.numPages+' 页');
        status.hidden=true;paper.hidden=false;controls.hidden=false;pageLabel.textContent=pageNumber+' / '+pdf.numPages;
      }finally{busy=false;previous.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;}
    }
    previous.addEventListener('click',()=>{if(!busy&&pageNumber>1){pageNumber--;draw().catch(showError);}});
    next.addEventListener('click',()=>{if(!busy&&pageNumber<pdf.numPages){pageNumber++;draw().catch(showError);}});
    function showError(){if(epoch===pdfEpoch){status.hidden=false;status.textContent='此页暂时无法渲染，可以下载原文件查看。';}}
    await draw();
  }catch(error){if(epoch===pdfEpoch){status.textContent='此 PDF 暂时无法预览，可以下载原文件查看。';paper.hidden=true;controls.hidden=true;}}
}
function palette(asset){let hash=0;for(const char of asset.bookTitle)hash=(hash*31+char.charCodeAt(0))>>>0;return hash%4;}
function updateManage(){$('manage-button').textContent=state.config?.writeAccessRequired?(token?'退出管理':'管理入口'):'本机管理';}
async function ensureAccess(){
  if(!state.config){toast('正在连接共享空间，请稍后重试。',true);return false;}
  if(!state.config.writeAccessRequired || token)return true;
  $('access-error').hidden=true;$('access-form').reset();$('access-dialog').returnValue='';$('access-dialog').showModal();
  return new Promise(resolve=>state.accessResolve=resolve);
}
function render(){
  const search=state.search.trim().toLocaleLowerCase();
  const filtered=state.assets.filter(asset=>(state.filter==='all'||asset.mediaType===state.filter)&&(!search||[asset.title,asset.bookTitle,asset.creatorName,...asset.tags].some(value=>value.toLocaleLowerCase().includes(search))));
  filtered.sort((a,b)=>state.sort==='title'?a.bookTitle.localeCompare(b.bookTitle,'zh-CN'):state.sort==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
  const grid=$('asset-grid');grid.replaceChildren();
  $('asset-count').textContent=`${state.assets.length} 份`;
  $('count-all').textContent=state.assets.length;$('count-notes').textContent=state.assets.filter(a=>a.mediaType==='notes').length;$('count-cover').textContent=state.assets.filter(a=>a.mediaType==='cover').length;
  $('empty-state').hidden=filtered.length!==0;
  $('result-note').textContent=filtered.length?`已显示 ${filtered.length} 份资料${search?' · 搜索结果':''}`:'';
  for(const asset of filtered){
    const card=element('article','asset-card');
    const preview=element('button',`card-preview palette-${palette(asset)}`);preview.type='button';preview.setAttribute('aria-label',`预览 ${asset.title}`);preview.addEventListener('click',()=>openDetail(asset));
    if(asset.mediaType==='cover'){const img=element('img');img.src=absolute(asset.fileUrl);img.alt=asset.bookTitle+'的封面';img.loading='lazy';preview.append(img);}
    else{const cover=element('div','pdf-cover');cover.append(element('span','cover-small','BOOKSHARE / NOTES'),element('strong','',asset.bookTitle),element('span','cover-bottom','READ · THINK · SHARE'));preview.append(cover);}
    preview.append(element('span','card-type',asset.mediaType==='cover'?'图片封面':'PDF 笔记'));
    const body=element('div','card-body');body.append(element('p','card-book',asset.bookTitle));
    const title=element('button','card-title',asset.title);title.type='button';title.addEventListener('click',()=>openDetail(asset));body.append(title,element('p','card-description',asset.description||'分享者还没有填写说明。'),tagsList(asset.tags));
    const meta=element('div','card-meta');meta.append(element('span','avatar',asset.creatorName.slice(0,1)),element('span','',asset.creatorName),element('span','date',formatDate(asset.createdAt)));
    const more=element('button','card-more','···');more.type='button';more.setAttribute('aria-label',`打开 ${asset.title} 的操作`);more.addEventListener('click',()=>openDetail(asset));meta.append(more);body.append(meta);card.append(preview,body);grid.append(card);
  }
}
async function reload(){
  try{$('connection-error').hidden=true;const data=await api('/api/assets');state.assets=data.items;render();}
  catch(error){$('asset-grid').replaceChildren();$('empty-state').hidden=true;$('connection-error').hidden=false;$('connection-error').querySelector('p').textContent=error.message;}
}
async function openForm(asset=null){
  if(!await ensureAccess())return;
  state.editing=asset;state.upload=null;state.uploadEpoch++;
  const form=$('asset-form');form.reset();$('form-error').hidden=true;$('file-status').textContent='';$('file-label').textContent='拖放文件到这里，或点击选择';$('file-help').textContent='PDF、PNG 或 JPG，最大 5 MB';
  $('file-section').hidden=!!asset;$('form-title').textContent=asset?'编辑资料信息':'上传一份资料';$('submit-asset').textContent=asset?'保存修改':'发布资料 ↗';$('submit-asset').disabled=false;
  if(asset){$('field-title').value=asset.title;$('field-book').value=asset.bookTitle;$('field-creator').value=asset.creatorName;$('field-description').value=asset.description;$('field-tags').value=asset.tags.join('，');$('field-language').value=asset.language;$('field-rights').value=asset.rights;}
  $('upload-dialog').showModal();
}
async function chooseFile(file){
  if(!file)return;
  state.upload=null;const epoch=++state.uploadEpoch;
  $('file-status').textContent='正在检查文件…';$('submit-asset').disabled=true;
  try{
    if(!file.size||file.size>state.config.maxFileBytes)throw new Error('文件不能为空，且不能超过 5 MB。');
    const allowed={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg'};
    const extension=file.name.split('.').pop().toLowerCase();
    if(!Object.hasOwn(allowed,extension))throw new Error('支持 PDF、PNG 或 JPG 文件。');
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败。'));reader.readAsDataURL(file);});
    const payload={fileName:file.name,contentType:allowed[extension],dataBase64:encoded};
    const result=await api('/api/analyze',{method:'POST',body:payload});
    if(epoch!==state.uploadEpoch)return;
    state.upload=payload;$('file-label').textContent=file.name;$('file-help').textContent=formatSize(result.file.sizeBytes)+(result.file.width?` · ${result.file.width} × ${result.file.height}`:' · PDF 文档');$('file-status').textContent='✓ 文件类型与大小检查通过';
    if(!$('field-title').value)$('field-title').value=file.name.replace(/\.[^.]+$/u,'');
  }catch(error){if(epoch===state.uploadEpoch){state.upload=null;$('file-status').textContent=error.message;toast(error.message,true);}}
  finally{if(epoch===state.uploadEpoch)$('submit-asset').disabled=false;}
}
function openDetail(asset){
  closePdf();
  state.selected=asset;$('detail-title').textContent=asset.title;$('detail-book').textContent=asset.bookTitle;$('detail-tags').replaceChildren(...tagsList(asset.tags).children);
  $('detail-description').textContent=asset.description||'分享者还没有填写说明。';$('translated-description').hidden=true;$('translation-help').textContent=state.config?.translationAvailable?'译文仅供阅读参考。':'翻译服务尚未启用。';
  $('translate-button').disabled=!state.config?.translationAvailable||!asset.description;$('translate-button').textContent=asset.language==='en'?'译成中文':'Translate to English';
  const meta=$('detail-meta');meta.replaceChildren();
  for(const [name,value] of [['分享者',asset.creatorName],['文件类型',asset.file.contentType==='application/pdf'?'PDF 文档':asset.file.contentType==='image/png'?'PNG 图片':'JPEG 图片'],['文件大小',formatSize(asset.file.sizeBytes)],['分享日期',formatDate(asset.createdAt)],['分享依据',{'original':'原创资料','public-domain':'公共领域','permission':'已获授权'}[asset.rights]]])meta.append(element('dt','',name),element('dd','',value));
  const preview=$('detail-preview');preview.replaceChildren();
  if(asset.mediaType==='cover'){const img=element('img');img.src=absolute(asset.fileUrl);img.alt=asset.bookTitle;preview.append(img);}
  else{renderPdf(asset,preview);}
  $('download-link').href=absolute(asset.fileUrl+'?download=1');$('download-link').setAttribute('download',asset.file.fileName);
  $('detail-dialog').showModal();
}
document.querySelectorAll('[data-upload]').forEach(button=>button.addEventListener('click',()=>openForm()));
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
$('upload-dialog').addEventListener('close',()=>{state.uploadEpoch++;});
$('detail-dialog').addEventListener('close',closePdf);
$('access-dialog').addEventListener('close',()=>{if(state.accessResolve){state.accessResolve($('access-dialog').returnValue==='allowed');state.accessResolve=null;}});
$('access-form').addEventListener('submit',async event=>{event.preventDefault();token=$('access-key').value;try{await api('/api/access',{method:'POST',body:{}});sessionStorage.setItem('bookshare-write-token',token);updateManage();$('access-dialog').close('allowed');toast('管理模式已开启。');}catch(error){$('access-error').textContent=error.message;$('access-error').hidden=false;}});
$('manage-button').addEventListener('click',async()=>{if(state.config?.writeAccessRequired&&token){token='';sessionStorage.removeItem('bookshare-write-token');updateManage();toast('已退出管理模式。');}else if(!state.config?.writeAccessRequired)toast('本机演示空间可以直接上传和维护资料。');else await ensureAccess();});
$('upload-file').addEventListener('change',event=>chooseFile(event.target.files[0]));
for(const name of ['dragenter','dragover'])$('dropzone').addEventListener(name,event=>{event.preventDefault();$('dropzone').classList.add('dragging');});
for(const name of ['dragleave','drop'])$('dropzone').addEventListener(name,event=>{event.preventDefault();$('dropzone').classList.remove('dragging');});
$('dropzone').addEventListener('drop',event=>chooseFile(event.dataTransfer.files[0]));
$('asset-form').addEventListener('submit',async event=>{
  event.preventDefault();$('form-error').hidden=true;
  if(!state.editing&&!state.upload){$('form-error').textContent='请先选择一份通过检查的文件。';$('form-error').hidden=false;return;}
  const body={title:$('field-title').value,bookTitle:$('field-book').value,creatorName:$('field-creator').value,description:$('field-description').value,tags:$('field-tags').value.split(/[,，]/u).map(t=>t.trim()).filter(Boolean),language:$('field-language').value,rights:$('field-rights').value};
  const editing=state.editing;const button=$('submit-asset');button.disabled=true;button.textContent=editing?'正在保存…':'正在发布…';
  try{await api('/api/assets'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:editing?body:{...body,upload:state.upload}});$('upload-dialog').close();await reload();toast(editing?'资料信息已更新。':'新资料已加入共享空间。');}
  catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;}
  finally{button.disabled=false;button.textContent=editing?'保存修改':'发布资料 ↗';}
});
$('edit-asset').addEventListener('click',async()=>{const asset=state.selected;$('detail-dialog').close();await openForm(asset);});
$('delete-asset').addEventListener('click',async()=>{if(await ensureAccess())$('delete-dialog').showModal();});
$('delete-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('confirm-delete');button.disabled=true;try{await api('/api/assets/'+state.selected.id,{method:'DELETE'});$('delete-dialog').close();$('detail-dialog').close();await reload();toast('资料已删除。');}catch(error){toast(error.message,true);}finally{button.disabled=false;}});
$('translate-button').addEventListener('click',async()=>{if(!await ensureAccess())return;const button=$('translate-button');const previous=button.textContent;button.disabled=true;button.textContent='正在翻译…';try{const result=await api('/api/translate',{method:'POST',body:{text:state.selected.description,to:state.selected.language==='en'?'zh-Hans':'en'}});$('translated-description').textContent=result.text;$('translated-description').hidden=false;}catch(error){toast(error.message,true);}finally{button.disabled=false;button.textContent=previous;}});
$('search').addEventListener('input',event=>{state.search=event.target.value;render();});
$('sort').addEventListener('change',event=>{state.sort=event.target.value;render();});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});render();}));
$('retry').addEventListener('click',()=>initialize());
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();$('search').focus();}});
async function initialize(){
  try{state.config=await api('/api/config');$('mode-label').textContent=state.config.mode==='azure'?'云端空间':'本机演示';$('storage-note').textContent=state.config.mode==='azure'?'资料存储于 Azure 云端共享空间':'资料保存在当前电脑的演示空间';updateManage();await reload();}
  catch(error){$('connection-error').hidden=false;$('asset-grid').replaceChildren();$('mode-label').textContent='连接中断';toast(error.message,true);}
}
initialize();
