'use strict';
const {createDocument} = require('./domain.cjs');

function originalPdf(title, lines) {
  const encode = value => value.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const content = `BT /F1 21 Tf 54 778 Td (${encode(title)}) Tj /F1 11 Tf 0 -34 Td\n` +
    lines.map(line=>`(${encode(line)}) Tj 0 -22 Td`).join('\n') + '\nET';
  const parts = [null, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets=[0];
  for(let i=1;i<parts.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${parts[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${parts.length}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${parts.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,'ascii');
}
async function seed(store) {
  if ((await store.list()).length) return;
  const examples = [
    {bookTitle:'爱丽丝梦游仙境',title:'从荒诞情节理解叙事规则',description:'一份原创示例笔记：记录人物、叙事视角与阅读问题。适合读书会讨论，也演示 PDF 文档分享。',tags:['文学','读书会'],language:'en',pdfTitle:'Alice Reading Notes',lines:['Original demonstration notes created for BookShare.','This file contains questions rather than copied book passages.','1. Identify a rule that changes between two scenes.','2. Ask how Alice responds when language becomes unreliable.','3. Compare a character perspective with the narrator perspective.','Discussion prompt: What makes a fictional rule feel consistent?']},
    {bookTitle:'傲慢与偏见',title:'人物关系与阅读讨论清单',description:'用问题清单整理人物关系、误解与判断。示例文件由本项目生成，正文可直接预览和下载。',tags:['人物分析','经典阅读'],language:'en',pdfTitle:'Pride and Prejudice Notes',lines:['Original demonstration notes created for BookShare.','No extracts from a published edition are included.','1. Draw a relationship map after your first reading.','2. Record a judgment that changes after new evidence.','3. Separate a character assumption from a stated fact.','Discussion prompt: How does social context affect interpretation?']},
    {bookTitle:'弗兰肯斯坦',title:'责任与创造主题阅读笔记',description:'围绕创造、责任和叙述视角整理的原创学习提纲。上传自己的笔记后，可以修改说明或删除资料。',tags:['主题阅读','学习笔记'],language:'en',pdfTitle:'Frankenstein Study Notes',lines:['Original demonstration notes created for BookShare.','Use this worksheet with your own reading observations.','1. Compare the perspectives used to tell the same event.','2. Track decisions and their consequences separately.','3. Collect questions about responsibility and care.','Discussion prompt: Who controls the information a reader receives?']},
  ];
  for(let i=0;i<examples.length;i++){
    const {pdfTitle,lines,...fields}=examples[i];
    const bytes=originalPdf(pdfTitle,lines);
    const {document}=createDocument({...fields,creatorName:'BookShare 示例',rights:'original',upload:{fileName:`bookshare-notes-${i+1}.pdf`,contentType:'application/pdf',dataBase64:bytes.toString('base64')}});
    const date=new Date(Date.now()-(i+1)*86400000).toISOString();
    document.createdAt=date;document.updatedAt=date;
    await store.create(document,bytes);
  }
}
module.exports = {seed,originalPdf};
