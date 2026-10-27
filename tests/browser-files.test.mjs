import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadBlob } from '../src/lib/browser/files.js';

function fixture(context, click = () => {}) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const links = [], created = [], revoked = [], pending = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement(tag) {
      assert.equal(tag, 'a');
      const link = { click() { click(this); } };
      links.push(link);
      return link;
    },
  } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  context.mock.method(URL, 'createObjectURL', blob => {
    const url = `blob:download-${created.length}`;
    created.push({ blob, url });
    return url;
  });
  context.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); });
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 0);
    pending.push(callback);
  });
  return { links, created, revoked, pending };
}

test('downloads keep each blob URL alive through its click and release it afterward', context => {
  const clicked = [], state = fixture(context, link => {
    assert.deepEqual(state.revoked, [], 'A click must not receive a revoked URL');
    clicked.push({ href: link.href, download: link.download });
  });
  const first = new Blob(['first']), second = new Blob(['second']);
  downloadBlob(first, 'first.json');
  downloadBlob(second, 'second.json');
  assert.deepEqual(state.created.map(entry => entry.blob), [first, second]);
  assert.deepEqual(clicked, [
    { href: 'blob:download-0', download: 'first.json' },
    { href: 'blob:download-1', download: 'second.json' },
  ]);
  assert.equal(state.pending.length, 2);
  for (const release of state.pending) release();
  assert.deepEqual(state.revoked, ['blob:download-0', 'blob:download-1']);
});

test('a failed download click still releases its object URL', context => {
  const failure = new Error('Download blocked');
  const state = fixture(context, () => { throw failure; });
  assert.throws(() => downloadBlob(new Blob(['data']), 'theory.json'), error => error === failure);
  assert.deepEqual(state.revoked, []);
  assert.equal(state.pending.length, 1);
  state.pending[0]();
  assert.deepEqual(state.revoked, ['blob:download-0']);
});
