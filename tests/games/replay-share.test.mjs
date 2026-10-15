import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplayShare } from '../../src/lib/games/replay-share.js';

function setup(context, { formats = ['image/gif', 'image/png'], clipboard = true } = {}) {
  const jobs = [], downloads = [], writes = [], revoked = [], blobs = new Map();
  let clipboardFailure, clipboardDelay;
  class Element {
    constructor(tagName = 'BUTTON') {
      this.tagName = tagName; this.listeners = new Map(); this.children = [];
      this.hidden = false; this.disabled = false; this.open = false; this.textContent = '';
      this.focusCount = 0;
    }
    addEventListener(type, callback) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
    }
    dispatch(type) {
      return Promise.all((this.listeners.get(type) ?? []).map(callback => callback({ preventDefault() {} })));
    }
    click() {
      if (this.tagName === 'A') downloads.push({ href: this.href, filename: this.download, parent: this.parentElement });
      return this.disabled ? Promise.resolve() : this.dispatch('click');
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    removeAttribute(name) { delete this[name]; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
    focus() { this.focusCount++; }
  }
  const elements = new Map(['share-dialog', 'download-gif', 'copy-gif', 'share-preview', 'share-status', 'close-share']
    .map(id => [id, new Element(id === 'share-dialog' ? 'DIALOG' : 'BUTTON')]));
  const get = id => elements.get(id), dialog = get('share-dialog'), trigger = new Element();
  const previous = ['document', 'navigator', 'ClipboardItem'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Element(tag.toUpperCase()) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: clipboard ? {
    async write(items) { writes.push(items); if (clipboardDelay) await clipboardDelay; if (clipboardFailure) throw clipboardFailure; },
  } : undefined } });
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class {
    constructor(items) { this.items = items; }
    static supports(type) { return formats.includes(type); }
  } });
  context.mock.method(URL, 'createObjectURL', blob => {
    const url = `blob:replay-${blobs.size}`; blobs.set(url, blob); return url;
  });
  context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  // Intentionally ignore cancellation: late callbacks must also be guarded.
  const sharing = createReplayShare({ get, createGif: (round, options) => new Promise((resolve, reject) => jobs.push({ round, options, resolve, reject })) });
  return {
    sharing, get, dialog, trigger, jobs, downloads, writes, revoked, blobs,
    open: (round = { sequence: 'HH' }, filename = 'round.gif') => sharing.open(trigger, round, filename),
    click: id => get(id).dispatch('click'),
    failClipboard: error => { clipboardFailure = error; },
    delayClipboard: promise => { clipboardDelay = promise; },
  };
}

test('opening and closing sharing never starts an encoder or allocates replay URLs', async context => {
  const h = setup(context);
  h.open();
  assert.equal(h.dialog.open, true);
  assert.equal(h.get('download-gif').hidden, false);
  assert.equal(h.get('download-gif').disabled, false);
  assert.equal(h.get('copy-gif').disabled, true);
  assert.equal(h.get('share-preview').hidden, true);
  assert.equal(h.get('share-status').textContent, '');
  await h.click('copy-gif');
  h.open({ sequence: 'XX' }, 'other.gif');
  assert.equal(h.jobs.length, 0);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.writes.length, 0);
  await h.click('close-share');
  assert.equal(h.dialog.open, false);
  assert.equal(h.trigger.focusCount, 1);
  assert.deepEqual(h.revoked, []);
  await h.click('download-gif');
  assert.equal(h.jobs.length, 0, 'A closed dialog cannot start an export');
});

test('one Download click encodes and saves, while subsequent clicks reuse the completed replay', async context => {
  const h = setup(context), round = { label: 'Level : 2', sequence: 'HH' };
  h.open(round, 'level-2.gif');
  const pending = h.click('download-gif'), job = h.jobs[0];
  assert.equal(h.jobs.length, 1);
  assert.equal(job.round, round);
  assert.equal(job.options.signal.aborted, false);
  assert.equal(h.get('download-gif').disabled, true);
  assert.equal(h.downloads.length, 0);
  job.options.onProgress(0.42);
  assert.match(h.get('share-status').textContent, /42%/);
  await h.click('download-gif');
  assert.equal(h.jobs.length, 1, 'Even a synthetic repeated click cannot start a duplicate worker');
  const gif = new Blob(['GIF89a'], { type: 'image/gif' });
  assert.equal(job.options.onImage, undefined, 'Direct GIF copying does not request a redundant PNG');
  job.resolve(gif); await pending;
  assert.equal(h.downloads.length, 1, 'The initial click saves automatically after generation');
  const saved = h.downloads[0];
  assert.equal(h.blobs.get(saved.href), gif);
  assert.equal(saved.filename, 'level-2.gif');
  assert.equal(saved.parent, h.dialog, 'A download anchor stays inside the active modal');
  assert.equal(h.dialog.children.length, 0, 'Temporary download anchors are removed');
  assert.equal(h.get('download-gif').disabled, false);
  assert.equal(h.get('share-preview').src, saved.href);
  assert.equal(h.get('share-preview').hidden, false);
  assert.equal(h.get('copy-gif').disabled, false);
  assert.equal(h.writes.length, 0, 'Generation does not write the clipboard without a copy gesture');
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/gif'], gif);
  await h.click('download-gif');
  assert.equal(h.jobs.length, 1);
  assert.equal(h.downloads.length, 2);
  assert.equal(h.downloads[1].href, saved.href);
  h.sharing.close();
  assert.deepEqual(h.revoked, [saved.href], 'A shared preview/download URL is released only once');
});

