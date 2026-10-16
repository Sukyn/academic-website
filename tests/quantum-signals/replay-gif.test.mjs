import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/quantum-signals-gif-worker.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';
import { solvePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { CIRCUIT_COLORS as colors } from '../../src/lib/games/circuit-graphics.js';

const sequenceFor = puzzle => Object.entries(solvePuzzle(puzzle, { limit: 1 })[0]).map(([hole, gate]) => ({ hole, gate }));

function surfaces(context) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas'), result = [];
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original);
    else delete globalThis.OffscreenCanvas;
  });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    constructor(width, height) {
      this.width = width; this.height = height; this.frames = [];
      let commands = [], dash = [];
      this.context = Object.fromEntries(['fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'stroke', 'arc', 'fill', 'fillText', 'setLineDash']
        .map(name => [name, (...args) => commands.push({ name, args, dash: [...dash], fillStyle: this.context.fillStyle,
          strokeStyle: this.context.strokeStyle, lineWidth: this.context.lineWidth, alpha: this.context.globalAlpha ?? 1 })]));
      this.context.setLineDash = value => { dash = [...value]; };
      this.context.getImageData = () => {
        this.frames.push(commands); commands = [];
        this.pixels ??= new Uint8ClampedArray(width * height * 4);
        return { data: this.pixels };
      };
      result.push(this);
    }
    getContext() { return this.context; }
  } });
  return result;
}

test('replay encodes a regular circuit, basis paths and a complete winning frame', context => {
  const rendered = surfaces(context);
  for (const index of [0, 6, 7, 9, 11]) {
    const puzzle = LEVELS[index], solution = solvePuzzle(puzzle, { limit: 1 })[0];
    const sequence = Object.entries(solution).map(([hole, gate]) => ({ hole, gate })), saved = structuredClone(puzzle), progress = [];
    let final;
    const bytes = encodeReplay({ label: `Level ${index + 1}`, puzzle, sequence, optimalMoves: 987 },
      value => progress.push(value), value => { final = value; });
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
    const paletteSize = 1 << ((bytes[10] & 7) + 1);
    const palette = Array.from({ length: paletteSize }, (_, color) => [...bytes.subarray(13 + color * 3, 16 + color * 3)]);
    for (const color of [[0, 0, 0], [255, 255, 255], [182, 196, 187]]) {
      assert.ok(palette.some(entry => entry.every((channel, index) => channel === color[index])),
        'The encoded palette retains both phase colors and visible neutral paths');
    }
    assert.equal(bytes[bytes.length - 1], 0x3b);
    assert.equal(bytes[6] | bytes[7] << 8, 960);
    const flowTop = 246 + (puzzle.wires - 1) * 76;
    assert.equal(bytes[8] | bytes[9] << 8, flowTop + (2 ** puzzle.wires - 1) * 28 + 100);
    const surface = rendered.at(-1), texts = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
    assert.equal(final, surface);
    assert.equal(surface.frames.length, sequence.length + 1);
    assert.ok(texts(surface.frames[0]).includes('Fill the holes'));
    assert.ok(texts(surface.frames.at(-1)).includes('Target matched · GG'));
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !/optimal|gates placed|\d+ gates?/i.test(text))),
      'Replays display neither gate counts nor legacy benchmarks');
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !['Linked', '|0⟩', '|1⟩', '|+⟩', '|−⟩'].includes(text))),
      'Circuit wires never display local state tokens');
    assert.ok(surface.frames.every(frame => texts(frame).includes('Output') && texts(frame).includes('Target')));
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !text.includes('⟩') && !text.includes('0.707'))),
      'The path view avoids coefficient equations');
    assert.ok(surface.frames.every(frame => texts(frame).includes('Photon paths')));
    const step = Math.min(88, 740 / puzzle.columns.length);
    const targetX = (960 + step * puzzle.columns.length) / 2 + 54;
    const targets = surface.frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === targetX && command.lineWidth === 2);
    const expected = puzzle.target.flatMap((amplitude, basis) => Math.abs(amplitude) < 1e-9 ? [] :
      [{ y: flowTop + basis * 28, radius: Math.min(6, 16 * Math.abs(amplitude)), color: amplitude < 0 ? '#ffffff' : '#000000',
        outline: '#ffffff' }]);
    assert.deepEqual(targets.map(command => ({ y: command.args[1], radius: command.args[2], color: command.fillStyle, outline: command.strokeStyle })), expected,
      'The target keeps fixed basis positions, bounded marker sizes and white outlines');
    if (index === 11) assert.ok(targets.every(command => Math.abs(command.args[2] - 4 * Math.SQRT2) < 1e-9),
      'Level 12 keeps its original target size below the six-pixel cap');
    const emptyTargets = surface.frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === targetX && command.strokeStyle === colors.wire);
    assert.ok(emptyTargets.every(command => command.args[2] === 6), 'Empty guides use the same maximum target size');
    const right = targetX - 54;
    const separator = surface.frames.at(-1).find(command => command.name === 'moveTo' &&
      command.args[0] === right + 26 && command.args[1] === flowTop - 44);
    assert.equal(separator?.strokeStyle, colors.wire, 'A separate target panel starts after the output');
    assert.ok(surface.frames.at(-1).some(command => command.name === 'lineTo' &&
      command.args[0] === right + 26 && command.args[1] === flowTop + (2 ** puzzle.wires - 1) * 28 + 16));
    assert.ok(surface.frames.every(frame => frame.every(command => !command.dash.length)),
      'Phase uses solid black/white dots without dashed wires or borders');
    assert.ok(surface.frames.every(frame => frame.filter(command => command.name === 'bezierCurveTo')
      .every(command => command.strokeStyle === '#b6c4bb')), 'Every phase has the same visible neutral path');
    for (let basis = 0; basis < 2 ** puzzle.wires; basis++) {
      const lane = surface.frames.at(-1).find(command => command.name === 'lineTo' &&
        command.args[0] === right && command.args[1] === flowTop + basis * 28 && command.strokeStyle === colors.wire);
      assert.ok(lane, 'Each state lane stops at Output before the target divider');
    }
    if (index === 7) {
      const commands = surface.frames.at(-1);
      assert.ok(commands.some(command => command.name === 'arc' && command.fillStyle === '#ffffff' && command.strokeStyle === '#000000' && command.lineWidth === 1.4),
        'Negative boundary amplitudes are white with black outlines');
      assert.ok(targets.some(command => command.fillStyle === '#ffffff' && command.strokeStyle === '#ffffff' && command.lineWidth === 2),
        'Negative target amplitudes remain solid white');
    }
    assert.ok(surface.frames.every(frame => !texts(frame).includes('⊕')), 'X gates use geometry independent of fonts');
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
    assert.deepEqual(puzzle, saved);
  }
});

