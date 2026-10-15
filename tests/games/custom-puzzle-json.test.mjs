import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomPuzzleJson, encodeCustomPuzzle, decodeCustomPuzzle } from '../../src/lib/games/custom-puzzle-json.js';

test('custom JSON contains exactly the puzzle data', () => {
  for (const puzzle of [
    { target: [0, 1, 0], epsilon: .2 },
    { circuit: [['H', 'H']] },
    { wires: 2, target: { '00': 1, '11': -1 } },
  ]) {
    const saved = structuredClone(puzzle), source = encodeCustomPuzzle(puzzle);
    assert.deepEqual(JSON.parse(source), saved);
    assert.deepEqual(decodeCustomPuzzle(source), saved);
    assert.deepEqual(puzzle, saved);
  }
});

test('late JSON file reads cannot replace newer files, manual edits or a reopened dialog', async () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, { value: '', open: false, files: [],
        addEventListener(type, action) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(action); },
        async emit(type) { for (const action of listeners.get(type) ?? []) await action({ target: this, preventDefault() {} }); },
        focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.emit('close'); },
      });
    }
    return nodes.get(id);
  };
  const pending = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { resolve, reject, file: { size: 10, text: () => promise } };
  };
  const ui = createCustomPuzzleJson({ get, game: 'quantum-golf', exportPuzzle: () => ({}), importPuzzle() {} });
  await get('input-json').emit('click');
  const fileInput = get('puzzle-json-file'), text = get('puzzle-json-text');
  const first = pending(), second = pending();
  fileInput.files = [first.file]; const firstRead = fileInput.emit('change');
  fileInput.files = [second.file]; const secondRead = fileInput.emit('change');
  second.resolve('new file'); await secondRead; first.resolve('old file'); await firstRead;
  assert.equal(text.value, 'new file');

  const editing = pending(); fileInput.files = [editing.file]; const editingRead = fileInput.emit('change');
  text.value = 'manual edits'; await text.emit('input');
  editing.resolve('stale file'); await editingRead;
  assert.equal(text.value, 'manual edits');

  const closed = pending(); fileInput.files = [closed.file]; const closedRead = fileInput.emit('change');
  ui.close(); await get('input-json').emit('click');
  closed.reject(new Error('stale failure')); await closedRead;
  assert.equal(text.value, 'manual edits');
  assert.equal(get('puzzle-json-status').textContent, '');
});

test('custom JSON transport rejects oversized and malformed input', () => {
  for (const source of ['{', 'null', '[]', 'false', '"text"', ' '.repeat(65_537)]) {
    assert.throws(() => decodeCustomPuzzle(source), RangeError);
  }
  assert.throws(() => encodeCustomPuzzle({ text: 'x'.repeat(65_536) }), /64 KB/);
  assert.throws(() => encodeCustomPuzzle(null), /object/);
});
