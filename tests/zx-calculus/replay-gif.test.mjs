import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/zx-calculus-gif-worker.js';
import { applyMove, LEVELS, MAX_MOVES, targetDiagram } from '../../src/lib/zx-calculus/engine.js';
import { createRewriteScene, drawRewriteFrame, rewriteDuration, REPLAY_MOVE_DURATION } from '../../src/lib/zx-calculus/animation.js';
import { diagramLayout, ZX_COLORS } from '../../src/lib/zx-calculus/rendering.js';
import solutions from '../../tools/zx-calculus/solutions.json' with { type: 'json' };

function canvases(context) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas'), surfaces = [];
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original);
    else delete globalThis.OffscreenCanvas;
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = []; this.crops = [];
      let commands = [];
      this.commands = () => commands;
      const record = name => (...args) => commands.push({ name, args, fill: this.context.fillStyle,
        stroke: this.context.strokeStyle, alpha: this.context.globalAlpha, width: this.context.lineWidth });
      this.context = { globalAlpha: 1, ...Object.fromEntries(['translate', 'scale', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo',
        'bezierCurveTo', 'stroke', 'arc', 'rect', 'closePath', 'clip', 'fill', 'fillRect', 'strokeRect', 'fillText', 'setLineDash'].map(name => [name, record(name)])) };
      const states = [], keys = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'lineCap'];
      this.context.save = () => { states.push(Object.fromEntries(keys.map(key => [key, this.context[key]]))); record('save')(); };
      this.context.restore = () => { Object.assign(this.context, states.pop()); record('restore')(); };
      this.context.getImageData = (x, y, w, h) => {
        this.frames.push(commands); this.crops.push({ x, y, width: w, height: h }); commands = [];
        this.pixels ??= new Uint8ClampedArray(width * height * 4);
        return { data: this.pixels.subarray(0, w * h * 4) };
      };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  } });
  return surfaces;
}

const round = () => ({ label: 'ZX puzzle', puzzle: LEVELS[0].diagram, sequence: solutions[0] });
const texts = commands => commands.filter(({ name }) => name === 'fillText').map(({ args }) => args[0]);
const cleanText = commands => assert.ok(texts(commands).every(text => !/Move\s+\d|Apply\b|Fusion|Hadamard|GG|https?:|colin-blake/i.test(text)));

function gifFrames(bytes) {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
  const word = offset => bytes[offset] | bytes[offset + 1] << 8;
  assert.equal(word(6), 720); assert.equal(word(8), 360);
  assert.ok(bytes[10] & 0x80, 'A single global palette is present.');
  const size = 1 << ((bytes[10] & 7) + 1), frames = [];
  assert.ok(size <= 8);
  const palette = Array.from({ length: size }, (_, index) => [...bytes.subarray(13 + 3 * index, 16 + 3 * index)]);
  for (const color of Object.values(ZX_COLORS)) {
    const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    assert.ok(palette.some(entry => entry.every((channel, index) => channel === rgb[index])));
  }
  let offset = 13 + 3 * size, delay, disposal;
  const skipBlocks = () => {
    while (offset < bytes.length && bytes[offset]) offset += bytes[offset] + 1;
    offset++;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) { assert.equal(offset, bytes.length); return frames; }
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) { delay = word(offset + 2) * 10; disposal = bytes[offset + 1] >> 2 & 7; }
      skipBlocks();
    } else {
      assert.equal(marker, 0x2c);
      assert.equal(bytes[offset + 8] & 0x80, 0, 'Later frames reuse the global palette.');
      assert.equal(disposal, 1, 'Cropped frames preserve the fixed target and header.');
      frames.push({ x: word(offset), y: word(offset + 2), width: word(offset + 4), height: word(offset + 6), delay });
      offset += 10; skipBlocks();
    }
  }
  assert.fail('Missing GIF trailer.');
}

test('still export draws the original ZX diagram and fixed target without encoding GIF frames', context => {
  const surfaces = canvases(context), source = round(), saved = structuredClone(source), progress = [];
  const image = encodeReplay(source, value => progress.push(value), true);
  assert.equal(image, surfaces[0]); assert.equal(image.width, 960); assert.equal(image.height, 480);
  assert.equal(image.frames.length, 0); assert.deepEqual(image.crops, []); assert.deepEqual(progress, []);
  const commands = image.commands();
  assert.equal(commands.filter(({ name }) => name === 'quadraticCurveTo').length, source.puzzle.edges.length + targetDiagram().edges.length);
  assert.equal(commands.filter(({ name }) => name === 'arc').length,
    source.puzzle.nodes.filter(node => node.kind === 'z' || node.kind === 'x').length,
    'The left diagram retains the starting spiders instead of exporting the solved identity.');
  assert.ok(texts(commands).includes('Original') && texts(commands).includes('Target'));
  cleanText(commands); assert.deepEqual(source, saved);
});

