import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplayShare } from '../../src/lib/games/replay-share.js';
import { replayWorkers } from './replay-worker-fixture.mjs';

function setup(context, { formats = ['image/gif', 'image/png'], clipboard = true } = {}) {
  const { ReplayWorker, gifs: jobs, images } = replayWorkers();
  const downloads = [], writes = [], revoked = [], blobs = new Map();
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
  const previous = ['document', 'navigator', 'ClipboardItem', 'Worker'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
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
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: ReplayWorker });
  context.mock.method(URL, 'createObjectURL', blob => {
    const url = `blob:replay-${blobs.size}`; blobs.set(url, blob); return url;
  });
  context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const sharing = createReplayShare({ get, createWorker: () => new ReplayWorker() });
  return {
    sharing, get, dialog, trigger, jobs, images, downloads, writes, revoked, blobs,
    open: (round = { sequence: 'HH' }, filename = 'round.gif') => sharing.open(trigger, round, filename),
    click: id => get(id).dispatch('click'),
    failClipboard: error => { clipboardFailure = error; },
    delayClipboard: promise => { clipboardDelay = promise; },
  };
}

const png = () => new Blob(['png'], { type: 'image/png' });
const gif = () => new Blob(['GIF89a'], { type: 'image/gif' });
async function preview(h) {
  const opening = h.open();
  const image = png();
  h.images.at(-1).resolve(image);
  await opening;
  return image;
}

test('opening sharing renders a copyable still without generating or downloading a GIF', async context => {
  const h = setup(context), opening = h.open();
  assert.equal(h.dialog.open, true);
  assert.equal(h.get('download-gif').disabled, false);
  assert.equal(h.get('copy-gif').disabled, true);
  assert.equal(h.get('share-preview').hidden, true);
  assert.match(h.get('share-status').textContent, /Preparing image/);
  const image = png();
  h.images[0].resolve(image); await opening;
  assert.equal(h.get('share-preview').hidden, false);
  assert.equal(h.blobs.get(h.get('share-preview').src), image);
  assert.equal(h.get('copy-gif').disabled, false);
  assert.equal(h.get('copy-gif').textContent, 'Copy image');
  assert.equal(h.get('share-status').textContent, '');
  assert.equal(h.jobs.length, 0);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.writes.length, 0);
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/png'], image);
  assert.equal(h.get('share-status').textContent, 'Image copied.');
  await h.open({ sequence: 'XX' });
  assert.equal(h.images.length, 1, 'An already open dialog does not duplicate its preview');
  const url = h.get('share-preview').src;
  await h.click('close-share');
  assert.equal(h.trigger.focusCount, 1);
  assert.deepEqual(h.revoked, [url]);
  await h.click('download-gif');
  assert.equal(h.jobs.length, 0, 'A closed dialog cannot export');
});

test('Download generates one GIF and reuses it while retaining the original still', async context => {
  const h = setup(context), image = await preview(h), previewUrl = h.get('share-preview').src;
  const pending = h.click('download-gif'), job = h.jobs[0];
  assert.equal(job.worker.terminated, false);
  assert.equal(job.worker.request.imageOnly, false, 'The still is not regenerated with the replay');
  assert.equal(h.get('copy-gif').disabled, false, 'The still remains copyable while encoding');
  job.progress(0.42);
  assert.match(h.get('share-status').textContent, /42%/);
  await h.click('download-gif');
  assert.equal(h.jobs.length, 1);
  const animation = gif();
  job.resolve(animation); await pending;
  const saved = h.downloads[0];
  assert.deepEqual(await h.blobs.get(saved.href).arrayBuffer(), await animation.arrayBuffer());
  assert.equal(saved.filename, 'round.gif');
  assert.equal(saved.parent, h.dialog);
  assert.equal(h.dialog.children.length, 0);
  assert.equal(h.get('share-preview').src, previewUrl);
  assert.equal(h.blobs.get(previewUrl), image);
  assert.equal(h.get('copy-gif').textContent, 'Copy the GIF');
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/gif'], h.blobs.get(saved.href));
  await h.click('download-gif');
  assert.equal(h.jobs.length, 1);
  assert.equal(h.downloads.length, 2);
  assert.equal(h.downloads[1].href, saved.href);
  h.sharing.close();
  assert.deepEqual(new Set(h.revoked), new Set([previewUrl, saved.href]));
  assert.equal(h.revoked.length, 2);
});

