'use strict';
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'application/pdf': '.pdf' };
const RIGHTS = new Set(['original', 'public-domain', 'permission']);
const EDIT_FIELDS = new Set(['title', 'bookTitle', 'creatorName', 'description', 'tags', 'language', 'rights']);

class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new AppError(status, code, message); }
function exactObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'invalid_body', '请提交 JSON 对象。');
  if (Object.keys(value).some(k => !allowed.has(k))) fail(400, 'unknown_fields', '请求包含不支持或不可修改的字段。');
  if (required.some(k => !Object.hasOwn(value, k))) fail(400, 'missing_fields', '请填写所有必需字段。');
  return value;
}
function text(value, field, max, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(value)) fail(400, 'invalid_field', `${field}格式不正确，最多 ${max} 个字符。`);
  return value.trim();
}
function metadata(body, partial = false) {
  exactObject(body, EDIT_FIELDS, partial ? [] : ['title', 'bookTitle', 'creatorName', 'rights']);
  if (partial && !Object.keys(body).length) fail(400, 'empty_update', '至少修改一个字段。');
  const cleaned = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'tags') {
      if (!Array.isArray(value) || value.length > 6) fail(400, 'invalid_tags', '最多添加 6 个标签。');
      cleaned.tags = [...new Set(value.map(t => text(t, '标签', 24)))];
    } else if (key === 'rights') {
      if (!RIGHTS.has(value)) fail(400, 'rights_required', '请选择原创、公共领域或已获授权的分享方式。');
      cleaned[key] = value;
    } else if (key === 'language') {
      if (!['zh-Hans', 'en', 'other'].includes(value)) fail(400, 'invalid_language', '请选择有效的资料语言。');
      cleaned[key] = value;
    } else cleaned[key] = text(value, {title:'资料标题', bookTitle:'书名', creatorName:'分享者', description:'资料说明'}[key], key === 'description' ? 1500 : 120, key === 'description');
  }
  if (!partial) return { description: '', tags: [], language: 'zh-Hans', ...cleaned };
  return cleaned;
}
function jpegDimensions(data) {
  let offset = 2;
  while (offset < data.length - 3) {
    if (data[offset++] !== 0xff) fail(400, 'invalid_file', 'JPEG 文件结构不正确。');
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > data.length) break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) fail(400, 'invalid_file', 'JPEG 文件不完整。');
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 8) break;
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  fail(400, 'invalid_file', '无法读取 JPEG 图片尺寸。');
}
function analyzeFile(body) {
  exactObject(body, new Set(['fileName','contentType','dataBase64']), ['fileName','contentType','dataBase64']);
  const fileName = text(body.fileName, '文件名', 180);
  if (/[\/\\\r\n]/u.test(fileName)) fail(400, 'invalid_filename', '文件名不能包含路径或换行符。');
  const contentType = body.contentType;
  if (!Object.hasOwn(MIME_EXTENSIONS, contentType)) fail(415, 'unsupported_file', '支持 PNG、JPEG 图片和 PDF 文档。');
  const encoded = body.dataBase64;
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) fail(413, 'file_too_large', '每份资料最大 5 MB。');
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) fail(400, 'invalid_base64', '文件编码无效。');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) fail(413, 'file_too_large', '文件不能为空，最大 5 MB。');
  let dimensions = {};
  if (contentType === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR') fail(400, 'mime_mismatch', '文件内容与 PNG 类型不符。');
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (contentType === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(400, 'mime_mismatch', '文件内容与 JPEG 类型不符。');
    dimensions = jpegDimensions(bytes);
  } else if (bytes.toString('ascii',0,5) !== '%PDF-' || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) fail(400, 'mime_mismatch', '文件内容与完整 PDF 文档不符。');
  if (dimensions.width !== undefined && (!dimensions.width || !dimensions.height || dimensions.width > 20000 || dimensions.height > 20000 || dimensions.width * dimensions.height > 100000000)) fail(400, 'image_too_large', '图片尺寸超出允许范围。');
  const extension = MIME_EXTENSIONS[contentType];
  const suppliedExtension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  if (!(contentType === 'image/jpeg' ? ['.jpg','.jpeg'] : [extension]).includes(suppliedExtension)) fail(400, 'extension_mismatch', '文件扩展名与内容类型不一致。');
  return { bytes, file: { fileName, contentType, sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), ...dimensions }, extension };
}
function validId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)) fail(400, 'invalid_id', '资料编号格式不正确。');
  return value;
}
function createDocument(body) {
  exactObject(body, new Set([...EDIT_FIELDS, 'upload']), ['title','bookTitle','creatorName','rights','upload']);
  const {upload, ...fields} = body;
  const cleaned = metadata(fields);
  const inspected = analyzeFile(upload);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return { document: { id, ...cleaned, mediaType: inspected.file.contentType === 'application/pdf' ? 'notes' : 'cover',
    file: {...inspected.file, blobName: `${id}${inspected.extension}`}, createdAt: timestamp, updatedAt: timestamp }, bytes: inspected.bytes };
}
function publicAsset(document) {
  const { _rid, _self, _attachments, _ts, _etag, ...safe } = document;
  return { ...safe, fileUrl: `/api/assets/${document.id}/file` };
}
module.exports = { AppError, MAX_FILE_BYTES, metadata, analyzeFile, validId, createDocument, publicAsset, fail, text };
