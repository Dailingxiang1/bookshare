'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
for(const dir of ['server','scripts','tests','infra'])if(fs.existsSync(dir))for(const file of fs.readdirSync(dir))if(file.endsWith('.cjs'))cp.execFileSync(process.execPath,['--check',path.join(dir,file)],{stdio:'inherit'});
cp.execFileSync(process.execPath,['--check','web/app.js'],{stdio:'inherit'});
console.log('JavaScript syntax checks passed.');