test('replay circuit wires stay white, straight and centered for every state', context => {
  const rendered = surfaces(context);
  for (const index of [0, 1, 2, 6, 9]) {
    const puzzle = LEVELS[index];
    encodeReplay({ label: 'White wires', puzzle, sequence: sequenceFor(puzzle) });
    const commands = rendered.at(-1).frames.at(-1), step = Math.min(88, 740 / puzzle.columns.length);
    const left = (960 - step * puzzle.columns.length) / 2;
    for (let row = 0; row < puzzle.wires; row++) {
      const y = 154 + row * 76;
      const start = commands.find(command => command.name === 'moveTo' && command.args[0] === left - 20 && command.args[1] === y);
      const end = commands.find(command => command.name === 'lineTo' && command.args[0] === left + puzzle.columns.length * step + 20 && command.args[1] === y);
      assert.equal(start.strokeStyle, '#f5f5f2'); assert.equal(end.strokeStyle, '#f5f5f2');
      assert.deepEqual(start.dash, []); assert.deepEqual(end.dash, []);
    }
  }
});

test('replay basis paths distinguish Bell correlations and show interference', context => {
  const rendered = surfaces(context), bell = structuredClone(LEVELS[6]);
  const opposite = structuredClone(bell);
  opposite.columns.push([{ gate: 'X', wires: [1] }]);
  opposite.target = [0, Math.SQRT1_2, Math.SQRT1_2, 0];
  for (const [puzzle, occupied] of [[bell, [0, 3]], [opposite, [1, 2]]]) {
    encodeReplay({ label: 'Bell paths', puzzle, sequence: [{ hole: 'a', gate: 'CX' }] });
    const step = Math.min(88, 740 / puzzle.columns.length), right = (960 + step * puzzle.columns.length) / 2;
    const flowTop = 246 + 76;
    const dots = rendered.at(-1).frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === right && command.args[1] >= flowTop);
    assert.deepEqual(dots.map(command => (command.args[1] - flowTop) / 28), occupied,
      'Complete basis states remain separate even when all local qubit states agree');
    assert.ok(dots.every(command => command.fillStyle === '#000000' && command.strokeStyle === '#ffffff'),
      'Positive amplitudes have the same black fill and white outline across distinct basis states');
  }
  encodeReplay({ label: 'Interference', puzzle: LEVELS[3], sequence: [{ hole: 'a', gate: 'H' }] });
  const commands = rendered.at(-1).frames.at(-1), right = 568;
  assert.ok(commands.some(command => command.name === 'bezierCurveTo' && command.strokeStyle === '#b6c4bb'),
    'Interfering contributions remain visible as neutral paths');
  assert.ok(commands.some(command => command.name === 'bezierCurveTo' && command.args.join() === '436,246,436,274,480,274'),
    'Hadamard branches curve between fixed lanes below the corresponding gate');
  assert.deepEqual(commands.filter(command => command.name === 'arc' && command.args[0] === right && command.args[1] >= 246)
    .map(command => command.args[1]), [246], 'A canceled path has no output photon marker');
});

