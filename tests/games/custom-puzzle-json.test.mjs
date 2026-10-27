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

function surface() {
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
  const ui = createCustomPuzzleJson({ get, game: 'quantum-golf', exportPuzzle: () => ({}), importPuzzle() {} });
  return { get, ui };
}

test('late JSON file reads cannot replace newer files, manual edits or a reopened dialog', async () => {
  const { get, ui } = surface();
  const pending = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { resolve, reject, file: { size: 10, text: () => promise } };
  };
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

test('JSON size limits use UTF-8 bytes for ASCII, multibyte characters and surrogate pairs', () => {
  // The pretty-printed object adds 16 ASCII bytes around the text value.
  for (const [unit, count] of [['x', 65_520], ['é', 32_760], ['雪', 21_840], ['🧪', 16_380],
    ['\ud800', 10_920], ['\udfff', 10_920]]) {
    const puzzle = { text: unit.repeat(count) }, source = JSON.stringify(puzzle, null, 2);
    assert.equal(new Blob([source]).size, 65_536, 'Each example sits exactly at the file-size boundary');
    assert.equal(encodeCustomPuzzle(puzzle), source);
    assert.deepEqual(decodeCustomPuzzle(source), puzzle);
    assert.throws(() => encodeCustomPuzzle({ text: puzzle.text + 'x' }), /64 KB/);
    assert.throws(() => decodeCustomPuzzle(source + ' '), /64 KB/);
  }
  const rawSurrogate = '{"text":"' + '\ud800'.repeat(21_842) + '"}';
  assert.ok(rawSurrogate.length < 65_536 && new Blob([rawSurrogate]).size > 65_536);
  assert.throws(() => decodeCustomPuzzle(rawSurrogate), /64 KB/, 'Unescaped lone surrogates also count as UTF-8 replacement bytes');
});

test('obviously invalid or oversized JSON never allocates a UTF-8 buffer', context => {
  context.mock.method(TextEncoder.prototype, 'encode', () => assert.fail('Reject this input before byte encoding'));
  const untrusted = { get length() { assert.fail('Do not inspect or coerce a non-string input'); } };
  for (const source of [untrusted, null, 'x'.repeat(65_537)]) {
    assert.throws(() => decodeCustomPuzzle(source), /64 KB/);
  }
  assert.throws(() => encodeCustomPuzzle({ text: 'x'.repeat(65_536) }), /64 KB/);
});

test('file uploads use the same byte boundary and reject oversized files before reading them', async () => {
  const { get } = surface();
  await get('input-json').emit('click');
  const input = get('puzzle-json-file'), text = get('puzzle-json-text');
  const source = JSON.stringify({ text: 'é'.repeat(32_760) }, null, 2);
  input.files = [new Blob([source])]; await input.emit('change');
  assert.equal(text.value, source);
  input.files = [{ size: 65_537, text() { assert.fail('An oversized file must not be read'); } }];
  await input.emit('change');
  assert.match(get('puzzle-json-status').textContent, /64 KB/);
  assert.equal(text.value, source, 'A rejected file keeps the previous editable JSON');
});