test('PNG clipboard fallback preserves the GIF download and handles clipboard rejection', async context => {
  const h = setup(context, { formats: ['image/png'] });
  h.open();
  const pending = h.click('download-gif'), job = h.jobs[0];
  const png = new Blob(['png'], { type: 'image/png' }), gif = new Blob(['GIF89a'], { type: 'image/gif' });
  job.options.onImage(png); job.resolve(gif); await pending;
  const preview = h.get('share-preview').src, saved = h.downloads[0].href;
  assert.notEqual(preview, saved);
  assert.equal(h.blobs.get(preview), png);
  assert.equal(h.blobs.get(saved), gif);
  assert.equal(h.get('copy-gif').textContent, 'Copy image');
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/png'], png);
  h.failClipboard(new DOMException('Denied', 'NotAllowedError'));
  await h.click('copy-gif');
  assert.match(h.get('share-status').textContent, /download/i);
  await h.click('download-gif');
  assert.equal(h.downloads.length, 2);
  assert.equal(h.jobs.length, 1);
  h.sharing.close();
  assert.deepEqual(new Set(h.revoked), new Set([preview, saved]));
  assert.equal(h.revoked.length, 2);
});

test('export failures allow a direct retry and clipboard absence does not prevent downloading', async context => {
  const h = setup(context, { clipboard: false });
  h.open();
  const failed = h.click('download-gif');
  assert.equal(h.jobs[0].options.onImage, undefined, 'Downloading without clipboard support does not request a PNG');
  h.jobs[0].reject(new Error('Encoding failed')); await failed;
  assert.equal(h.dialog.open, true);
  assert.equal(h.get('download-gif').disabled, false);
  assert.equal(h.get('download-gif').hidden, false);
  assert.match(h.get('share-status').textContent, /could|failed|unable|unavailable/i);
  assert.equal(h.get('copy-gif').disabled, true);
  assert.equal(h.blobs.size, 0);
  const retry = h.click('download-gif');
  assert.equal(h.jobs.length, 2);
  h.jobs[1].resolve(new Blob(['GIF89a'], { type: 'image/gif' })); await retry;
  assert.equal(h.downloads.length, 1);
  assert.equal(h.get('copy-gif').disabled, true);
  assert.equal(h.get('share-preview').hidden, false);
  h.sharing.close();
});

test('closed export jobs cannot update a replacement dialog or download a stale replay', async context => {
  const h = setup(context, { formats: ['image/png'] });
  h.open();
  const abandoned = h.click('download-gif'), stale = h.jobs[0];
  h.dialog.close();
  assert.equal(stale.options.signal.aborted, true, 'Native dialog closing cancels work');
  h.open({ sequence: 'XX' }, 'replacement.gif');
  const current = h.click('download-gif'), replacement = h.jobs[1];
  const status = h.get('share-status').textContent;
  stale.options.onProgress(0.99);
  stale.options.onImage(new Blob(['old png'], { type: 'image/png' }));
  stale.resolve(new Blob(['old gif'], { type: 'image/gif' })); await abandoned;
  assert.equal(h.get('share-status').textContent, status);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.downloads.length, 0);
  const png = new Blob(['current png'], { type: 'image/png' });
  replacement.options.onImage(png);
  replacement.resolve(new Blob(['current gif'], { type: 'image/gif' })); await current;
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].filename, 'replacement.gif');
  stale.options.onImage(new Blob(['late png'], { type: 'image/png' }));
  let finishCopy;
  h.delayClipboard(new Promise(resolve => { finishCopy = resolve; }));
  const copying = h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/png'], png);
  h.sharing.close();
  h.open();
  const idleStatus = h.get('share-status').textContent;
  finishCopy(); await copying;
  assert.equal(h.get('share-status').textContent, idleStatus, 'An earlier clipboard result cannot overwrite a new dialog');
  assert.equal(h.get('copy-gif').disabled, true);
  assert.equal(h.get('share-preview').hidden, true);
  assert.equal(h.jobs.length, 2, 'Reopening remains idle until Download is clicked');
  h.sharing.close();
});