test('replay controls align exactly on white wires, including reversed and distant endpoints', context => {
  const rendered = surfaces(context);
  for (const control of [0, 2]) {
    const target = 2 - control, puzzle = {
      wires: 3,
      columns: [[{ gate: 'H', wires: [control] }], [{ gate: 'CX', wires: [control, target] }],
        [{ id: 'a', wires: [0], choices: ['I', 'Z'] }]],
      target: [Math.SQRT1_2, 0, 0, 0, 0, Math.SQRT1_2, 0, 0],
    };
    encodeReplay({ label: 'Distant control', puzzle, sequence: [{ hole: 'a', gate: 'I' }] });
    const commands = rendered.at(-1).frames.at(-1);
    const controlY = 154 + control * 76, targetY = 154 + target * 76;
    assert.ok(commands.some(command => command.name === 'arc' && command.args[0] === 480 && command.args[1] === controlY && command.fillStyle === colors.z));
    assert.ok(commands.some(command => command.name === 'arc' && command.args[0] === 480 && command.args[1] === targetY && command.strokeStyle === colors.x));
    assert.ok(commands.some(command => command.name === 'moveTo' && command.args[0] === 480 && command.args[1] === controlY && command.strokeStyle === colors.z));
    assert.ok(commands.some(command => command.name === 'lineTo' && command.args[0] === 480 && command.args[1] === targetY && command.strokeStyle === colors.z));
    assert.ok(commands.some(command => command.name === 'moveTo' && command.args[1] === 230 && command.strokeStyle === '#f5f5f2'),
      'The middle wire is straight through its own center');
  }
});

