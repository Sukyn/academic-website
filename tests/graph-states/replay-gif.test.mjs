import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/graph-states-gif-worker.js';
import { applyMove, MAX_MOVES, optimalShots, pathGraph, sequenceCost, solutionForGraph } from '../../src/lib/graph-states/engine.js';
import { CIRCUIT_COLORS as colors } from '../../src/lib/games/circuit-graphics.js';

function canvas(context) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas'), surfaces = [];
  context.after(() => { if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original); else delete globalThis.OffscreenCanvas; });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = [];
      let commands = [];
      this.commands = () => commands;
      this.context = Object.fromEntries(['fillRect', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'arc', 'closePath', 'fill', 'stroke', 'fillText']
        .map(name => [name, (...args) => commands.push({ name, args, fill: this.context.fillStyle, stroke: this.context.strokeStyle, width: this.context.lineWidth })]));
      this.context.getImageData = () => { this.frames.push(commands); commands = []; return { data: this.pixels ??= new Uint8ClampedArray(width * height * 4) }; };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  } });
  return surfaces;
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

test('graph replay includes the labelled graph, target, and Clifford corrections', context => {
  const surfaces = canvas(context);
  for (const vertices of [3, 6]) {
    const puzzle = applyMove(pathGraph(vertices), { vertex: 1 }), sequence = solutionForGraph(puzzle), saved = structuredClone(puzzle);
    const progress = [];
    const bytes = encodeReplay({ label: 'Custom graph', puzzle, sequence }, value => progress.push(value));
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
    assert.equal(bytes.at(-1), 0x3b);
    assert.equal(bytes[6] | bytes[7] << 8, 960);
    assert.equal(bytes[8] | bytes[9] << 8, 656 + (vertices - 1) * 48);
    const surface = surfaces.at(-1), text = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
    assert.equal(surface.frames.length, 16 * sequenceCost(sequence) + sequence.length + 1);
    assert.ok(surface.frames.every(frame => text(frame).includes('Target') && text(frame).includes('Clifford corrections · simplified')));
    assert.ok(text(surface.frames.at(-1)).includes(`Step ${sequence.length} / ${sequence.length}`));
    assert.ok(surface.frames.at(-1).some(command => command.name === 'closePath'), 'Phase gates retain their vector cutouts.');
    assert.ok(surface.frames.at(-1).some(command => command.name === 'fillRect' && command.fill === '#f2d572'));
    assert.ok(surface.frames.every(frame => frame.filter(command => command.name === 'arc' && command.args[2] === 21).length === 2 * vertices));
    assert.ok(surface.frames.some(frame => frame.some(command => command.name === 'arc' && command.args[2] === 3.5 && command.fill === colors.h)),
      'Replay dots travel from the source to its neighbours.');
    assert.ok(surface.frames.some(frame => frame.some(command => command.name === 'arc' && command.fill === '#3d3825')),
      'Reached neighbours are highlighted before the edges change.');
    const shots = sequenceCost(sequence);
    assert.ok(surface.frames.every(frame => text(frame).includes(`My score : ${shots}`) && text(frame).includes(`Optimal : ${optimalShots(puzzle)}`)));
    assert.ok(surface.frames.every(frame => text(frame).every(label => !/0\.707|prototype|GG|colin-blake|https?:/i.test(label))));
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
    assert.deepEqual(puzzle, saved);
  }
});

test('GIF palette preserves the pink X gate in simplified Clifford corrections', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(3), { vertex: 1 });
  const sequence = [{ vertex: 0 }, { vertex: 0 }, { vertex: 1 }];
  const bytes = encodeReplay({ label: 'X correction', puzzle, sequence });
  assert.ok(surfaces[0].frames.at(-1).some(command => command.name === 'arc' && command.stroke === colors.x),
    'The completed replay has an X correction to preserve.');
  const paletteSize = 1 << ((bytes[10] & 7) + 1);
  const palette = Array.from({ length: paletteSize }, (_, index) => [...bytes.subarray(13 + index * 3, 16 + index * 3)]);
  const pink = [1, 3, 5].map(start => parseInt(colors.x.slice(start, start + 2), 16));
  assert.ok(palette.some(entry => entry.every((channel, index) => channel === pink[index])),
    'The encoded GIF retains the gate colour instead of quantizing it to grey.');
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
  const timing = [];
  for (let offset = 0; offset + 7 < bytes.length; offset++) {
    if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9 && bytes[offset + 2] === 4) timing.push((bytes[offset + 4] | bytes[offset + 5] << 8) * 10);
  }
  assert.equal(timing.filter(delay => delay === 150).length, 48, 'Every complementation retains its 2400 ms duration');
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

test('replay bounds animation samples in long histories and simplifies the complete correction', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(3), { vertex: 1 });
  const sequence = Array.from({ length: 65 }, () => ({ vertex: 1 }));
  encodeReplay({ label: 'Long graph replay', puzzle, sequence });
  const surface = surfaces[0];
  assert.equal(surface.frames.length, 64 * 17 + 1);
  const final = surface.frames.at(-1);
  assert.ok(final.some(command => command.name === 'fillText' && command.args[0] === '|G₀⟩'));
  assert.ok(!final.some(command => command.name === 'fillText' && command.args[0] === '…'), 'No earlier corrections are truncated.');
  assert.equal(final.filter(command => command.name === 'fillRect' && command.fill === '#f2d572').length, 2);
  assert.ok(final.filter(command => command.name === 'fillRect' && command.args[0] !== 0).every(command => command.args[0] > 300 && command.args[0] < 674));
});
