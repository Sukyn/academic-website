import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';

const { encodeReplay } = await import(websiteFile('src/scripts/quantum-golf-gif-worker.js'));
const { createWorkerReplayGif, createWorkerReplayImage } = await import(websiteFile('src/lib/games/replay-gif.js'));
const createWorker = () => new Worker(new URL('../../src/scripts/quantum-golf-gif-worker.js', import.meta.url), { type: 'module' });
const createReplayGif = (round, options) => createWorkerReplayGif(round, createWorker, options);
const createReplayImage = (round, options) => createWorkerReplayImage(round, createWorker, options);
const { BlochSphere } = await import(websiteFile('src/lib/quantum-golf/sphere.js'));
const { START_STATE, applyGate } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const sequence = 'THTHTTTHTH';
const destination = circuit => [...circuit].reduce(applyGate, START_STATE);
const round = { label: 'Daily puzzle : 2026-10-14', sequence, target: destination(sequence), epsilon: 0.05, optimalMoves: 10 };

function replace(context, object, key, value) {
  const original = object[key];
  object[key] = value;
  context.after(() => { object[key] = original; });
}

function canvases(context, onFrame, onPixels) {
  const result = [];
  replace(context, globalThis, 'OffscreenCanvas', class {
    constructor(width, height) {
      this.width = width; this.height = height;
      const texts = [], images = [];
      const noop = () => {};
      this.context = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash',
        'fill', 'closePath', 'arc', 'setTransform', 'fillRect'].map(name => [name, noop]));
      Object.assign(this.context, {
        texts, images, reads: 0,
        fillText: text => texts.push(text),
        drawImage: (...args) => { images.push(args); onFrame?.(this, ...args); },
        getImageData: (_x, _y, w, h) => {
          this.context.reads++;
          if (!this.pixels) {
            this.pixels = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < this.pixels.length; i += 4) this.pixels.set([24, 35, 30, 255], i);
          }
          const data = this.pixels.slice(); // Real getImageData returns an independent buffer.
          onPixels?.(data, this);
          return { data };
        },
      });
      result.push(this);
    }
    getContext() { return this.context; }
  });
  return result;
}

// Walk real GIF blocks rather than treating encoder output as an opaque blob.
function gifFrames(bytes, decode = false) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
  const word = i => bytes[i] | bytes[i + 1] << 8;
  assert.equal(word(6), 480);
  assert.equal(word(8), 560);
  let position = 13, control;
  assert.ok(bytes[10] & 128, 'The replay has one global palette');
  const paletteSize = 1 << ((bytes[10] & 7) + 1);
  const palette = Array.from({ length: paletteSize }, (_, i) => [...bytes.subarray(position + i * 3, position + i * 3 + 3)]);
  assert.ok(paletteSize <= 64, 'The shared palette uses at most 64 colors');
  position += 3 * paletteSize;
  const frames = [];
  const blocks = () => {
    let length;
    while ((length = bytes[position++])) position += length;
  };
  while (position < bytes.length) {
    const marker = bytes[position++];
    if (marker === 0x3b) {
      assert.equal(position, bytes.length, 'The trailer ends the file');
      return frames;
    }
    if (marker === 0x21) {
      const kind = bytes[position++];
      if (kind === 0xf9) {
        assert.equal(bytes[position], 4);
        control = { delay: word(position + 2) * 10, transparent: Boolean(bytes[position + 1] & 1),
          dispose: bytes[position + 1] >> 2 & 7, transparentIndex: bytes[position + 4] };
      }
      blocks();
    } else if (marker === 0x2c) {
      assert.equal(word(position + 4), 480);
      assert.equal(word(position + 6), 560);
      const packed = bytes[position + 8];
      position += 9;
      assert.equal(packed & 128, 0, 'Later frames reuse the global palette');
      const colorDepth = bytes[position++];
      assert.equal(colorDepth, Math.max(2, Math.log2(paletteSize)), 'LZW uses the actual palette size');
      const parts = [];
      let length;
      while ((length = bytes[position++])) { parts.push(bytes.subarray(position, position + length)); position += length; }
      const data = Uint8Array.from(parts.flatMap(part => [...part]));
      frames.push({ ...control, colorDepth, palette, indices: decode ? decodeLzw(data, colorDepth, 480 * 560) : undefined });
    } else assert.fail(`Unexpected GIF block ${marker}`);
  }
  assert.fail('Missing GIF trailer');
}

