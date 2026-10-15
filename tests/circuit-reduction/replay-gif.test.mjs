import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/circuit-reduction-gif-worker.js';
import { RULES, cloneCircuit, solveShortest, sequenceCost, moveCost } from '../../src/lib/circuit-reduction/engine.js';

function replace(context, object, key, value) {
  const original = object[key];
  object[key] = value;
  context.after(() => { object[key] = original; });
}

function canvases(context) {
  const surfaces = [];
  replace(context, globalThis, 'OffscreenCanvas', class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = [];
      let commands = [];
      const record = name => (...args) => commands.push({ name, args, fillStyle: this.context.fillStyle, strokeStyle: this.context.strokeStyle, lineWidth: this.context.lineWidth });
      this.context = Object.fromEntries(['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText'].map(name => [name, record(name)]));
      this.context.getImageData = (_x, _y, w, h) => {
        this.frames.push(commands); commands = [];
        this.pixels ??= new Uint8ClampedArray(w * h * 4);
        return { data: this.pixels };
      };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  });
  return surfaces;
}

// Inspect actual GIF blocks, dimensions, palettes, frame controls and the trailer.
function gifFrames(bytes, expectedHeight) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
  const word = index => bytes[index] | bytes[index + 1] << 8;
  assert.equal(word(6), 960); assert.equal(word(8), expectedHeight);
  let position = 13, control;
  assert.ok(bytes[10] & 128, 'The replay has a global palette');
  position += 3 * (1 << ((bytes[10] & 7) + 1));
  const frames = [];
  const skipBlocks = () => { let length; while ((length = bytes[position++])) position += length; };
  while (position < bytes.length) {
    const marker = bytes[position++];
    if (marker === 0x3b) { assert.equal(position, bytes.length); return frames; }
    if (marker === 0x21) {
      const kind = bytes[position++];
      if (kind === 0xf9) {
        assert.equal(bytes[position], 4);
        control = { delay: word(position + 2) * 10, transparent: Boolean(bytes[position + 1] & 1) };
      }
      skipBlocks();
    } else if (marker === 0x2c) {
      assert.equal(word(position + 4), 960); assert.equal(word(position + 6), expectedHeight);
      const packed = bytes[position + 8]; position += 9;
      if (packed & 128) position += 3 * (1 << ((packed & 7) + 1));
      const depth = bytes[position++]; assert.ok(depth >= 2 && depth <= 8);
      const firstBlock = bytes[position]; assert.ok(firstBlock > 0, 'Encoded image data is present');
      skipBlocks(); frames.push(control);
    } else assert.fail(`Unexpected GIF block ${marker}`);
  }
  assert.fail('Missing GIF trailer');
}

const texts = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
const selectedCells = frame => frame.filter(command => command.name === 'strokeRect' && command.strokeStyle === '#9ad9d1' && command.lineWidth === 1);
const move = (rule, row = 0, column = 0) => ({ rule, row, column });
const round = { label: 'Level 1 · Two flips', circuit: [['.', 'X', 'X', '.']], sequence: [move('cancel-x', 0, 1)], optimalMoves: 1 };

test('GIF shows every rule window, includes the full replay, and ends on an empty identity circuit', context => {
  const surfaces = canvases(context);
  for (const rule of RULES) {
    let circuit = cloneCircuit(rule.left), row = 0;
    if (circuit.length === 1 && circuit[0].some(cell => cell.endsWith('U'))) circuit.push(circuit[0].map(cell => cell.endsWith('U') ? 'ZD' : '.'));
    if (circuit.length === 1 && circuit[0].some(cell => cell.endsWith('D'))) {
      circuit.unshift(circuit[0].map(cell => cell.endsWith('D') ? 'ZU' : '.')); row = 1;
    }
    // A circuit followed by its reverse is identity because each column is involutive.
    circuit = circuit.map(line => [...line, ...[...line].reverse()]);
    const solution = solveShortest(circuit, { maxDepth: 18, maxNodes: 25000 });
    assert.equal(solution.status, 'optimal', rule.id);
    const sequence = [move(rule.id, row), move(rule.id, row), ...solution.solution], saved = cloneCircuit(circuit), progress = [];
    let finalCanvas;
    const bytes = encodeReplay({ ...round, circuit, sequence, optimalMoves: solution.optimalMoves }, value => progress.push(value), canvas => { finalCanvas = canvas; });
    const surface = surfaces.at(-1), frames = gifFrames(bytes, 224 + circuit.length * 80);
    assert.equal(frames.length, sequence.length + 1);
    assert.equal(surface.frames.length, frames.length);
    assert.equal(finalCanvas, surface, 'PNG callback receives the completed encoded canvas');
    assert.equal(selectedCells(surface.frames[0]).length, rule.left.length * rule.left[0].length, rule.id);
    assert.ok(texts(surface.frames[0]).includes(`${moveCost(sequence[0]) ? 'Move 1' : 'Layout'}: ${rule.title}`));
    const final = surface.frames.at(-1);
    assert.ok(texts(final).includes('Identity circuit · GG'));
    assert.ok(texts(final).includes(`My score: ${sequenceCost(sequence)} moves · Optimal: ${solution.optimalMoves}`));
    assert.ok(surface.frames.every(frame => !texts(frame).includes('⊕')), 'Every target plus is drawn with paths rather than a font glyph');
    assert.equal(final.filter(command => command.name === 'arc').length, 0, 'No gates remain in the final image');
    assert.equal(final.filter(command => command.name === 'strokeRect').length, 0, 'No Hadamards or selected cells remain');
    assert.equal(frames[0].delay, 1000); assert.equal(frames.at(-1).delay, 1800);
    assert.ok(frames.every(frame => frame.transparent === false));
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
    assert.deepEqual(circuit, saved, 'Export leaves the saved starting circuit intact');
  }
});

