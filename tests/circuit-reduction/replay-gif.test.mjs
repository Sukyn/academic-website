import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/circuit-reduction-gif-worker.js';

function replace(context, object, key, value) {
  const original = object[key];
  object[key] = value;
  context.after(() => { object[key] = original; });
}

function canvases(context) {
  const surfaces = [];
  replace(context, globalThis, 'OffscreenCanvas', class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = []; this.crops = [];
      let commands = [];
      this.commands = () => commands;
      const record = name => (...args) => commands.push({ name, args, fillStyle: this.context.fillStyle, strokeStyle: this.context.strokeStyle, lineWidth: this.context.lineWidth, opacity: this.context.globalAlpha });
      this.context = { globalAlpha: 1, ...Object.fromEntries(['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText', 'translate', 'scale'].map(name => [name, record(name)])) };
      const states = [];
      this.context.save = () => { states.push(this.context.globalAlpha); };
      this.context.restore = () => { this.context.globalAlpha = states.pop(); };
      this.context.getImageData = (x, y, w, h) => {
        this.frames.push(commands); this.crops.push({ x, y, width: w, height: h }); commands = [];
        if (this.pixels?.length !== w * h * 4) this.pixels = new Uint8ClampedArray(w * h * 4);
        return { data: this.pixels };
      };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  });
  return surfaces;
}

// Parse actual GIF image descriptors, palette flags, frame controls and trailer.
function gifFrames(bytes, expectedHeight) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
  const word = index => bytes[index] | bytes[index + 1] << 8;
  assert.equal(word(6), 720); assert.equal(word(8), expectedHeight);
  let position = 13, control;
  assert.ok(bytes[10] & 128, 'The replay has one global palette');
  assert.ok((1 << ((bytes[10] & 7) + 1)) <= 64, 'The fixed palette remains small');
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
        control = { delay: word(position + 2) * 10, transparent: Boolean(bytes[position + 1] & 1), disposal: bytes[position + 1] >> 2 & 7 };
      }
      skipBlocks();
    } else if (marker === 0x2c) {
      const frame = { ...control, left: word(position), top: word(position + 2), width: word(position + 4), height: word(position + 6) };
      const packed = bytes[position + 8]; position += 9;
      assert.equal(packed & 128, 0, 'Later frames reuse the global palette');
      assert.equal(frame.left, 0); assert.equal(frame.width, 720);
      assert.equal(frame.top, frames.length ? 100 : 0);
      assert.equal(frame.height, expectedHeight - frame.top);
      assert.ok(frame.top + frame.height <= expectedHeight, 'Circuit crops remain inside the logical screen');
      const depth = bytes[position++]; assert.ok(depth >= 2 && depth <= 8);
      assert.ok(bytes[position] > 0, 'Encoded image data is present');
      skipBlocks(); frames.push(frame);
    } else assert.fail(`Unexpected GIF block ${marker}`);
  }
  assert.fail('Missing GIF trailer');
}

const texts = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
const selectedCells = frame => frame.filter(command => command.name === 'strokeRect');
const arcs = frame => frame.filter(command => command.name === 'arc');
const move = (rule, row = 0, column = 0) => ({ rule, row, column });
const round = { label: 'Level 1 · Two flips', circuit: [['.', 'X', 'X', '.']], sequence: [move('cancel-x', 0, 1)], optimalMoves: 1 };

test('share image keeps the original 960px layout, header and original gates', context => {
  const surfaces = canvases(context), progress = [], saved = structuredClone(round);
  const image = encodeReplay(round, value => progress.push(value), true);
  assert.equal(image, surfaces[0]);
  assert.equal(image.width, 960); assert.equal(image.height, 224);
  assert.equal(image.frames.length, 0, 'No GIF pixels are read');
  assert.equal(image.commands().filter(command => command.name === 'fillRect' && command.args[2] === 960).length, 1);
  assert.deepEqual(texts(image.commands()), [round.label, 'Optimal : 1', 'My score : 1']);
  assert.equal(arcs(image.commands()).length, 2);
  assert.equal(selectedCells(image.commands()).length, 0);
  assert.deepEqual(progress, []);
  assert.deepEqual(round, saved);
  assert.throws(() => encodeReplay({ ...round, sequence: [move('slide-h')] }, undefined, true));
});