// Decode GIF LZW independently so tests can inspect the displayed delta frames.
function decodeLzw(data, depth, length) {
  const clear = 1 << depth, end = clear + 1, result = new Uint8Array(length);
  let dictionary, width, next, previous, bit = 0, written = 0;
  while (bit + width <= data.length * 8 || !width) {
    width ??= depth + 1;
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code |= (data[bit >> 3] >> (bit & 7) & 1) << i;
    if (code === clear) {
      dictionary = Array.from({ length: clear }, (_, i) => Uint8Array.of(i));
      width = depth + 1; next = end + 1; previous = null;
      continue;
    }
    if (code === end) { assert.equal(written, length); return result; }
    const entry = dictionary[code] ?? (code === next && previous ? Uint8Array.from([...previous, previous[0]]) : null);
    assert.ok(entry, `Valid LZW dictionary code ${code}`);
    result.set(entry, written); written += entry.length;
    if (previous && next < 4096) {
      dictionary[next++] = Uint8Array.from([...previous, entry[0]]);
      if (next === 1 << width && width < 12) width++;
    }
    previous = entry;
  }
  assert.fail('Missing LZW end code');
}

test('daily GIF contains only the three requested labels and a smooth, looping replay', context => {
  let instance, followed = 0, fractional = 0;
  const surfaces = canvases(context, () => {
    const point = instance.project(instance.state);
    assert.ok(Math.abs(point.x - instance.cx) < 1e-9 && Math.abs(point.y - instance.cy) < 1e-9 && point.depth > 0.999,
      'The moving point is centered on every encoded frame');
    followed++;
    if (instance.model.animation) {
      fractional++;
      const rotated = instance.model.animation.rotate(instance.model.animation.progress);
      assert.ok(Math.hypot(...instance.state.map((value, i) => value - rotated[i])) < 1e-10);
    }
  }), progress = [];
  const original = BlochSphere.prototype.setState;
  replace(context, BlochSphere.prototype, 'setState', function (next) {
    original.call(this, next); instance = this;
  });
  const bytes = encodeReplay(round, value => progress.push(value));
  const frames = gifFrames(bytes), output = surfaces[0];
  assert.equal(output.width, 480);
  assert.equal(output.height, 560);
  assert.equal(surfaces.length, 2, 'One frame and one sphere canvas stream the replay');
  assert.deepEqual(output.context.texts, [round.label, 'Optimal : 10', 'My score : 10']);
  assert.equal(output.context.images.length, frames.length + 1, 'The final palette sample is rendered once before encoding');
  assert.equal(output.context.reads, frames.length + 1);
  assert.equal(frames.length, sequence.length * 6 + 1);
  assert.equal(followed, frames.length + 1);
  assert.equal(fractional, sequence.length * 5, 'Camera follows all intermediate rotations too');
  assert.equal(frames[0].delay, 600);
  assert.equal(frames.at(-1).delay, 1600);
  assert.ok(frames.slice(1, -1).every(frame => frame.delay === 80));
  assert.equal(frames[0].transparent, false, 'An opaque first frame clears the previous loop');
  assert.ok(frames.every(frame => frame.dispose === 1));
  assert.ok(frames.slice(1).every(frame => frame.transparent && frame.transparentIndex === 0));
  assert.ok(new TextDecoder().decode(bytes).includes('NETSCAPE2.0'), 'GIF declares looping');
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, i) => value >= 0 && value <= 1 && (!i || value > progress[i - 1])));
  assert.deepEqual(instance.state, round.target);
  assert.equal(instance.model.showLabels, false);
  assert.equal(instance.model.showPreviews, false);
  assert.equal(instance.model.sequence, sequence);
  assert.equal(instance.history.length, sequence.length);
});