test('opposite CNOTs keep their declared direction in fixed gates and editable replay frames', context => {
  const rendered = surfaces(context), flowTop = 398;
  for (const wires of [[0, 2], [2, 0]]) for (const fixed of [true, false]) {
    const control = wires[1], destination = wires[0], inputBasis = 1 << (2 - control);
    const target = Array(8).fill(0); target[5] = 1;
    const puzzle = { wires: 3, columns: [
      [{ gate: 'X', wires: [control] }],
      [fixed ? { gate: 'XC', wires } : { id: 'a', wires, choices: ['I', 'CX', 'XC', 'CZ'] }],
      fixed ? [{ id: 'spare', wires: [0], choices: ['I', 'Z'] }] : [],
    ], target };
    const sequence = fixed ? [{ hole: 'spare', gate: 'I' }] :
      [{ hole: 'a', gate: 'CX' }, { hole: 'a', gate: null }, { hole: 'a', gate: 'XC' }];
    encodeReplay({ label: 'Opposite CNOT', puzzle, sequence });
    const frames = rendered.at(-1).frames, commands = frames.at(-1);
    const glyphAt = (frame, row, color) => frame.some(command => command.name === 'arc' &&
      command.args[0] === 480 && command.args[1] === 154 + row * 76 && command.strokeStyle === color);
    assert.ok(glyphAt(commands, control, colors.z), 'XC puts its control on the second declared wire');
    assert.ok(glyphAt(commands, destination, colors.x), 'XC puts its target on the first declared wire');
    assert.ok(commands.some(command => command.name === 'moveTo' && command.args.join() === [480, 154 + wires[0] * 76].join() && command.strokeStyle === colors.z));
    assert.ok(commands.some(command => command.name === 'lineTo' && command.args.join() === [480, 154 + wires[1] * 76].join() && command.strokeStyle === colors.z));
    assert.ok(commands.some(command => command.name === 'bezierCurveTo' && command.args.join() ===
      [480, flowTop + inputBasis * 28, 480, flowTop + 5 * 28, 524, flowTop + 5 * 28].join()),
    'The opposite CNOT routes the occupied basis lane using the same control direction');
    assert.deepEqual(commands.filter(command => command.name === 'arc' && command.args[0] === 612 && command.args[1] >= flowTop)
      .map(command => (command.args[1] - flowTop) / 28), [5], 'The final photon reaches the flipped output basis');
    if (fixed) {
      assert.ok(frames.every(frame => glyphAt(frame, control, colors.z)), 'Fixed XC gates retain their direction throughout the replay');
    } else {
      assert.ok(glyphAt(frames[1], destination, colors.z), 'An earlier CX assignment uses the other control');
      assert.ok(glyphAt(frames[1], control, colors.x), 'The earlier assignment also reverses the target');
      assert.ok([frames[0], frames[2]].every(frame => !frame.some(command => command.name === 'arc' &&
        command.args[0] === 480 && command.args[1] < flowTop)), 'Unfilled and erased replay frames have no leftover gate');
      assert.ok(frames[1].some(command => command.name === 'bezierCurveTo' && command.args.join() ===
        [480, flowTop + inputBasis * 28, 480, flowTop + inputBasis * 28, 524, flowTop + inputBasis * 28].join()),
      'The other CNOT direction leaves this input unchanged');
    }
  }
});

test('replay validates every assignment and caps sampled frames', context => {
  const rendered = surfaces(context), puzzle = LEVELS[0], sequence = [...Array(129).fill({ hole: 'a', gate: 'I' }), { hole: 'a', gate: 'X' }];
  encodeReplay({ label: 'Edits', puzzle, sequence });
  assert.equal(rendered[0].frames.length, 65);
  for (const changes of [{ sequence: [] }, { sequence: [null] }, { sequence: [{ hole: 'a', gate: 'H' }] },
    { sequence: [{ hole: 'a', gate: 'I' }] }, { sequence: [{ hole: 'a', gate: 'X' }, { hole: 'a', gate: null }] },
    { sequence: Array(1001).fill({ hole: 'a', gate: 'X' }) }, { label: 'x'.repeat(241) },
    { sequence: [{ hole: 'unknown', gate: 'X' }, ...sequence] }]) {
    assert.throws(() => encodeReplay({ label: 'Level 1', puzzle, sequence: sequenceFor(puzzle), ...changes }));
  }
});

test('empty and identity holes are translucent boxes over uninterrupted white wires', context => {
  const rendered = surfaces(context);
  encodeReplay({ label: 'Transparent holes', puzzle: LEVELS[0],
    sequence: [{ hole: 'a', gate: 'I' }, { hole: 'a', gate: 'X' }] });
  const frames = rendered[0].frames;
  for (const commands of frames.slice(0, 2)) {
    const box = commands.findIndex(command => command.name === 'fillRect' && command.args[2] < 960);
    assert.ok(box > 0, 'Empty and identity holes retain a box');
    assert.ok(commands[box].alpha > 0 && commands[box].alpha < 1, 'The fill lets the signal show through');
    assert.ok(commands.slice(0, box).some(command => command.name === 'lineTo' && command.strokeStyle === '#f5f5f2'),
      'The white wire continues behind the box');
    assert.ok(commands.slice(box + 1).some(command => command.name === 'strokeRect' && command.alpha === 1),
      'The box border stays visible');
    assert.ok(commands.every(command => command.name !== 'fillRect' || command.args[1] >= 230 || command.args[2] === 960 || command.alpha < 1),
      'No opaque gate rectangle erases the wire');
  }
  assert.ok(frames.every(commands => commands.every(command => command.name !== 'fillText' || !['?', 'I'].includes(command.args[0]))));
});

