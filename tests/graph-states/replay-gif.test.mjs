import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/graph-states-gif-worker.js';
import { applyMove, MAX_MOVES, optimalShots, pathGraph, sequenceCost, solutionForGraph } from '../../src/lib/graph-states/engine.js';
import { CIRCUIT_COLORS as colors } from '../../src/lib/games/circuit-graphics.js';
import { REPLAY_COMPLEMENT_DURATION } from '../../src/lib/graph-states/animation.js';

function canvas(context) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas'), surfaces = [];
  context.after(() => { if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original); else delete globalThis.OffscreenCanvas; });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = [];
      let commands = [];
      this.commands = () => commands;
      this.context = Object.fromEntries(['scale', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'arc', 'closePath', 'fill', 'stroke', 'fillText']
        .map(name => [name, (...args) => commands.push({ name, args, fill: this.context.fillStyle, stroke: this.context.strokeStyle, width: this.context.lineWidth })]));
      this.context.getImageData = (_x, _y, w, h) => {
        this.frames.push(commands); commands = [];
        this.pixels ??= new Uint8ClampedArray(width * height * 4);
        return { data: this.pixels.subarray(0, w * h * 4) };
      };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  } });
  return surfaces;
}

function gifFrames(bytes) {
  const word = offset => bytes[offset] | bytes[offset + 1] << 8, frames = [];
  let offset = 13 + 3 * (1 << ((bytes[10] & 7) + 1)), delay;
  const blocks = () => { while (bytes[offset]) offset += bytes[offset] + 1; offset++; };
  while (bytes[offset] !== 0x3b) {
    const kind = bytes[offset++];
    if (kind === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) delay = word(offset + 2) * 10;
      blocks();
    } else {
      assert.equal(kind, 0x2c);
      const localPalette = Boolean(bytes[offset + 8] & 0x80);
      frames.push({ width: word(offset + 4), height: word(offset + 6), localPalette, delay });
      if (localPalette) offset += 3 * (1 << ((bytes[offset + 8] & 7) + 1));
      offset += 10; // Descriptor and LZW minimum code size.
      blocks();
    }
  }
  return frames;
}

test('still image compares the original graph with its target, without corrections or GIF pixel reads', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(8), { vertex: 1 });
  const sequence = Array.from({ length: 65 }, () => ({ vertex: 1 })), progress = [], saved = structuredClone(puzzle);
  const image = encodeReplay({ label: 'Completed graph', puzzle, sequence }, value => progress.push(value), true);
  assert.equal(image, surfaces[0]);
  assert.equal(image.width, 960); assert.equal(image.height, 520);
  assert.equal(image.frames.length, 0, 'Static export skips GIF pixel reads and palette conversion');
  const commands = image.commands(), text = commands.filter(command => command.name === 'fillText').map(command => command.args[0]);
  assert.equal(commands.filter(command => command.name === 'fillRect' && command.args[2] === 960).length, 1);
  assert.ok(text.includes('Original') && text.includes('Target'));
  assert.ok(text.includes('Optimal : 1') && text.includes('My score : 65'));
  assert.ok(text.every(label => !/Clifford|GG|https?:|colin-blake|\|G/.test(label)));
  assert.equal(commands.filter(command => command.name === 'arc' && command.args[4] - command.args[3] === 2 * Math.PI).length, 16);
  assert.ok(!commands.some(command => command.name === 'closePath'), 'The still image has no correction gates.');
  const edges = commands.filter(command => command.name === 'lineTo');
  assert.notEqual(puzzle.edges.length, pathGraph(8).edges.length, 'The original fixture differs from its solved graph.');
  assert.equal(edges.filter(command => command.args[0] < 480).length, puzzle.edges.length, 'The left graph retains the original edges.');
  assert.equal(edges.filter(command => command.args[0] > 480).length, pathGraph(8).edges.length);
  assert.deepEqual(progress, []);
  assert.deepEqual(puzzle, saved);
  assert.throws(() => encodeReplay({ label: 'Unsolved', puzzle, sequence: [{ vertex: 0 }] }, undefined, true));
});

test('graph replay keeps its graph, target and score in a compact frame without corrections or step counts', context => {
  const surfaces = canvas(context);
  for (const vertices of [3, 6]) {
    const puzzle = applyMove(pathGraph(vertices), { vertex: 1 }), sequence = solutionForGraph(puzzle), saved = structuredClone(puzzle);
    const progress = [];
    const bytes = encodeReplay({ label: 'Custom graph', puzzle, sequence }, value => progress.push(value));
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
    assert.equal(bytes.at(-1), 0x3b);
    assert.equal(bytes[6] | bytes[7] << 8, 720);
    assert.equal(bytes[8] | bytes[9] << 8, 390);
    const surface = surfaces.at(-1), text = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
    assert.equal(surface.frames.length, 16 * sequenceCost(sequence) + sequence.length + 1);
    assert.ok(text(surface.frames[0]).includes('Target'));
    assert.ok(surface.frames.every(frame => text(frame).every(label => !/Clifford|Step|\|G/.test(label))));
    assert.ok(surface.frames.every((frame, index) => frame.filter(command => command.name === 'arc' && command.args[2] === 21).length === (index ? vertices : 2 * vertices)),
      'The target is drawn once; subsequent frames animate only the current graph.');
    assert.ok(surface.frames.some(frame => frame.some(command => command.name === 'arc' && command.args[2] === 3.5 && command.fill === colors.h)),
      'Replay dots travel from the source to its neighbours.');
    assert.ok(surface.frames.some(frame => frame.some(command => command.name === 'arc' && command.fill === '#3d3825')),
      'Reached neighbours are highlighted before the edges change.');
    const shots = sequenceCost(sequence);
    assert.ok(text(surface.frames[0]).includes(`My score : ${shots}`) && text(surface.frames[0]).includes(`Optimal : ${optimalShots(puzzle)}`));
    assert.ok(surface.frames.every(frame => text(frame).every(label => !/0\.707|prototype|GG|colin-blake|https?:/i.test(label))));
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
    assert.deepEqual(puzzle, saved);
  }
});

