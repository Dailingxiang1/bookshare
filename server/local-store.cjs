'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fail } = require('./domain.cjs');

class LocalStore {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  async initialize() {
    await fs.mkdir(path.join(this.directory, 'blobs'), {recursive:true});
    try { await fs.writeFile(path.join(this.directory,'assets.json'), '[]', {flag:'wx'}); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  async read() { return JSON.parse(await fs.readFile(path.join(this.directory,'assets.json'), 'utf8')); }
  async write(items) {
    const target = path.join(this.directory,'assets.json');
    const temporary = target + '.next';
    await fs.writeFile(temporary, JSON.stringify(items,null,2));
    await fs.rename(temporary, target);
  }
  transact(work) {
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async list() { await this.queue; return (await this.read()).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)); }
  async get(id) { const asset = (await this.list()).find(a => a.id === id); if (!asset) fail(404,'asset_not_found','这份资料不存在或已被删除。'); return asset; }
  async create(document, bytes) {
    return this.transact(async () => {
      const items = await this.read();
      const blobPath = path.join(this.directory, 'blobs', document.file.blobName);
      await fs.writeFile(blobPath, bytes, {flag:'wx'});
      try { await this.write([...items,document]); }
      catch (e) { await fs.unlink(blobPath); throw e; }
      return document;
    });
  }
  async update(id, changes) {
    return this.transact(async () => {
      const items = await this.read();
      const index = items.findIndex(a => a.id === id);
      if (index === -1) fail(404,'asset_not_found','这份资料不存在或已被删除。');
      items[index] = {...items[index], ...changes, updatedAt:new Date().toISOString()};
      await this.write(items);
      return items[index];
    });
  }
  async delete(id) {
    return this.transact(async () => {
      const items = await this.read();
      const asset = items.find(a => a.id === id);
      if (!asset) fail(404,'asset_not_found','这份资料不存在或已被删除。');
      // Write metadata first: a file deletion failure is recoverable by cleanup;
      // deleting the file first could leave a visible record with missing media.
      await this.write(items.filter(a => a.id !== id));
      try { await fs.unlink(path.join(this.directory,'blobs',asset.file.blobName)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    });
  }
  async file(asset) { return fs.readFile(path.join(this.directory,'blobs',asset.file.blobName)); }
}
module.exports = { LocalStore };