test('1358-gate replay follows the point and reprojects the complete world-space trail', context => {
  const word = 'TH'.repeat(679);
  let instance, followed = 0, firstPath;
  const surfaces = canvases(context, () => {
    const point = instance.project(instance.state);
    assert.ok(Math.abs(point.x - instance.cx) < 1e-9 && Math.abs(point.y - instance.cy) < 1e-9 && point.depth > 0.999);
    followed++;
    if (followed > 2 && instance.history.length) {
      firstPath ??= instance.history[0];
      assert.equal(instance.history[0], firstPath, 'Cached world-space paths survive camera rotations');
      assert.deepEqual(firstPath.points[0], START_STATE);
      assert.deepEqual(instance.history.at(-1).points.at(-1), destination(instance.model.sequence),
        'The trace ends at the completed gate prefix before any partial rotation');
    }
  });
  const original = BlochSphere.prototype.setState;
  replace(context, BlochSphere.prototype, 'setState', function (next) {
    original.call(this, next); instance = this;
  });
  const target = destination(word);
  const frames = gifFrames(encodeReplay({ ...round, label: 'Level : 11', sequence: word, target, optimalMoves: 16 }));
  assert.equal(frames.length, 97);
  assert.equal(followed, frames.length + 1, 'Palette sampling and every GIF frame center the moving point');
  assert.ok(frames.reduce((total, frame) => total + frame.delay, 0) <= 13000);
  assert.deepEqual(instance.state, target);
  assert.equal(instance.model.animation, null);
  assert.equal(instance.model.sequence, word);
  assert.equal(instance.history.map(path => path.gate).join(''), word, 'No gate is truncated or skipped');
  assert.ok(instance.history.every(path => path.points.length === 33));
  assert.deepEqual(surfaces[0].context.texts, ['Level : 11', 'Optimal : 16', 'My score : 1358']);
});

test('delta frames retain unchanged pixels and restore erased pixels without ghost trails', context => {
  let instance;
  const original = BlochSphere.prototype.setState;
  replace(context, BlochSphere.prototype, 'setState', function (next) {
    original.call(this, next); instance = this;
  });
  const red = [255, 0, 0], green = [0, 255, 0], black = [0, 0, 0];
  canvases(context, null, pixels => {
    const progress = instance.model.animation?.progress;
    const color = progress == null || progress < 1 / 3 ? red : progress < 2 / 3 ? green : black;
    pixels.fill(0);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    pixels.set([...color, 255], 0);
    pixels.set([...red, 255], 4);
    pixels.set([...green, 255], 8);
  });
  const frames = gifFrames(encodeReplay({ ...round, sequence: 'T', optimalMoves: 1, target: destination('T') }), true);
  const display = new Uint8Array(480 * 560), colors = [];
  for (const frame of frames) {
    for (let i = 0; i < display.length; i++) {
      if (!frame.transparent || frame.indices[i] !== frame.transparentIndex) display[i] = frame.indices[i];
    }
    colors.push(frame.palette[display[0]]);
    assert.deepEqual(frame.palette[display[1]], red, 'An unchanged neighbor stays visible');
    assert.deepEqual(frame.palette[display[2]], green);
  }
  assert.deepEqual(colors, [red, red, green, green, black, black, red]);
  assert.ok(frames[0].indices.every(index => index > 0), 'Opaque black never uses the reserved transparent index');
  assert.equal(frames[1].indices[0], 0, 'The unchanged point is transparent');
  assert.notEqual(frames[2].indices[0], 0, 'A changed point replaces the previous frame');
  assert.equal(frames[3].indices[0], 0, 'Comparison uses the prior full image, not the prior masked delta');
  assert.notEqual(frames[4].indices[0], 0, 'An erased point explicitly restores the opaque background');
  assert.equal(frames[5].indices[0], 0);
  assert.notEqual(frames[6].indices[0], 0, 'A previously erased point can reappear');
});

test('unsupported drawing and malformed replay fail explicitly', context => {
  replace(context, globalThis, 'OffscreenCanvas', undefined);
  assert.throws(() => encodeReplay(round), { name: 'NotSupportedError' });
  canvases(context);
  for (const changes of [{ sequence: '' }, { sequence: 'TX' }, { optimalMoves: null }, { label: '' }]) {
    assert.throws(() => encodeReplay({ ...round, ...changes }), /Finish a puzzle first/);
  }
});

