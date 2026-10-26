'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.join(__dirname,'..');
const testsDirectory=path.join(root,'tests');
const files=fs.readdirSync(testsDirectory).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>path.join(testsDirectory,name));
if(files.length===0)throw new Error('No CI test files found.');
// Git checkouts have no ignored reports directory. Create it before Node opens
// the JUnit stream; spec output also keeps failures visible in pipeline logs.
const reportPath=path.join(root,'reports','junit.xml');
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
console.log('Running CI tests with Node.js '+process.version);
const result=spawnSync(process.execPath,[
  '--test','--test-reporter=spec','--test-reporter=junit',
  '--test-reporter-destination=stdout','--test-reporter-destination='+reportPath,
  ...files
],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
