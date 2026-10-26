'use strict';
const crypto = require('node:crypto');
const {text,fail} = require('./domain.cjs');

function createTranslator({key,region,endpoint='https://api.cognitive.microsofttranslator.com',fetchImpl=fetch}) {
  if (!key) return null;
  const origin = new URL(endpoint);
  if (origin.protocol !== 'https:' || !(origin.hostname === 'api.cognitive.microsofttranslator.com' || origin.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error('Use an official Azure Translator HTTPS endpoint.');
  return async body => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>!['text','to'].includes(k))) fail(400,'invalid_translation','请提交需要翻译的说明与目标语言。');
    const source = text(body.text,'翻译内容',1500);
    if (!['en','zh-Hans'].includes(body.to)) fail(400,'invalid_language','翻译目标支持中文或英文。');
    const url = new URL('/translate',origin);
    url.search = new URLSearchParams({'api-version':'3.0',to:body.to}).toString();
    const response = await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json','Ocp-Apim-Subscription-Key':key,
      ...(region?{'Ocp-Apim-Subscription-Region':region}:{}),'X-ClientTraceId':crypto.randomUUID()},body:JSON.stringify([{Text:source}]),signal:AbortSignal.timeout(15000)});
    if (!response.ok) fail(503,'translator_unavailable','Azure 翻译服务暂不可用，请稍后重试。');
    const data = await response.json();
    const result = data?.[0]?.translations?.[0];
    if (!result || typeof result.text !== 'string') fail(503,'translator_unavailable','翻译服务没有返回有效结果。');
    return {text:result.text,to:result.to,provider:'Azure AI Translator'};
  };
}
module.exports = {createTranslator};
