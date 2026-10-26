'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
async function prepare(){
  const root=path.join(__dirname,'..');const source=path.join(root,'node_modules/pdfjs-dist');const destination=path.join(root,'web/vendor');
  await fs.mkdir(destination,{recursive:true});
  for(const file of ['pdf.mjs','pdf.worker.mjs'])await fs.copyFile(path.join(source,'build',file),path.join(destination,file));
  for(const dir of ['cmaps','standard_fonts','wasm'])await fs.cp(path.join(source,dir),path.join(destination,dir),{recursive:true});
  await fs.copyFile(path.join(source,'LICENSE'),path.join(destination,'LICENSE.txt'));
  console.log('Prepared Mozilla PDF.js and its local worker, character maps and fonts.');
}
if(require.main===module)prepare().catch(error=>{console.error('PDF preview dependencies are missing. Run npm ci first. '+error.message);process.exitCode=1;});
module.exports={prepare};