test('GIF animates cancellation while keeping a static clean header and ending on the identity', context => {
  const surfaces = canvases(context), progress = [], saved = structuredClone(round);
  const bytes = encodeReplay(round, value => progress.push(value));
  const surface = surfaces[0], frames = gifFrames(bytes, 168);
  assert.equal(frames.length, 9); assert.equal(surface.frames.length, 9);
  assert.deepEqual(texts(surface.frames[0]), [round.label, 'Optimal : 1', 'My score : 1']);
  assert.ok(surface.frames.slice(1).every(frame => texts(frame).length === 0), 'Summary text is drawn only once');
  assert.ok(surface.frames.every(frame => selectedCells(frame).length === 0), 'There are no rewrite highlights');
  assert.ok(surface.frames.every(frame => !texts(frame).some(text => /Move|Layout|Cancel/.test(text))), 'There are no per-move captions');
  const positions = surface.frames.slice(1, -1).map(frame => frame.filter(command => command.name === 'translate').map(command => command.args[0]));
  assert.ok(positions.every(pair => pair.length === 2));
  assert.ok(positions.every((pair, index) => !index || pair[1] - pair[0] < positions[index - 1][1] - positions[index - 1][0]), 'The cancelling glyphs converge');
  assert.ok(surface.frames[3].some(command => command.name === 'scale' && command.args[0] < 1), 'The glyphs shrink');
  assert.ok(arcs(surface.frames[3]).every(command => command.opacity > 0 && command.opacity < 1), 'The glyphs fade');
  assert.equal(arcs(surface.frames.at(-1)).length, 0);
  assert.equal(frames[0].delay, 1000); assert.equal(frames.at(-1).delay, 1800);
  assert.ok(frames.slice(1, -1).every(frame => frame.delay === 50));
  assert.ok(frames.every(frame => !frame.transparent && frame.disposal === 1));
  assert.deepEqual(surface.crops[0], { x: 0, y: 0, width: 720, height: 168 });
  assert.ok(surface.crops.slice(1).every(crop => crop.y === 100 && crop.height === 68));
  assert.deepEqual(progress, [0, 1]);
  assert.deepEqual(round, saved);
});

test('linked cancellation exports adjacent connector frames behind the moving target glyphs', context => {
  const surfaces = canvases(context);
  const bytes = encodeReplay({ ...round, circuit: [['ZU', 'ZU'], ['XD', 'XD']], sequence: [move('cancel-cnot-down')] });
  assert.equal(gifFrames(bytes, 228).length, 9);
  const tween = surfaces[0].frames[2];
  const firstGate = tween.findIndex(command => command.name === 'translate');
  const connector = tween.findIndex(command => command.name === 'lineTo' && command.strokeStyle === '#9ad9d1');
  assert.ok(connector >= 0 && connector < firstGate, 'Connectors are drawn before glyphs');
  assert.equal(arcs(tween).length, 4);
  assert.equal(arcs(surfaces[0].frames.at(-1)).length, 0);
});

