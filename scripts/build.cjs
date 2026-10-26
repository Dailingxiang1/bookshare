'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const configuredOrigin=String(process.env.BOOKSHARE_API_BASE||'').trim();
  let apiOrigin;
  if(configuredOrigin){
    const url=new URL(configuredOrigin);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('BOOKSHARE_API_BASE must be an HTTPS origin without credentials, path, query or fragment.');
    apiOrigin=url.origin;
  }
  await require('./prepare-vendor.cjs').prepare();
  const root=path.join(__dirname,'..');const output=path.join(root,'dist');await fs.mkdir(output,{recursive:true});
  for(const file of ['index.html','app.js','styles.css','config.js'])await fs.copyFile(path.join(root,'web',file),path.join(output,file));
  if(apiOrigin)await fs.writeFile(path.join(output,'config.js'),'window.BOOKSHARE_CONFIG = Object.freeze('+JSON.stringify({apiBase:apiOrigin})+');\n');
  await fs.cp(path.join(root,'web/vendor'),path.join(output,'vendor'),{recursive:true});
  console.log('Built static frontend: dist/ (website + local PDF.js runtime'+(apiOrigin?' + configured public API origin':'')+')');
})().catch(e=>{console.error(e);process.exitCode=1;});