test('GIF uses compact dimensions, a shared palette and partial frames while reaching the target', context => {
  const surfaces = canvases(context), source = round(), progress = [], saved = structuredClone(source);
  const bytes = encodeReplay(source, value => progress.push(value)), frames = gifFrames(bytes), surface = surfaces[0];
  assert.deepEqual(frames[0], { x: 0, y: 0, width: 720, height: 360, delay: 900 });
  assert.equal(frames.length, 8 * source.sequence.length + 2);
  assert.ok(frames.slice(1).every(frame => frame.x === 0 && frame.y === 100 && frame.width === Math.ceil(720 * .73) && frame.height === 260));
  assert.ok(frames.slice(1, -1).every(frame => frame.delay === Math.round(REPLAY_MOVE_DURATION / 8 / 10) * 10));
  assert.equal(frames.at(-1).delay, 1500);
  assert.deepEqual(surface.crops.map(crop => crop.width), frames.map(frame => frame.width));
  assert.deepEqual(surface.crops.map(crop => crop.y), frames.map(frame => frame.y));
  assert.equal(surface.frames[0].filter(({ name }) => name === 'quadraticCurveTo').length, source.puzzle.edges.length + 2);
  assert.equal(surface.frames.at(-1).filter(({ name }) => name === 'quadraticCurveTo').length, 2);
  assert.ok(!surface.frames.at(-1).some(({ name }) => name === 'arc'));
  const glyphs = commands => commands.filter(({ name, args }) => name === 'arc' || name === 'fillRect' && args[2] <= 26);
  assert.deepEqual(glyphs(surface.frames[1]), glyphs(surface.frames[0]), 'The first tween holds the matched source');
  assert.deepEqual(glyphs(surface.frames[7]), glyphs(surface.frames[8]), 'The resulting diagram settles before the next rewrite');
  surface.frames.forEach(cleanText);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1); assert.equal(progress.length, frames.length + 1);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 1 && (!index || value >= progress[index - 1])));
  assert.deepEqual(source, saved);
});

test('phased fusion exports fill the spider directly with colour without an empty stage', context => {
  const surfaces = canvases(context), source = { label: 'ZX puzzle', puzzle: LEVELS[1].diagram, sequence: solutions[1] };
  const sectors = commands => commands.filter(({ name, fill }) => name === 'arc' && fill === ZX_COLORS.ink);
  const turns = commands => sectors(commands).map(({ args }) => (args[4] - args[3]) / (2 * Math.PI));
  encodeReplay(source, undefined, true);
  assert.deepEqual(turns(surfaces[0].commands()).sort(), [.25, .75]);
  assert.ok(!surfaces[0].commands().some(({ name, args }) => name === 'arc' && args[2] === 2.5));
  const bytes = encodeReplay(source), timings = gifFrames(bytes);
  const frames = surfaces[1].frames;
  assert.deepEqual(turns(frames[0]).sort(), [.25, .75]);

  const layout = diagramLayout(source.puzzle), after = applyMove(source.puzzle, source.sequence[0]);
  const survivor = after.nodes.find(node => node.kind !== 'boundary');
  const original = source.puzzle.nodes.find(node => node.id === survivor.id);
  const donor = source.puzzle.nodes.find(node => source.sequence[0].nodes.includes(node.id) && node.id !== survivor.id);
  const scene = createRewriteScene(source.puzzle, source.sequence[0], after,
    { layout, nextLayout: diagramLayout(after, layout) });
  const ordinaryDelay = Math.round(REPLAY_MOVE_DURATION / 8 / 10) * 10;
  const fusionDelay = Math.round(rewriteDuration(scene, REPLAY_MOVE_DURATION) / 8 / 10) * 10;
  assert.ok(fusionDelay > ordinaryDelay, 'The phase explanation has more time without adding frames.');
  assert.ok(timings.slice(1, 9).every(frame => frame.delay === fusionDelay));
  assert.ok(timings.slice(9, -1).every(frame => frame.delay === ordinaryDelay), 'The later identity rewrite keeps its normal pace.');
  assert.equal(frames.length, source.sequence.length * 8 + 2);

  assert.ok(sectors(frames[3]).some(({ args, alpha }) => alpha > 0 && alpha < 1 &&
    Math.abs((args[4] - args[3]) / (2 * Math.PI) - donor.phase / 4) < 1e-8),
  'The shrinking donor retains its original cut-out while approaching.');
  let previousCutOut = original.phase / 4;
  for (const index of [4, 5, 6]) {
    const dark = sectors(frames[index]), remaining = turns(frames[index]).reduce((sum, value) => sum + value, 0);
    assert.equal(dark.length, index === 6 ? 0 : 1, 'Only the shrinking retained cut-out remains during filling.');
    assert.ok(remaining >= 0 && remaining < previousCutOut, 'The black cut-out shrinks as colour fills the spider.');
    if (dark.length) assert.equal(dark[0].args[3], -Math.PI / 2, 'The shrinking cut-out keeps its original starting angle.');
    previousCutOut = remaining;
  }
  assert.equal(previousCutOut, 0, 'The completed green spider has no residual dark cut-out.');
  assert.ok(frames.slice(0, 9).every(frame => turns(frame).every(turn => turn < 1)), 'No fusion frame draws a fully black phase disc.');
  assert.deepEqual(turns(frames[8]), [], 'A complete turn leaves a fully coloured spider with no cut-out.');
  assert.ok(frames[8].some(({ name, args }) => name === 'arc' && args[2] === 15), 'The spider remains until the identity rule removes it.');

  const reference = new OffscreenCanvas(720, 360), ctx = reference.getContext('2d');
  const arcs = commands => commands.filter(({ name }) => name === 'arc').map(({ args, fill, alpha }) => ({ args, fill, alpha }));
  for (const tween of [3, 4, 5, 6]) {
    reference.commands().length = 0;
    drawRewriteFrame(ctx, scene, tween / 8, { x: 15, y: 100, width: 720 * .70, height: 235 });
    assert.deepEqual(arcs(frames[tween]), arcs(reference.commands()), 'GIF phase geometry matches the live renderer at transfer, join and filling.');
  }
  frames.forEach(cleanText);
});