test('Padding frames redraw changed circuit widths and finish the complete sequence', context => {
  const surfaces = canvases(context);
  const sequence = [move('insert-column', 0, 1), move('remove-column', 0, 1), move('cancel-x')];
  const frames = gifFrames(encodeReplay({ ...round, circuit: [['X', 'X']], sequence }), 304);
  assert.equal(frames.length, 4);
  const rendered = surfaces[0].frames;
  assert.ok(texts(rendered[0]).includes('Layout: Identity spacing · free'));
  assert.ok(texts(rendered[1]).includes('Layout: Identity spacing · free'));
  const wireLengths = rendered.map(frame => {
    const start = frame.find(command => command.name === 'moveTo').args[0];
    const end = frame.find(command => command.name === 'lineTo').args[0];
    return end - start;
  });
  assert.deepEqual(wireLengths, [112, 168, 112, 112]);
  assert.equal(selectedCells(rendered[2]).length, 2);
  assert.ok(texts(rendered[3]).includes('Identity circuit · GG'));
  assert.ok(texts(rendered[3]).includes('My score: 1 moves · Optimal: 1'));
});

test('wire spacing and one-click identity compaction export every free layout with the true rewrite score', context => {
  const surfaces = canvases(context);
  const sequence = [
    { ...move('insert-space', 0, 1), count: 100 }, move('compact-identities'), move('cancel-x'),
    { ...move('insert-column'), count: 50 }, move('compact-identities'),
  ];
  const frames = gifFrames(encodeReplay({ ...round, circuit: [['X', 'X']], sequence }), 304);
  assert.equal(frames.length, 6);
  assert.ok(texts(surfaces[0].frames[0]).includes('Layout: Identity spacing · free'));
  assert.ok(texts(surfaces[0].frames[2]).includes('Move 1: Cancel XX'));
  assert.ok(texts(surfaces[0].frames.at(-1)).includes('My score: 1 moves · Optimal: 1'));
  assert.ok(texts(surfaces[0].frames.at(-1)).includes('Identity circuit · GG'));
});

test('2000-move boundary replay samples at most 97 frames while retaining the final identity', context => {
  const surfaces = canvases(context), progress = [];
  const sequence = [move('slide-x'), ...Array.from({ length: 1999 }, () => move('cancel-x', 0, 1))];
  const bytes = encodeReplay({ ...round, circuit: [['X', '.', 'X']], sequence }, value => progress.push(value));
  const frames = gifFrames(bytes, 304), surface = surfaces[0];
  assert.equal(frames.length, 97); assert.equal(surface.frames.length, 97);
  assert.ok(frames.reduce((sum, frame) => sum + frame.delay, 0) < 15000, 'Long replay remains under fifteen seconds');
  assert.ok(texts(surface.frames[0]).includes('Layout: Move X'));
  for (let index = 1; index < 96; index++) {
    const step = Math.round(index * sequence.length / 96), rendered = surface.frames[index];
    assert.ok(texts(rendered).includes(`Move ${step}: Cancel XX`), 'Sampled labels retain the complete rewrite count');
    assert.equal(rendered.filter(command => command.name === 'arc').length, step % 2 ? 2 : 0, 'Sampled circuits retain the complete replay state');
  }
  assert.ok(texts(surface.frames.at(-1)).includes('My score: 1999 moves · Optimal: 1'));
  assert.ok(texts(surface.frames.at(-1)).includes('Identity circuit · GG'));
  assert.equal(surface.frames.at(-1).filter(command => command.name === 'arc').length, 0);
  assert.equal(progress.length, 97); assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 1 && (!index || value > progress[index - 1])));
  assert.throws(() => encodeReplay({ ...round, sequence: Array(2001).fill(move('cancel-x', 0, 1)) }), /Finish a circuit/);
  const invalidBetweenSamples = [...sequence]; invalidBetweenSamples[2] = move('unknown');
  assert.throws(() => encodeReplay({ ...round, circuit: [['X', '.', 'X']], sequence: invalidBetweenSamples }), /Unknown circuit rule/, 'Moves between sampled frames are still validated');
});