test('still image draws only the completed sphere and complete trace, without reading or encoding pixels', context => {
  let instance;
  const original = BlochSphere.prototype.setState;
  replace(context, BlochSphere.prototype, 'setState', function (next) {
    original.call(this, next); instance = this;
  });
  const surfaces = canvases(context), progress = [];
  const canvas = encodeReplay(round, value => progress.push(value), true);
  assert.equal(canvas, surfaces[0]);
  assert.equal(canvas.width, 480); assert.equal(canvas.height, 560);
  assert.equal(canvas.context.images.length, 1, 'Only the final sphere is composited');
  assert.equal(canvas.context.reads, 0, 'PNG rendering skips palette samples and GIF frames');
  assert.deepEqual(canvas.context.texts, [round.label, 'Optimal : 10', 'My score : 10']);
  assert.deepEqual(instance.state, round.target);
  assert.equal(instance.model.sequence, sequence);
  assert.equal(instance.history.length, sequence.length);
  assert.equal(instance.model.animation, null);
  assert.deepEqual(progress, []);
});

function workers(context) {
  const result = [];
  replace(context, globalThis, 'Worker', class {
    constructor(url, options) {
      this.url = url; this.options = options; this.terminations = 0;
      result.push(this);
    }
    postMessage(value) { this.request = value; }
    terminate() { this.terminations++; }
  });
  return result;
}

test('worker wrapper forwards progress, transfers a GIF blob and releases its worker', async context => {
  const created = workers(context), progress = [], abort = new AbortController();
  const promise = createReplayGif(round, { signal: abort.signal, onProgress: value => progress.push(value) });
  const worker = created[0];
  assert.ok(worker.url.pathname.endsWith('/src/scripts/quantum-golf-gif-worker.js'));
  assert.deepEqual(worker.options, { type: 'module' });
  assert.deepEqual(worker.request, { round, imageOnly: false });
  const message = worker.onmessage;
  message({ data: { progress: 0.25 } });
  message({ data: { progress: 2 } });
  message({ data: { bytes: new Uint8Array([71, 73, 70]) } });
  const blob = await promise;
  assert.equal(blob.type, 'image/gif');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([71, 73, 70]));
  assert.deepEqual(progress, [0.25, 1]);
  assert.equal(worker.terminations, 1);
  assert.equal(worker.onmessage, null);
  abort.abort();
  message({ data: { progress: 0.5 } });
  message({ data: { bytes: new Uint8Array([71]) } });
  assert.equal(worker.terminations, 1);
  assert.deepEqual(progress, [0.25, 1], 'Completed work cannot report stale progress');
});

test('cancellation stops either export immediately, including a signal cancelled before launch', async context => {
  const created = workers(context);
  for (const create of [createReplayGif, createReplayImage]) {
    const abort = new AbortController(), promise = create(round, { signal: abort.signal }), worker = created.at(-1);
    const message = worker.onmessage;
    abort.abort();
    await assert.rejects(promise, { name: 'AbortError' });
    assert.equal(worker.terminations, 1);
    assert.equal(worker.onmessage, null);
    message({ data: { bytes: new Uint8Array([71]), image: new Blob(['stale'], { type: 'image/png' }) } });
    assert.equal(worker.terminations, 1, 'Cancelled work cannot settle twice');
    const count = created.length;
    await assert.rejects(create(round, { signal: abort.signal }), { name: 'AbortError' });
    assert.equal(created.length, count, 'An already cancelled job creates no worker');
  }
});

test('image and GIF requests are independent and return the requested format', async context => {
  const created = workers(context), image = createReplayImage(round), imageWorker = created.at(-1);
  assert.deepEqual(imageWorker.request, { round, imageOnly: true });
  const download = createReplayGif(round), gifWorker = created.at(-1);
  assert.deepEqual(gifWorker.request, { round, imageOnly: false });
  const png = new Blob(['final frame'], { type: 'image/png' });
  imageWorker.onmessage({ data: { image: png } });
  assert.equal(await image, png);
  assert.equal(imageWorker.terminations, 1);
  assert.equal(gifWorker.terminations, 0, 'Completing the image does not stop an independent GIF');
  gifWorker.onmessage({ data: { bytes: new Uint8Array([71, 73, 70]) } });
  assert.equal((await download).type, 'image/gif');
});