test('exports retain user positions and keep surviving spiders in place across rewrites', context => {
  const surfaces = canvases(context), source = round();
  let state = source.puzzle, view = diagramLayout(state);
  view.positions.set(4, { x: 120, y: 100 }); view.positions.set(5, { x: 270, y: 150 });
  source.views = [view];
  for (const move of source.sequence) { state = applyMove(state, move); view = diagramLayout(state, view); source.views.push(view); }
  encodeReplay(source, undefined, true);
  assert.ok(surfaces[0].commands().some(({ name, args }) => name === 'arc' && args[0] === 120 && args[1] === 100 && args[2] === 15));
  encodeReplay(source);
  const merged = surfaces[1].frames[8].filter(({ name, args }) => name === 'arc' && args[2] === 15);
  assert.equal(merged.length, 1); assert.deepEqual(merged[0].args.slice(0, 2), [120, 100]);
});

test('long histories sample animated rewrites within a fixed frame budget and keep the final diagram', context => {
  const surfaces = canvases(context), source = round();
  const insert = { rule: 'insert-hh', edge: source.puzzle.edges[0] };
  const expanded = applyMove(source.puzzle, insert), ids = new Set(source.puzzle.nodes.map(node => node.id));
  const cancel = { rule: 'hh', nodes: expanded.nodes.filter(node => !ids.has(node.id)).map(node => node.id) };
  assert.deepEqual(applyMove(expanded, cancel), source.puzzle);
  const detours = Math.floor((MAX_MOVES - source.sequence.length) / 2) * 2;
  source.sequence = [...Array.from({ length: detours / 2 }, () => [insert, cancel]).flat(), ...source.sequence];
  assert.ok(source.sequence.length >= MAX_MOVES - 1 && source.sequence.length <= MAX_MOVES);
  const progress = [], bytes = encodeReplay(source, value => progress.push(value)), frames = gifFrames(bytes);
  assert.ok(frames.length <= 218); assert.equal(progress.length, frames.length + 1); assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => !index || value >= progress[index - 1]));
  assert.ok(bytes.length < 256_000, 'A long replay retains a bounded frame and byte budget.');
  const final = surfaces[0].frames.at(-1);
  assert.equal(final.filter(({ name }) => name === 'quadraticCurveTo').length, 2);
  assert.ok(!final.some(({ name }) => name === 'arc')); cleanText(final);
});

