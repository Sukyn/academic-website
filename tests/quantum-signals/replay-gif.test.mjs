import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay } from '../../src/scripts/quantum-signals-gif-worker.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';
import { goalState, solvePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { CIRCUIT_COLORS as colors } from '../../src/lib/games/circuit-graphics.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { GOAL_COLOR, GOAL_RADIUS, PHASE_PATH_COLORS, phasePathColor } from '../../src/lib/quantum-signals/state-visuals.js';

const sequenceFor = puzzle => Object.entries(solvePuzzle(puzzle, { limit: 1 })[0]).map(([hole, gate]) => ({ hole, gate }));

function pathColors(commands, puzzle, placements, flowTop = 246 + (puzzle.wires - 1) * 76, rowHeight = 28) {
  const paths = commands.filter(command => command.name === 'bezierCurveTo');
  const columns = flowTrace(puzzle, placements).columns, edges = columns.flat();
  assert.deepEqual(paths.map(path => path.strokeStyle), edges.map(edge => phasePathColor(edge.amplitude)),
    'Every path follows its signed contribution, including phase changes and interference');
  assert.deepEqual(paths.map(path => path.lineWidth), edges.map(edge => 2 + 4 * Math.abs(edge.amplitude)),
    'Path weight still follows amplitude magnitude');
  const step = rowHeight === 38 ? 740 / puzzle.columns.length : Math.min(88, 740 / puzzle.columns.length);
  const left = (960 - step * puzzle.columns.length) / 2;
  const rounded = values => values.map(value => Number(value.toFixed(6)));
  assert.deepEqual(paths.map(path => rounded(path.args)), columns.flatMap((edges, column) => edges.map(edge => rounded([
    left + (column + .5) * step, flowTop + edge.from * rowHeight,
    left + (column + .5) * step, flowTop + edge.to * rowHeight,
    left + (column + 1) * step, flowTop + edge.to * rowHeight,
  ]))), 'PNG and GIF paths connect the same basis states at their binary-ordered positions');
  const dots = commands.filter(command => command.name === 'arc' && command.args[1] >= flowTop &&
    [1.4, 2].includes(command.lineWidth));
  assert.ok(dots.length > 0);
  assert.ok(dots.every(dot => dot.strokeStyle === '#ffffff'), 'All intermediate and target phases retain white outlines');
}

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
      this.commands = () => commands;
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

test('still image shows only the completed expanded paths and round label, without GIF pixel reads', context => {
  const rendered = surfaces(context);
  for (const index of [0, 7, 11]) {
    const puzzle = LEVELS[index], sequence = sequenceFor(puzzle), saved = structuredClone(puzzle), progress = [];
    const label = 'Level : ' + (index + 1);
    const image = encodeReplay({ label, puzzle, sequence }, value => progress.push(value), true);
    assert.equal(image, rendered.at(-1));
    assert.equal(image.width, 960);
    assert.equal(image.frames.length, 0, 'Static export skips GIF pixel reads and palette conversion');
    const commands = image.commands(), texts = commands.filter(command => command.name === 'fillText').map(command => command.args[0]);
    assert.deepEqual(texts, [label, ...Array.from({ length: 2 ** puzzle.wires }, (_, row) => row.toString(2).padStart(puzzle.wires, '0'))],
      'The share card has no headings, status, link or redundant target');
    assert.equal(commands.filter(command => command.name === 'fillRect').length, 1,
      'No regular gate board or selected-hole boxes accompany the expanded paths');
    assert.ok(!commands.some(command => command.name === 'strokeRect'));
    const flowTop = (image.height + 48 - (2 ** puzzle.wires - 1) * 38) / 2;
    pathColors(commands, puzzle, Object.fromEntries(sequence.map(({ hole, gate }) => [hole, gate])), flowTop, 38);
    assert.equal(commands.filter(command => command.name === 'arc' && command.args[0] === 850).length,
      puzzle.target.filter(amplitude => Math.abs(amplitude) > 1e-9).length,
      'The final state is shown once at the right end of the paths');
    assert.ok(commands.filter(command => command.name === 'arc').every(command => command.args[1] + command.args[2] < image.height - 32),
      'All expanded states fit within the compact card');
    assert.deepEqual(progress, []);
    assert.deepEqual(puzzle, saved);
  }
  assert.throws(() => encodeReplay({ label: 'Unsolved', puzzle: LEVELS[0], sequence: [{ hole: 'a', gate: 'I' }] }, undefined, true));
});

test('replay encodes a regular circuit, basis paths and a complete winning frame', context => {
  const rendered = surfaces(context);
  for (const index of [0, 6, 7, 9, 11]) {
    const puzzle = LEVELS[index], solution = solvePuzzle(puzzle, { limit: 1 })[0];
    const sequence = Object.entries(solution).map(([hole, gate]) => ({ hole, gate })), saved = structuredClone(puzzle), progress = [];
    const bytes = encodeReplay({ label: `Level ${index + 1}`, puzzle, sequence, optimalMoves: 987 },
      value => progress.push(value));
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a');
    const paletteSize = 1 << ((bytes[10] & 7) + 1);
    const palette = Array.from({ length: paletteSize }, (_, color) => [...bytes.subarray(13 + color * 3, 16 + color * 3)]);
    for (const color of [[0, 0, 0], [255, 255, 255], [245, 245, 242], [109, 123, 113],
      ...Object.values(PHASE_PATH_COLORS).map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)))]) {
      assert.ok(palette.some(entry => entry.every((channel, index) => channel === color[index])),
        'The encoded palette retains both dot fills and signed path colors');
    }
    assert.equal(bytes[bytes.length - 1], 0x3b);
    assert.equal(bytes[6] | bytes[7] << 8, 960);
    const flowTop = 246 + (puzzle.wires - 1) * 76;
    assert.equal(bytes[8] | bytes[9] << 8, flowTop + (2 ** puzzle.wires - 1) * 28 + 100);
    const surface = rendered.at(-1), texts = frame => frame.filter(command => command.name === 'fillText').map(command => command.args[0]);
    assert.equal(surface.frames.length, sequence.length + 1);
    assert.ok(surface.frames.every(frame => texts(frame).includes(`Level ${index + 1}`)));
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !/GG|colin-blake|https?:|Photon paths|Match the target/.test(text))),
      'Replay frames keep the same clean label without links or congratulatory copy');
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !/optimal|gates placed|\d+ gates?/i.test(text))),
      'Replays display neither gate counts nor legacy benchmarks');
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !['Linked', '|0⟩', '|1⟩', '|+⟩', '|−⟩'].includes(text))),
      'Circuit wires never display local state tokens');
    assert.ok(surface.frames.every(frame => texts(frame).includes('Output') && texts(frame).includes('Goal')));
    assert.ok(surface.frames.every(frame => texts(frame).every(text => !text.includes('⟩') && !text.includes('0.707'))),
      'The path view avoids coefficient equations');
    const step = Math.min(88, 740 / puzzle.columns.length);
    const targetX = (960 + step * puzzle.columns.length) / 2 + 54;
    const targets = surface.frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === targetX && command.lineWidth === 2.5);
    assert.deepEqual(targets.map(command => ({ y: command.args[1], radius: command.args[2], outline: command.strokeStyle })),
      [{ y: flowTop + (2 ** puzzle.wires - 1) * 28, radius: GOAL_RADIUS, outline: GOAL_COLOR }],
      'The phase-neutral goal is one fixed capture ring at the all-ones row');
    const emptyTargets = surface.frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === targetX && command.strokeStyle === colors.wire);
    assert.equal(emptyTargets.length, 0, 'Other outcomes do not add unused goal markers');
    const right = targetX - 54;
    const separator = surface.frames.at(-1).find(command => command.name === 'moveTo' &&
      command.args[0] === right + 26 && command.args[1] === flowTop - 44);
    assert.equal(separator?.strokeStyle, colors.wire, 'A separate target panel starts after the output');
    assert.ok(surface.frames.at(-1).some(command => command.name === 'lineTo' &&
      command.args[0] === right + 26 && command.args[1] === flowTop + (2 ** puzzle.wires - 1) * 28 + 16));
    assert.ok(surface.frames.every(frame => frame.every(command => !command.dash.length)),
      'Phase uses solid black/white dots without dashed wires or borders');
    surface.frames.forEach((frame, index) => pathColors(frame, puzzle,
      Object.fromEntries(sequence.slice(0, index).map(({ hole, gate }) => [hole, gate]))));
    for (let basis = 0; basis < 2 ** puzzle.wires; basis++) {
      const lane = surface.frames.at(-1).find(command => command.name === 'lineTo' &&
        command.args[0] === right && command.args[1] === flowTop + basis * 28 && command.strokeStyle === colors.wire);
      assert.ok(lane, 'Each state lane stops at Output before the target divider');
    }
    if (index === 7) {
      const commands = surface.frames.at(-1);
      assert.ok(commands.some(command => command.name === 'arc' && command.fillStyle === '#ffffff' && command.strokeStyle === '#ffffff' && command.lineWidth === 1.4),
        'Negative boundary amplitudes are solid white with white outlines');
      assert.ok(targets.every(command => command.strokeStyle === GOAL_COLOR), 'The goal does not borrow an output phase colour');
    }
    assert.ok(surface.frames.every(frame => !texts(frame).includes('⊕')), 'X gates use geometry independent of fonts');
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
    assert.deepEqual(puzzle, saved);
  }
});

