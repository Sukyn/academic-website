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
        .map(name => [name, (...args) => commands.push({ name, args, fill: this.context.fillStyle, stroke: this.context.strokeStyle })]));
      this.context.getImageData = () => { this.frames.push(commands); commands = []; return { data: this.pixels ??= new Uint8ClampedArray(width * height * 4) }; };
      surfaces.push(this);
    }
    getContext() { return this.context; }
  } });
  return surfaces;
}

test('still image draws only the completed graph and complete simplified corrections, without GIF pixel reads', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(8), { vertex: 1 });
  const sequence = Array.from({ length: 65 }, () => ({ vertex: 1 })), progress = [], saved = structuredClone(puzzle);
  const image = encodeReplay({ label: 'Completed graph', puzzle, sequence }, value => progress.push(value), true);
  assert.equal(image, surfaces[0]);
  assert.equal(image.width, 960); assert.equal(image.height, 992);
  assert.equal(image.frames.length, 0, 'Static export skips GIF pixel reads and palette conversion');
  const commands = image.commands(), text = commands.filter(command => command.name === 'fillText').map(command => command.args[0]);
  assert.equal(commands.filter(command => command.name === 'fillRect' && command.args[2] === 960).length, 1);
  assert.ok(text.includes('Chain matched · GG'));
  assert.ok(text.includes('Clifford corrections · simplified'));
  assert.ok(text.includes('65 shots · Optimal: 1'));
  assert.equal(commands.filter(command => command.name === 'arc' && command.args[4] - command.args[3] === 2 * Math.PI).length, 16);
  assert.ok(commands.some(command => command.name === 'closePath'), 'The final simplified phase correction retains its split dot');
  assert.deepEqual(commands.filter(command => command.name === 'fillText' && command.args[1] === 286).map(command => command.args[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);
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
    assert.equal(surface.frames.length, sequence.length + 1);
    assert.ok(surface.frames.every(frame => text(frame).includes('Target') && text(frame).includes('Clifford corrections · simplified')));
    assert.ok(text(surface.frames.at(-1)).includes('Chain matched · GG'));
    assert.ok(surface.frames.at(-1).some(command => command.name === 'closePath'), 'Phase gates retain their vector cutouts.');
    assert.ok(surface.frames.at(-1).some(command => command.name === 'fillRect' && command.fill === '#f2d572'));
    assert.ok(surface.frames.every(frame => frame.filter(command => command.name === 'arc' && command.args[4] - command.args[3] === 2 * Math.PI).length === 2 * vertices));
    const shots = sequenceCost(sequence);
    assert.ok(surface.frames.every(frame => text(frame).includes(`${shots} ${shots === 1 ? 'shot' : 'shots'} · Optimal: ${optimalShots(puzzle)}`)));
    assert.ok(surface.frames.every(frame => text(frame).every(label => !/0\.707|prototype/i.test(label))));
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
  assert.ok(text.includes('3 shots · Optimal: 2'));
});

test('replays reject malformed, oversized and unsolved histories before drawing', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(4), { vertex: 1 });
  for (const sequence of [[], [{ vertex: -1 }], [{ edge: [0, 3] }], Array(MAX_MOVES + 1).fill({ vertex: 1 }), [{ vertex: 0 }]]) {
    assert.throws(() => encodeReplay({ label: 'Graph', puzzle, sequence }));
  }
  assert.throws(() => encodeReplay({ label: 'x'.repeat(241), puzzle, sequence: [{ vertex: 1 }] }));
  assert.equal(surfaces.length, 0);
});

test('replay limits long histories to 65 sampled frames and simplifies the complete correction', context => {
  const surfaces = canvas(context), puzzle = applyMove(pathGraph(3), { vertex: 1 });
  const sequence = Array.from({ length: 65 }, () => ({ vertex: 1 }));
  encodeReplay({ label: 'Long graph replay', puzzle, sequence });
  const surface = surfaces[0];
  assert.equal(surface.frames.length, 65);
  const final = surface.frames.at(-1);
  assert.ok(final.some(command => command.name === 'fillText' && command.args[0] === '|G₀⟩'));
  assert.ok(!final.some(command => command.name === 'fillText' && command.args[0] === '…'), 'No earlier corrections are truncated.');
  assert.equal(final.filter(command => command.name === 'fillRect' && command.fill === '#f2d572').length, 2);
  assert.ok(final.filter(command => command.name === 'fillRect' && command.args[0] !== 0).every(command => command.args[0] > 300 && command.args[0] < 674));
});