test('Unsupported drawing, invalid rules and unfinished replay fail explicitly', context => {
  replace(context, globalThis, 'OffscreenCanvas', undefined);
  assert.throws(() => encodeReplay(round), { name: 'NotSupportedError' });
  canvases(context);
  assert.throws(() => encodeReplay({ ...round, sequence: [] }), /Finish a circuit/);
  assert.throws(() => encodeReplay({ ...round, sequence: [move('slide-h')] }), RangeError);
  assert.throws(() => encodeReplay({ ...round, circuit: [['X', 'X', 'H']], sequence: [move('cancel-x')] }), /has not been reduced/);
  assert.throws(() => encodeReplay({ ...round, circuit: [['ZU', '.']] }), RangeError);
  globalThis.OffscreenCanvas.prototype.getContext = () => null;
  assert.throws(() => encodeReplay(round), { name: 'NotSupportedError' });
});

test('Worker serializes errors and transfers successful GIF bytes after progress', async context => {
  replace(context, globalThis, 'WorkerGlobalScope', class {
    static [Symbol.hasInstance](value) { return value === globalThis; }
  });
  replace(context, globalThis, 'onmessage', null);
  const messages = [];
  replace(context, globalThis, 'postMessage', (data, transfer) => messages.push({ data, transfer }));
  const surfaces = canvases(context);
  let finishConversion, conversions = 0;
  globalThis.OffscreenCanvas.prototype.convertToBlob = function (options) {
    conversions++;
    assert.deepEqual(options, { type: 'image/png' });
    assert.equal(this, surfaces.at(-1));
    assert.ok(texts(this.frames.at(-1)).includes('Identity circuit · GG'));
    return new Promise(resolve => { finishConversion = resolve; });
  };
  await import('../../src/scripts/circuit-reduction-gif-worker.js?worker-message-test');
  const encoding = globalThis.onmessage({ data: { round, image: true } });
  assert.equal(conversions, 1);
  assert.deepEqual(messages.at(-1).data, { progress: 1 }, 'Worker waits for PNG before transferring the GIF');
  const image = new Blob(['png'], { type: 'image/png' });
  finishConversion(image);
  await encoding;
  const completed = messages.at(-1);
  assert.equal(completed.data.image, image);
  assert.equal(gifFrames(completed.data.bytes, 304).length, 2);
  assert.deepEqual(completed.transfer, [completed.data.bytes.buffer]);
  assert.deepEqual(messages.slice(0, -1).map(item => item.data), [{ progress: 0 }, { progress: 1 }]);

  messages.length = 0;
  await globalThis.onmessage({ data: { round, image: false } });
  assert.equal(conversions, 1, 'GIF-only exports never convert the final frame to PNG');
  assert.equal(messages.at(-1).data.image, undefined);
  assert.equal(gifFrames(messages.at(-1).data.bytes, 304).length, 2);

  messages.length = 0;
  globalThis.OffscreenCanvas.prototype.convertToBlob = async () => { throw new Error('PNG unsupported'); };
  await globalThis.onmessage({ data: { round, image: true } });
  assert.equal(gifFrames(messages.at(-1).data.bytes, 304).length, 2);
  assert.equal(messages.at(-1).data.image, undefined, 'PNG conversion failure preserves the GIF');
  messages.length = 0;
  await globalThis.onmessage({ data: { round: { ...round, sequence: [move('unknown')] }, image: false } });
  assert.deepEqual(messages, [{ data: { error: 'Unknown circuit rule.', name: 'RangeError' }, transfer: undefined }]);
  globalThis.OffscreenCanvas = undefined;
  await globalThis.onmessage({ data: { round, image: false } });
  assert.equal(messages.at(-1).data.name, 'NotSupportedError');
  assert.match(messages.at(-1).data.error, /browser cannot create GIFs/);
  assert.equal(messages.at(-1).transfer, undefined);
});