test('GIF goal rings stay fixed while valid outputs retain their positive or negative overall phase', context => {
  const rendered = surfaces(context);
  const puzzle = { wires: 2, columns: [[{ gate: 'X', wires: [0] }, { gate: 'X', wires: [1] }],
    [{ id: 'a', wires: [0], choices: ['I', 'Z'] }], [{ id: 'b', wires: [1], choices: ['I', 'Z'] }]],
    target: goalState(2) };
  encodeReplay({ label: 'Fixed target', puzzle, sequence: [{ hole: 'a', gate: 'Z' }, { hole: 'b', gate: 'Z' }] });
  const targetX = (960 + puzzle.columns.length * 88) / 2 + 54;
  const markers = rendered[0].frames.map(frame => frame.filter(command =>
    command.name === 'arc' && command.args[0] === targetX && command.strokeStyle === GOAL_COLOR)
    .map(command => command.args));
  assert.equal(markers[0].length, 1);
  for (const frame of markers) assert.deepEqual(frame, markers[0]);
  const right = targetX - 54, outputColours = rendered[0].frames.map(frame => frame.find(command => command.name === 'arc' && command.args[0] === right && command.lineWidth === 1.4).fillStyle);
  assert.deepEqual(outputColours, ['#000000', '#ffffff', '#000000'], 'Output phase is never aligned to the goal.');
  const image = encodeReplay({ label: 'Negative overall phase', puzzle, sequence: [{ hole: 'a', gate: 'Z' }] }, undefined, true);
  assert.equal(image.commands().find(command => command.name === 'arc' && command.args[0] === 850).fillStyle, '#ffffff', 'A solved globally negative path remains white in the still image.');
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
  const rendered = surfaces(context);
  for (const opposite of [false, true]) {
    const preparation = [[{ gate: 'H', wires: [0] }], [{ gate: 'CX', wires: [0, 1] }], ...(opposite ? [[{ gate: 'X', wires: [1] }]] : [])];
    const puzzle = { wires: 2, columns: [...preparation,
      [{ id: 'a', wires: [1], choices: ['I', 'X'] }], [{ id: 'b', wires: [0, 1], choices: ['I', 'CX'] }],
      [{ id: 'c', wires: [0], choices: ['I', 'H'] }], [{ id: 'd', wires: [0], choices: ['I', 'X'] }, { id: 'e', wires: [1], choices: ['I', 'X'] }]], target: goalState(2) };
    const sequence = Object.entries({ a: opposite ? 'X' : 'I', b: 'CX', c: 'H', d: 'X', e: 'X' }).map(([hole, gate]) => ({ hole, gate }));
    encodeReplay({ label: 'Bell paths', puzzle, sequence });
    const step = Math.min(88, 740 / puzzle.columns.length), left = (960 - step * puzzle.columns.length) / 2;
    const observed = left + preparation.length * step, occupied = opposite ? [1, 2] : [0, 3];
    const flowTop = 246 + 76;
    const dots = rendered.at(-1).frames.at(-1).filter(command => command.name === 'arc' && command.args[0] === observed && command.lineWidth === 1.4);
    assert.deepEqual(dots.map(command => (command.args[1] - flowTop) / 28), occupied,
      'Intermediate Bell states remain separate even though both puzzles later reach the same fixed goal');
    assert.ok(dots.every(command => command.fillStyle === '#000000' && command.strokeStyle === '#ffffff'),
      'Positive amplitudes have the same black fill and white outline across distinct basis states');
  }
  encodeReplay({ label: 'Interference', puzzle: LEVELS[3], sequence: [{ hole: 'a', gate: 'H' }] });
  const commands = rendered.at(-1).frames.at(-1), puzzle = LEVELS[3];
  const step = Math.min(88, 740 / puzzle.columns.length), left = (960 - step * puzzle.columns.length) / 2;
  const right = left + puzzle.columns.length * step;
  for (const color of Object.values(PHASE_PATH_COLORS)) assert.ok(commands.some(command =>
    command.name === 'bezierCurveTo' && command.strokeStyle === color),
    'Interfering contributions distinguish positive and negative phase');
  assert.ok(commands.some(command => command.name === 'bezierCurveTo' && command.args.join() === [left + step / 2, 246, left + step / 2, 274, left + step, 274].join()),
    'Hadamard branches curve between fixed lanes below the corresponding gate');
  assert.deepEqual(commands.filter(command => command.name === 'arc' && command.args[0] === right && command.args[1] >= 246)
    .map(command => command.args[1]), [274], 'Only the all-ones output survives recombination');
});