test('PNG-only clipboard keeps the ready image through download and clipboard rejection', async context => {
  const h = setup(context, { formats: ['image/png'] }), image = await preview(h);
  const pending = h.click('download-gif');
  h.jobs[0].resolve(gif()); await pending;
  assert.equal(h.get('copy-gif').textContent, 'Copy image');
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/png'], image);
  h.failClipboard(new DOMException('Denied', 'NotAllowedError'));
  await h.click('copy-gif');
  assert.match(h.get('share-status').textContent, /download/i);
  await h.click('download-gif');
  assert.equal(h.downloads.length, 2);
  assert.equal(h.jobs.length, 1);
  h.sharing.close();
});

test('preview and download finish independently, including download before the image', async context => {
  const h = setup(context, { formats: ['image/png'] }), opening = h.open();
  const pending = h.click('download-gif');
  h.jobs[0].progress(0.5);
  h.jobs[0].resolve(gif()); await pending;
  assert.equal(h.downloads.length, 1);
  assert.equal(h.get('share-preview').hidden, true);
  assert.match(h.get('share-status').textContent, /Preparing image/);
  const image = png();
  h.images[0].resolve(image); await opening;
  assert.equal(h.get('copy-gif').disabled, false);
  assert.equal(h.get('share-status').textContent, '');
  await h.click('copy-gif');
  assert.equal(h.writes[0][0].items['image/png'], image);
  h.sharing.close();
});

test('preview failure leaves download usable; GIF failure leaves the still copyable and allows retry', async context => {
  const h = setup(context), opening = h.open();
  h.images[0].reject(new Error('PNG unavailable')); await opening;
  assert.match(h.get('share-status').textContent, /image.*download/);
  const pending = h.click('download-gif');
  h.jobs[0].resolve(gif()); await pending;
  assert.equal(h.downloads.length, 1);
  h.sharing.close();
  const image = await preview(h);
  const failed = h.click('download-gif');
  h.jobs[1].reject(new Error('Encoding failed')); await failed;
  assert.equal(h.get('download-gif').disabled, false);
  assert.equal(h.get('copy-gif').disabled, false);
  assert.match(h.get('share-status').textContent, /Could not prepare the replay/);
  await h.click('copy-gif');
  assert.equal(h.writes.at(-1)[0].items['image/png'], image);
  const retry = h.click('download-gif');
  h.jobs[2].resolve(gif()); await retry;
  assert.equal(h.downloads.length, 2);
  h.sharing.close();
});

test('clipboard absence or unsupported formats do not hide the preview or prevent download', async context => {
  for (const options of [{ clipboard: false }, { formats: [] }]) {
    const h = setup(context, options);
    await preview(h);
    assert.equal(h.get('share-preview').hidden, false);
    assert.equal(h.get('copy-gif').disabled, true);
    const pending = h.click('download-gif');
    h.jobs[0].resolve(gif()); await pending;
    assert.equal(h.downloads.length, 1);
    assert.equal(h.get('copy-gif').disabled, true);
    h.sharing.close();
  }
});

test('closing cancels both jobs; late previews, GIFs and clipboard replies cannot affect a new dialog', async context => {
  const h = setup(context, { formats: ['image/png'] }), opening = h.open();
  const abandoned = h.click('download-gif'), oldImage = h.images[0], oldGif = h.jobs[0];
  h.dialog.close();
  assert.equal(oldImage.worker.terminated, true);
  assert.equal(oldGif.worker.terminated, true);
  const current = h.open({ sequence: 'XX' }, 'replacement.gif');
  const status = h.get('share-status').textContent;
  oldGif.progress(0.99);
  oldImage.resolve(png()); oldGif.resolve(gif());
  await Promise.all([opening, abandoned]);
  assert.equal(h.get('share-status').textContent, status);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.downloads.length, 0);
  const image = png();
  h.images[1].resolve(image); await current;
  let finishCopy;
  h.delayClipboard(new Promise(resolve => { finishCopy = resolve; }));
  const copying = h.click('copy-gif');
  h.sharing.close();
  const next = h.open();
  const nextStatus = h.get('share-status').textContent;
  finishCopy(); await copying;
  assert.equal(h.get('share-status').textContent, nextStatus);
  assert.equal(h.get('copy-gif').disabled, true);
  h.sharing.close();
  h.images[2].resolve(png()); await next;
  assert.equal(h.get('share-preview').hidden, true);
  assert.equal(h.jobs.length, 1);
});