test('replay keeps sixteen fixed outcomes within the canvas and ignores a global target sign', context => {
  const rendered = surfaces(context);
  const puzzle = { wires: 4, columns: [[{ id: 'a', wires: [0], choices: ['I', 'X'] }]],
    target: [-1, ...Array(15).fill(0)] };
  encodeReplay({ label: 'Four qubits', puzzle, sequence: [{ hole: 'a', gate: 'I' }] });
  const surface = rendered[0], commands = surface.frames.at(-1);
  const labels = commands.filter(command => command.name === 'fillText' && /^[01]{4}$/.test(command.args[0]));
  assert.deepEqual(labels.map(command => command.args[0]), Array.from({ length: 16 }, (_, basis) => basis.toString(2).padStart(4, '0')));
  assert.ok(commands.filter(command => command.name === 'arc').every(command => command.args[1] + command.args[2] < surface.height - 56),
    'Every probability marker remains above the replay footer');
  const target = commands.findIndex(command => command.name === 'arc' && command.args[0] === 578 && command.args[2] === 6 && command.strokeStyle === '#ffffff');
  assert.ok(target >= 0, 'An equivalent globally negative target retains a full probability marker');
  assert.equal(commands[target].fillStyle, '#000000', 'One global target sign aligns with the positive output');
  assert.ok(!commands.slice(target + 1).some(command => command.name === 'moveTo' && command.args[0] >= 570 && command.args[0] <= 586),
    'Target phase aligns with the output without introducing a false relative minus');

  const dense = { wires: 4, columns: [
    Array.from({ length: 4 }, (_, wire) => ({ gate: 'H', wires: [wire] })),
    [{ gate: 'Z', wires: [0] }], [{ id: 'spare', wires: [0], choices: ['I', 'Z'] }],
  ], target: Array.from({ length: 16 }, (_, basis) => basis < 8 ? .25 : -.25) };
  encodeReplay({ label: 'Dense phases', puzzle: dense, sequence: [{ hole: 'spare', gate: 'I' }] });
  const denseFrame = rendered.at(-1).frames.at(-1);
  const targets = denseFrame.filter(command => command.name === 'arc' && command.args[0] === 666 && command.lineWidth === 2);
  assert.equal(targets.length, 16);
  assert.ok(targets.every(command => command.args[2] === 4), 'Even sixteen equal outcomes retain an eight-pixel target diameter');
  assert.deepEqual(targets.map(command => command.fillStyle), [...Array(8).fill('#000000'), ...Array(8).fill('#ffffff')],
    'Dense targets keep a black or white center without changing phase');
  assert.deepEqual(targets.map(command => command.strokeStyle), Array(16).fill('#ffffff'),
    'Every dense target retains a white outline for either phase');
  assert.ok(!denseFrame.some(command => command.name === 'arc' && command.args[0] === 666 && command.strokeStyle === colors.wire),
    'Filled target markers use their own border without a second empty-outcome ring');
});

test('replay reports unavailable canvas support', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original);
    else delete globalThis.OffscreenCanvas;
  });
  delete globalThis.OffscreenCanvas;
  assert.throws(() => encodeReplay({ puzzle: LEVELS[0] }), error => error.name === 'NotSupportedError');
});

test('prototype-named holes stay visibly unfilled until a gate is assigned', context => {
  const rendered = surfaces(context);
  for (const id of ['constructor', 'toString']) {
    const puzzle = structuredClone(LEVELS[0]); puzzle.columns[0][0].id = id;
    encodeReplay({ label: 'Custom circuit', puzzle, sequence: [{ hole: id, gate: 'X' }] });
    const commands = rendered.at(-1).frames[0];
    assert.ok(commands.some(command => command.name === 'fillRect' && command.alpha > 0 && command.alpha < 1));
    assert.ok(commands.every(command => command.name !== 'fillText' || command.args[0] !== '?'));
    assert.ok(commands.every(command => command.name !== 'fillText' || typeof command.args[0] === 'string'));
  }
});