test('fusion and cancellation frames show geometry between the starting and resulting diagrams', context => {
  const surfaces = canvases(context);
  encodeReplay(round());
  const frames = surfaces[0].frames, arcPositions = frame => frame.filter(({ name }) => name === 'arc').map(({ args }) => args.slice(0, 3).join(':'));
  const endpoints = new Set([...arcPositions(frames[0]), ...arcPositions(frames[8])]);
  assert.ok(arcPositions(frames[4]).some(point => !endpoints.has(point)), 'Selected spiders move into one another during fusion.');

  const puzzle = applyMove(targetDiagram(), { rule: 'insert-hh', edge: [0, 2] });
  encodeReplay({ label: 'ZX puzzle', puzzle, sequence: [{ rule: 'hh', nodes: [4, 5] }] });
  const cancellation = surfaces[1].frames;
  assert.ok(cancellation.slice(1, -1).some(frame => frame.some(({ name, args }) => name === 'fillRect' && args[2] > 0 && args[2] < 26)),
    'The pair of Hadamards visibly shrinks as it cancels.');
  assert.ok(cancellation.slice(1, -1).some(frame => frame.some(({ alpha }) => alpha > 0 && alpha < 1)),
    'The cancelling boxes fade instead of snapping away.');
});

test('Hopf replay animates the disappearing parallel wires', context => {
  const surfaces = canvases(context);
  let puzzle = applyMove(targetDiagram(), { rule: 'insert', edge: [0, 2], kind: 'z' });
  puzzle = applyMove(puzzle, { rule: 'insert', edge: [1, 3], kind: 'x' });
  puzzle = applyMove(puzzle, { rule: 'add-hopf', nodes: [4, 5] });
  const sequence = [{ rule: 'hopf', nodes: [4, 5] }, { rule: 'identity', nodes: [4] }, { rule: 'identity', nodes: [5] }];
  encodeReplay({ label: 'ZX puzzle', puzzle, sequence });
  const frames = surfaces[0].frames, curves = frame => frame.filter(({ name }) => name === 'quadraticCurveTo').map(({ args }) => args.join(':'));
  const endpoints = new Set([...curves(frames[0]), ...curves(frames[8])]);
  assert.ok(curves(frames[4]).some(curve => !endpoints.has(curve)), 'The cancelling links shorten during the rewrite.');
  assert.equal(curves(frames.at(-1)).length, 2);
});

test('ordinary-play replay exports inverse equations and both colour-change directions', context => {
  const surfaces = canvases(context), source = {
    label: 'ZX puzzle', puzzle: LEVELS[4].diagram,
    sequence: [
      { rule: 'insert', edge: [0, 4], kind: 'z' }, { rule: 'identity', nodes: [6] },
      { rule: 'split', nodes: [4], phase: 1 }, { rule: 'fusion', nodes: [4, 6] },
      { rule: 'insert-hh', edge: [0, 4] }, { rule: 'hh', nodes: [6, 7] },
      { rule: 'add-hopf', nodes: [4, 5] }, { rule: 'hopf', nodes: [4, 5] },
      { rule: 'color', nodes: [4] }, { rule: 'color', nodes: [4] },
      ...solutions[4],
    ],
  }, saved = structuredClone(source), progress = [];
  assert.deepEqual(source.sequence.reduce(applyMove, source.puzzle), targetDiagram());
  const bytes = encodeReplay(source, value => progress.push(value)), frames = gifFrames(bytes), surface = surfaces[0];
  assert.equal(frames.length, 8 * source.sequence.length + 2, 'Every inverse and simplifying rewrite receives animation frames.');
  assert.ok(bytes.length < 256_000, 'The mixed replay stays within the compact export budget.');
  assert.ok(frames.slice(1).every(frame => frame.width === Math.ceil(720 * .73) && frame.height === 260));
  const final = surface.frames.at(-1);
  assert.equal(final.filter(({ name }) => name === 'quadraticCurveTo').length, 2);
  assert.ok(!final.some(({ name }) => name === 'arc'), 'The final diagram has no spiders or sectors.');
  assert.ok(!final.some(({ name, args }) => name === 'fillRect' && args[2] <= 26), 'The final diagram has no Hadamards.');
  surface.frames.forEach(cleanText);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  assert.deepEqual(source, saved, 'Export leaves the original diagram and full replay unchanged.');
});

test('invalid or unfinished exports fail before allocating a canvas', context => {
  const surfaces = canvases(context), source = round();
  for (const input of [null, {}, { ...source, label: null }, { ...source, label: 'x'.repeat(121) },
    { ...source, puzzle: { nodes: [], edges: [] } }, { ...source, sequence: null }, { ...source, sequence: [] },
    { ...source, sequence: [{}] }, { ...source, sequence: source.sequence.slice(0, -1) },
    { ...source, sequence: Array(MAX_MOVES + 1).fill(source.sequence[0]) }]) {
    for (const imageOnly of [false, true]) assert.throws(() => encodeReplay(input, undefined, imageOnly));
  }
  assert.equal(surfaces.length, 0);
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: undefined });
  assert.throws(() => encodeReplay(source), error => error.name === 'NotSupportedError');
});