test('free layouts jump to the next rewrite and layout-only replays retain sensible snapshots', context => {
  const surfaces = canvases(context);
  const sequence = [move('insert-column', 0, 1), move('remove-column', 0, 1), move('cancel-x')];
  const frames = gifFrames(encodeReplay({ ...round, circuit: [['X', 'X']], sequence }), 168);
  assert.equal(frames.length, 10);
  const rendered = surfaces[0].frames;
  const wireLengths = rendered.map(frame => frame.find(command => command.name === 'lineTo').args[0] - frame.find(command => command.name === 'moveTo').args[0]);
  assert.deepEqual(wireLengths, Array(10).fill(84));
  assert.deepEqual(texts(rendered[0]), [round.label, 'Optimal : 1', 'My score : 1']);
  assert.equal(arcs(rendered.at(-1)).length, 0);
  const freeSequence = [
    { ...move('insert-space', 0, 1), count: 100 }, move('compact-identities'), move('cancel-x'),
    { ...move('insert-column'), count: 50 }, move('compact-identities'),
  ];
  assert.equal(gifFrames(encodeReplay({ ...round, circuit: [['X', 'X']], sequence: freeSequence }), 168).length, 11);
  assert.deepEqual(texts(surfaces[1].frames[0]), [round.label, 'Optimal : 1', 'My score : 1']);
  assert.equal(arcs(surfaces[1].frames.at(-1)).length, 0);
  const layoutOnly = { ...round, circuit: [['.', '.']], sequence: sequence.slice(0, 2), optimalMoves: 0 };
  assert.equal(gifFrames(encodeReplay(layoutOnly), 168).length, 3);
  const layoutWidths = surfaces[2].frames.map(frame => frame.find(command => command.name === 'lineTo').args[0] - frame.find(command => command.name === 'moveTo').args[0]);
  assert.deepEqual(layoutWidths, [84, 126, 84]);
  assert.deepEqual(texts(surfaces[2].frames[0]), [round.label, 'Optimal : 0', 'My score : 0']);
});

test('all thirteen rewrites animate when separated by many free spacing edits, including the final layout', context => {
  const surfaces = canvases(context), sequence = [];
  for (let index = 0; index < 13; index++) {
    sequence.push(move('insert-column', 0, 1), move('compact-identities'), move('cancel-x'));
  }
  sequence.push({ ...move('insert-column'), count: 4 });
  const bytes = encodeReplay({ ...round, circuit: [['X', 'X']], sequence });
  const frames = gifFrames(bytes, 168), surface = surfaces[0];
  assert.equal(frames.length, 119);
  assert.deepEqual(texts(surface.frames[0]), [round.label, 'Optimal : 1', 'My score : 13']);
  assert.equal(surface.frames.filter(frame => frame.some(command => command.name === 'scale')).length, 13 * 7, 'All thirteen cancellation or creation tweens are present');
  for (let sample = 1; sample <= 13; sample++) {
    assert.equal(arcs(surface.frames[sample * 9]).length, sample % 2 ? 0 : 2, 'Each rewrite reaches its exact resulting state');
  }
  const final = surface.frames.at(-1);
  const wireWidth = final.find(command => command.name === 'lineTo').args[0] - final.find(command => command.name === 'moveTo').args[0];
  assert.equal(wireWidth, 252, 'The trailing layout is retained in the final frame');
  assert.equal(arcs(final).length, 0); assert.equal(frames.at(-1).delay, 1800);
});

test('2000 moves validate fully and retain the exact final identity within 145 cropped frames', context => {
  const surfaces = canvases(context), progress = [];
  const sequence = [move('slide-x'), ...Array.from({ length: 1999 }, () => move('cancel-x', 0, 1))];
  const bytes = encodeReplay({ ...round, circuit: [['X', '.', 'X']], sequence }, value => progress.push(value));
  const frames = gifFrames(bytes, 168), surface = surfaces[0];
  assert.equal(frames.length, 145); assert.equal(surface.frames.length, 145);
  assert.ok(frames.reduce((sum, frame) => sum + frame.delay, 0) < 15000);
  assert.deepEqual(texts(surface.frames[0]), [round.label, 'Optimal : 1', 'My score : 1999']);
  for (let sample = 1; sample <= 16; sample++) {
    const step = Math.round(sample * 1999 / 16) + 1;
    assert.equal(arcs(surface.frames[sample * 9]).length, step % 2 ? 2 : 0, 'Sampled transitions retain the complete replay state');
  }
  assert.equal(arcs(surface.frames.at(-1)).length, 0);
  assert.equal(progress.length, 17); assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 1 && (!index || value > progress[index - 1])));
  assert.throws(() => encodeReplay({ ...round, sequence: Array(2001).fill(move('cancel-x', 0, 1)) }), /Finish a circuit/);
  const invalidBetweenSamples = [...sequence]; invalidBetweenSamples[2] = move('unknown');
  assert.throws(() => encodeReplay({ ...round, circuit: [['X', '.', 'X']], sequence: invalidBetweenSamples }), /Unknown circuit rule/, 'Skipped moves are validated');
});