test('still images and GIF frames show a wall only at fully cancelled path junctions', context => {
  const rendered = surfaces(context), puzzle = LEVELS[3];
  const round = { label: 'Recombination', puzzle, sequence: [{ hole: 'a', gate: 'H' }] };
  const step = Math.min(88, 740 / puzzle.columns.length), left = (960 - step * puzzle.columns.length) / 2;
  const x = left + (puzzle.columns.findIndex(column => column.some(entry => entry.id === 'a')) + 1) * step;
  const checkWall = (commands, wallX = x, basisY = 246, rowHeight = 28) => {
    const index = commands.findIndex(command => command.name === 'moveTo' && command.args[0] === wallX - 3 && command.args[1] === basisY - 7);
    assert.ok(index >= 0, 'The cancelled zero branch ends at a small wall');
    assert.deepEqual(commands.slice(index, index + 5).map(({ name, args }) => [name, args]), [
      ['moveTo', [wallX - 3, basisY - 7]], ['lineTo', [wallX, basisY - 7]], ['lineTo', [wallX, basisY + 7]], ['lineTo', [wallX - 3, basisY + 7]], ['stroke', []],
    ]);
    assert.ok(commands.slice(index, index + 5).every(command => command.strokeStyle === '#ffffff' && command.lineWidth === 2));
    assert.ok(!commands.some(command => command.name === 'moveTo' && command.args[0] === wallX - 3 && command.args[1] === basisY + rowHeight - 7),
      'The surviving one branch has no wall');
  };
  encodeReplay(round);
  checkWall(rendered.at(-1).frames.at(-1));
  assert.ok(!rendered.at(-1).frames[0].some(command => command.name === 'moveTo' && command.args[0] === x - 3 && command.args[1] === 239),
    'There is no wall before the recombining Hadamard is placed');
  const image = encodeReplay(round, undefined, true);
  checkWall(image.commands(), 850, (image.height + 48 - 38) / 2, 38);
});