test('GIF uses one stable palette and preserves the target while replacing only the left half', context => {
  canvas(context); const puzzle = applyMove(pathGraph(3), { vertex: 1 });
  const sequence = [{ vertex: 0 }, { vertex: 0 }, { vertex: 1 }];
  const bytes = encodeReplay({ label: 'Graph', puzzle, sequence });
  const paletteSize = 1 << ((bytes[10] & 7) + 1);
  const palette = Array.from({ length: paletteSize }, (_, index) => [...bytes.subarray(13 + index * 3, 16 + index * 3)]);
  for (const color of [colors.background, colors.text, colors.h, colors.z, '#f5f5f2', '#b6c4bb', '#3d3825']) {
    const rgb = [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16));
    assert.ok(palette.some(entry => entry.every((channel, index) => channel === rgb[index])));
  }
  const frames = gifFrames(bytes);
  assert.deepEqual(frames[0], { width: 720, height: 390, localPalette: false, delay: 700 });
  assert.ok(frames.slice(1).every(frame => frame.width === 360 && frame.height === 390 && !frame.localPalette),
    'A global palette and unchanged right side are not duplicated in every frame.');
});

test('a pivot replay compares its three shots with the two-shot optimum', context => {
  const surfaces = canvas(context), move = { edge: [0, 1] };
  const puzzle = applyMove(pathGraph(3), move);
  encodeReplay({ label: 'Pivot', puzzle, sequence: [move] }, undefined, true);
  const text = surfaces[0].commands().filter(command => command.name === 'fillText').map(command => command.args[0]);
  assert.ok(text.includes('My score : 3') && text.includes('Optimal : 2'));
});

test('a pivot animates its three successive complementations with both growing and erasing edges', context => {
  const surfaces = canvas(context), move = { edge: [0, 1] }, puzzle = applyMove(pathGraph(3), move);
  const bytes = encodeReplay({ label: 'Pivot', puzzle, sequence: [move] });
  const frames = surfaces[0].frames;
  assert.equal(frames.length, 3 * 16 + 2);
  const sources = [0, 1, 0];
  for (const [index, source] of sources.entries()) {
    const pulse = frames[1 + index * 16];
    const highlighted = pulse.filter(command => command.name === 'arc' && command.args[2] === 21 && command.stroke === colors.h);
    assert.equal(highlighted.length, 1);
    const label = pulse.find(command => command.name === 'fillText' && command.args[0] === String(source + 1));
    assert.deepEqual(highlighted[0].args.slice(0, 2), label.args.slice(1, 3));
  }
  const timing = gifFrames(bytes).map(frame => frame.delay);
  assert.equal(timing.filter(delay => delay === REPLAY_COMPLEMENT_DURATION / 16).length, 48, 'GIF and on-page replay use the same faster complementation pace.');
  assert.ok(frames.some(frame => frame.some(command => command.name === 'stroke' && command.stroke === '#f5f5f2' && command.width === 3.2)),
    'New edges are painted in white.');
  assert.ok(frames.some(frame => frame.some(command => command.name === 'stroke' && command.width === 2.8)),
    'Existing edges are erased as two shrinking halves.');
});

test('replays reject malformed, oversized and unsolved histories before drawing', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(4), { vertex: 1 });
  for (const sequence of [[], [{ vertex: -1 }], [{ edge: [0, 3] }], Array(MAX_MOVES + 1).fill({ vertex: 1 }), [{ vertex: 0 }]]) {
    assert.throws(() => encodeReplay({ label: 'Graph', puzzle, sequence }));
  }
  assert.throws(() => encodeReplay({ label: 'x'.repeat(241), puzzle, sequence: [{ vertex: 1 }] }));
  assert.equal(surfaces.length, 0);
});

test('replay bounds animation samples in long histories and retains the complete final graph', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(3), { vertex: 1 });
  const sequence = Array.from({ length: 65 }, () => ({ vertex: 1 }));
  encodeReplay({ label: 'Long graph replay', puzzle, sequence });
  const surface = surfaces[0];
  assert.equal(surface.frames.length, 64 * 17 + 1);
  const final = surface.frames.at(-1);
  assert.equal(final.filter(command => command.name === 'lineTo').length, pathGraph(3).edges.length);
  assert.equal(final.filter(command => command.name === 'arc' && command.args[2] === 21).length, 3);
  assert.ok(final.every(command => command.name !== 'fillText' || !/Clifford|Step|…/.test(command.args[0])));
});