test('worker converts one completed frame to PNG, and PNG failures do not affect later GIF exports', async context => {
  replace(context, globalThis, 'WorkerGlobalScope', class {
    static [Symbol.hasInstance](value) { return value === globalThis; }
  });
  replace(context, globalThis, 'onmessage', null);
  const messages = [];
  replace(context, globalThis, 'postMessage', (data, transfer) => messages.push({ data, transfer }));
  const surfaces = canvases(context);
  let instance, conversions = 0, finishConversion;
  const original = BlochSphere.prototype.setState;
  replace(context, BlochSphere.prototype, 'setState', function (next) {
    original.call(this, next); instance = this;
  });
  globalThis.OffscreenCanvas.prototype.convertToBlob = function (options) {
    conversions++;
    assert.deepEqual(options, { type: 'image/png' });
    assert.equal(this, surfaces[0]);
    assert.deepEqual(this.context.texts, [round.label, 'Optimal : 10', 'My score : 10']);
    assert.deepEqual(instance.state, round.target);
    assert.equal(instance.model.sequence, sequence);
    assert.equal(instance.history.length, sequence.length);
    assert.equal(instance.model.animation, null);
    return new Promise(resolve => { finishConversion = resolve; });
  };
  await import(`${websiteFile('src/scripts/quantum-golf-gif-worker.js').href}?png-worker-test`);
  const encoding = globalThis.onmessage({ data: { round, imageOnly: true } });
  assert.equal(conversions, 1);
  assert.equal(messages.length, 0, 'A still image does not report GIF encoding progress');
  assert.equal(surfaces[0].context.reads, 0);
  assert.equal(surfaces[0].context.images.length, 1);
  const image = new Blob(['png'], { type: 'image/png' });
  finishConversion(image);
  await encoding;
  const completed = messages.at(-1);
  assert.equal(completed.data.image, image);
  assert.equal(completed.data.bytes, undefined, 'A preview generates no GIF');
  assert.equal(completed.transfer, undefined);

  await globalThis.onmessage({ data: { round, imageOnly: false } });
  assert.equal(conversions, 1, 'GIF-only exports never convert the final frame to PNG');
  assert.equal(messages.at(-1).data.image, undefined);
  assert.equal(gifFrames(messages.at(-1).data.bytes).length, sequence.length * 6 + 1);

  globalThis.OffscreenCanvas.prototype.convertToBlob = async () => { throw new Error('PNG unavailable'); };
  await globalThis.onmessage({ data: { round, imageOnly: true } });
  assert.equal(messages.at(-1).data.error, 'PNG unavailable');
  assert.equal(messages.at(-1).data.bytes, undefined);

  delete globalThis.OffscreenCanvas.prototype.convertToBlob;
  await globalThis.onmessage({ data: { round, imageOnly: false } });
  assert.equal(gifFrames(messages.at(-1).data.bytes).length, sequence.length * 6 + 1);
  assert.deepEqual(messages.at(-1).transfer, [messages.at(-1).data.bytes.buffer]);
});

test('worker failure, message failure and unsupported canvas all reject without leaking workers', async context => {
  const created = workers(context);
  for (const [create, format] of [[createReplayGif, 'GIF'], [createReplayImage, 'image']]) {
    let promise = create(round), prevented = false;
    created.at(-1).onerror({ preventDefault: () => { prevented = true; } });
    await assert.rejects(promise, new RegExp(`Could not create the ${format}`));
    assert.equal(prevented, true);
    promise = create(round);
    created.at(-1).onmessageerror();
    await assert.rejects(promise, new RegExp(`Could not create the ${format}`));
    promise = create(round);
    created.at(-1).onmessage({ data: { error: 'Export unsupported.', name: 'NotSupportedError' } });
    await assert.rejects(promise, { name: 'NotSupportedError' });
  }
  assert.ok(created.every(worker => worker.terminations === 1 && worker.onmessage === null));
  replace(context, globalThis, 'Worker', undefined);
  await assert.rejects(createReplayGif(round), { name: 'NotSupportedError' });
  await assert.rejects(createReplayImage(round), { name: 'NotSupportedError' });
});