test('free gate slides cannot crowd thirteen scored rewrites out of the GIF', context => {
  const surfaces = canvases(context);
  const sequence = [...Array.from({ length: 101 }, () => move('slide-x')),
    ...Array.from({ length: 13 }, () => move('cancel-x', 0, 1))];
  const bytes = encodeReplay({ ...round, circuit: [['X', '.', 'X']], sequence });
  assert.equal(gifFrames(bytes, 168).length, 106);
  assert.equal(surfaces[0].frames.filter(frame => frame.some(command => command.name === 'scale')).length, 13 * 7);
  assert.equal(arcs(surfaces[0].frames.at(-1)).length, 0);
});

test('unsupported drawing, invalid rules and unfinished replay fail explicitly', context => {
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

test('worker independently returns one PNG or transfers a GIF and serializes failures', async context => {
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
    assert.deepEqual(texts(this.commands()), [round.label, 'Optimal : 1', 'My score : 1']);
    assert.equal(arcs(this.commands()).length, 2);
    assert.equal(this.frames.length, 0);
    return new Promise(resolve => { finishConversion = resolve; });
  };
  await import('../../src/scripts/circuit-reduction-gif-worker.js?worker-message-test');
  const encoding = globalThis.onmessage({ data: { round, imageOnly: true } });
  assert.equal(conversions, 1); assert.equal(messages.length, 0);
  const image = new Blob(['png'], { type: 'image/png' });
  finishConversion(image);
  await encoding;
  assert.deepEqual(messages.at(-1), { data: { image }, transfer: undefined });

  messages.length = 0;
  await globalThis.onmessage({ data: { round, imageOnly: false } });
  assert.equal(conversions, 1);
  assert.equal(gifFrames(messages.at(-1).data.bytes, 168).length, 9);
  assert.deepEqual(messages.at(-1).transfer, [messages.at(-1).data.bytes.buffer]);
  assert.deepEqual(messages.slice(0, -1).map(item => item.data), [{ progress: 0 }, { progress: 1 }]);

  messages.length = 0;
  globalThis.OffscreenCanvas.prototype.convertToBlob = async () => { throw new Error('PNG unsupported'); };
  await globalThis.onmessage({ data: { round, imageOnly: true } });
  assert.equal(messages.at(-1).data.error, 'PNG unsupported');
  messages.length = 0;
  await globalThis.onmessage({ data: { round, imageOnly: false } });
  assert.equal(gifFrames(messages.at(-1).data.bytes, 168).length, 9);
  messages.length = 0;
  await globalThis.onmessage({ data: { round: { ...round, sequence: [move('unknown')] }, imageOnly: false } });
  assert.deepEqual(messages, [{ data: { error: 'Unknown circuit rule.', name: 'RangeError' }, transfer: undefined }]);
  globalThis.OffscreenCanvas = undefined;
  await globalThis.onmessage({ data: { round, imageOnly: false } });
  assert.equal(messages.at(-1).data.name, 'NotSupportedError');
  assert.match(messages.at(-1).data.error, /browser cannot create GIFs/);
  assert.equal(messages.at(-1).transfer, undefined);
});