test('replay controls align exactly on white wires, including reversed and distant endpoints', context => {
  const rendered = surfaces(context);
  for (const control of [0, 2]) {
    const target = 2 - control, puzzle = {
      wires: 3,
      columns: [[{ gate: 'X', wires: [control] }, { gate: 'X', wires: [1] }], [{ gate: 'CX', wires: [control, target] }],
        [{ id: 'a', wires: [0], choices: ['I', 'Z'] }]],
      target: goalState(3),
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
    const control = wires[1], destination = wires[0], inputBasis = (1 << (2 - control)) | 2;
    const puzzle = { wires: 3, columns: [
      [{ gate: 'X', wires: [control] }, { gate: 'X', wires: [1] }],
      [fixed ? { gate: 'XC', wires } : { id: 'a', wires, choices: ['I', 'CX', 'XC', 'CZ'] }],
      fixed ? [{ id: 'spare', wires: [0], choices: ['I', 'Z'] }] : [],
    ], target: goalState(3) };
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
      [480, flowTop + inputBasis * 28, 480, flowTop + 7 * 28, 524, flowTop + 7 * 28].join()),
    'The opposite CNOT routes the occupied basis lane using the same control direction');
    assert.deepEqual(commands.filter(command => command.name === 'arc' && command.args[0] === 612 && command.args[1] >= flowTop)
      .map(command => (command.args[1] - flowTop) / 28), [7], 'The final photon reaches the all-ones goal');
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

test('replay keeps sixteen binary lanes, dense signed intermediate states and a phase-neutral fixed goal', context => {
  const rendered = surfaces(context);
  const puzzle = { wires: 4, columns: [Array.from({ length: 4 }, (_, wire) => ({ gate: 'X', wires: [wire] })),
    [{ id: 'a', wires: [0], choices: ['I', 'Z'] }]], target: goalState(4) };
  encodeReplay({ label: 'Four qubits', puzzle, sequence: [{ hole: 'a', gate: 'Z' }] });
  const surface = rendered[0], commands = surface.frames.at(-1);
  const labels = commands.filter(command => command.name === 'fillText' && /^[01]{4}$/.test(command.args[0]));
  assert.deepEqual(labels.map(command => command.args[0]), Array.from({ length: 16 }, (_, row) => row.toString(2).padStart(4, '0')));
  assert.ok(commands.filter(command => command.name === 'arc').every(command => command.args[1] + command.args[2] < surface.height - 56),
    'Every probability marker remains above the replay footer');
  const right = (960 + puzzle.columns.length * 88) / 2, goalX = right + 54;
  const target = commands.findIndex(command => command.name === 'arc' && command.args[0] === goalX && command.strokeStyle === GOAL_COLOR);
  assert.ok(target >= 0); assert.equal(commands[target].args[2], GOAL_RADIUS);
  assert.equal(commands[target + 1].name, 'stroke', 'The goal ring has no phase-coloured fill.');
  assert.equal(commands.find(command => command.name === 'arc' && command.args[0] === right && command.lineWidth === 1.4).fillStyle, '#ffffff',
    'A valid globally negative output remains white beside the gold goal.');

  const dense = { wires: 4, columns: [
    Array.from({ length: 4 }, (_, wire) => ({ gate: 'X', wires: [wire] })),
    Array.from({ length: 4 }, (_, wire) => ({ gate: 'H', wires: [wire] })),
    [{ gate: 'Z', wires: [0] }], [{ id: 'a', wires: [0], choices: ['I', 'Z'] }],
    Array.from({ length: 4 }, (_, wire) => ({ id: 'bcde'[wire], wires: [wire], choices: ['I', 'H'] })),
  ], target: goalState(4) };
  const sequence = [{ hole: 'a', gate: 'Z' }, ...[...'bcde'].map(hole => ({ hole, gate: 'H' }))];
  encodeReplay({ label: 'Dense phases', puzzle: dense, sequence });
  const denseFrame = rendered.at(-1).frames.at(-1);
  const denseX = (960 - dense.columns.length * 88) / 2 + 3 * 88;
  const states = denseFrame.filter(command => command.name === 'arc' && command.args[0] === denseX && command.lineWidth === 1.4);
  const expected = Array.from({ length: 16 }, (_, basis) => ((basis & 1) ^ (basis >> 1 & 1) ^ (basis >> 2 & 1)) ? '#ffffff' : '#000000');
  assert.equal(states.length, 16, 'All populated intermediate outcomes remain visible while later holes recombine them.');
  assert.ok(states.every(command => Math.abs(command.args[2] - 2) < 1e-9));
  assert.deepEqual(states.map(command => command.fillStyle), expected, 'Dense intermediate dots retain every relative sign.');
  assert.ok(states.every(command => command.strokeStyle === '#ffffff'));
  assert.equal(denseFrame.filter(command => command.name === 'arc' && command.strokeStyle === GOAL_COLOR).length, 1);
  const image = encodeReplay({ label: 'Dense phases', puzzle: dense, sequence }, undefined, true);
  const intermediateX = 110 + 3 * 740 / dense.columns.length;
  const intermediate = image.commands().filter(command => command.name === 'arc' && command.args[0] === intermediateX);
  assert.equal(intermediate.length, 16); assert.deepEqual(intermediate.map(command => command.fillStyle), expected);
  assert.ok(intermediate.every(command => command.strokeStyle === '#ffffff' && command.args[1] + command.args[2] < image.height - 32));
  assert.equal(image.commands().filter(command => command.name === 'arc' && command.args[0] === 850).length, 1,
    'The final still-image output has recombined to the all-ones goal.');
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
