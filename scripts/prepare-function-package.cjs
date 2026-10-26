'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const root=path.resolve(__dirname,'..');const parent=path.join(root,'.local/packages');const destination=path.resolve(process.argv[2]||'.');
  if(!destination.startsWith(parent+path.sep))throw new Error('Function staging must stay inside .local/packages.');
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
  const minimal={name:pkg.name,version:pkg.version,private:true,main:pkg.main,engines:pkg.engines,dependencies:pkg.dependencies};
  delete lock.packages[''].devDependencies;
  lock.packages=Object.fromEntries(Object.entries(lock.packages).filter(([,entry])=>!entry.dev));
  await fs.writeFile(path.join(destination,'package.json'),JSON.stringify(minimal,null,2)+'\n');
  await fs.writeFile(path.join(destination,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
