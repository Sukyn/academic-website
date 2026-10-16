import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlacement, controlWire, getHoles, puzzleData,
  simulate, solvePuzzle, stateEqual, stateFromWeights, targetWeights, validateCustomPuzzle,
  validatePlacements, validatePlayablePuzzle, validatePuzzle,
} from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, DAILY_START, DAILY_VERSION, dailyPuzzle, generatePuzzle } from '../../src/lib/quantum-signals/puzzles.js';
import { seededRandom } from '../../src/lib/games/random.js';
import { seededRandom as legacyRandom } from '../../src/lib/circuit-reduction/engine.js';

const fixed = (gate, ...wires) => ({ gate, wires });
const hole = (id, wires, choices = ['I', 'H', 'X', 'Z']) => ({ id, wires, choices });
function fixture(wires, columns) {
  return { wires, columns: [...columns, [hole('spare', [0], ['I', 'X'])]],
    target: [1, ...Array(2 ** wires - 1).fill(0)] };
}
const run = (wires, columns) => simulate(fixture(wires, columns), { spare: 'I' });
const geometry = puzzle => puzzle.columns.map(column => column.map(({ id, ...entry }) => entry));

// Independent dense operators provide a second evaluator, including arbitrary
// control directions. The game evaluates pairs in place; this multiplies a full
// matrix for each gate, with explicit amplitudes for both Hadamard branches.
function reference(puzzle, placements) {
  const size = 2 ** puzzle.wires;
  let state = [1, ...Array(size - 1).fill(0)];
  for (const entry of puzzle.columns.flat()) {
    const gate = entry.gate ?? placements[entry.id] ?? 'I';
    const a = 2 ** (puzzle.wires - entry.wires[gate === 'XC' ? 1 : 0] - 1);
    const b = 2 ** (puzzle.wires - entry.wires[gate === 'XC' ? 0 : 1] - 1);
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    for (let source = 0; source < size; source++) {
      if (gate === 'H') {
        matrix[source][source] = source & a ? -Math.SQRT1_2 : Math.SQRT1_2;
        matrix[source ^ a][source] = Math.SQRT1_2;
      } else {
        const destination = gate === 'X' ? source ^ a : (gate === 'CX' || gate === 'XC') && (source & a) ? source ^ b : source;
        matrix[destination][source] = (gate === 'Z' && (source & a)) || (gate === 'CZ' && (source & a) && (source & b)) ? -1 : 1;
      }
    }
    state = matrix.map(row => row.reduce((sum, value, index) => sum + value * state[index], 0));
  }
  return state;
}

test('Classical bits, Hadamard interference and local phase have the expected amplitudes', () => {
  assert.deepEqual(run(1, [[fixed('X', 0)]]).state, [0, 1]);
  assert.deepEqual(run(2, [[fixed('X', 0)]]).state, [0, 0, 1, 0]);
  assert.ok(stateEqual(run(1, [[fixed('H', 0)], [fixed('H', 0)]]).state, [1, 0]));
  const minus = run(1, [[fixed('H', 0)], [fixed('Z', 0)]]);
  assert.ok(stateEqual(minus.state, [Math.SQRT1_2, -Math.SQRT1_2]));
  assert.ok(stateEqual(run(1, [[fixed('H', 0)], [fixed('Z', 0)], [fixed('H', 0)]]).state, [0, 1]));
  assert.ok(stateEqual(run(1, [[fixed('H', 0)]]).state, [Math.SQRT1_2, Math.SQRT1_2]));
});

test('Bell correlations and relative phase survive reversible entanglement', () => {
  const bell = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)]]);
  const phased = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)], [fixed('Z', 1)]]);
  assert.ok(stateEqual(bell.state, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  assert.ok(!stateEqual(bell.state, phased.state));
  assert.ok(stateEqual(bell.state, bell.state.map(value => -value)));
  assert.deepEqual(phased.state.map(amplitude => amplitude ** 2), bell.state.map(amplitude => amplitude ** 2),
    'Relative phase changes interference without changing measurement probabilities.');
  assert.ok(stateEqual(run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)], [fixed('CX', 0, 1)], [fixed('H', 0)]]).state, [1, 0, 0, 0]));
});

test('Both CNOT directions and controlled phase respect the declared wire order', () => {
  assert.deepEqual(run(2, [[fixed('X', 1)], [fixed('CX', 1, 0)]]).state, [0, 0, 0, 1]);
  assert.deepEqual(run(2, [[fixed('X', 1)], [fixed('CX', 0, 1)]]).state, [0, 1, 0, 0]);
  const graph = run(2, [[fixed('H', 0), fixed('H', 1)], [fixed('CZ', 0, 1)]]);
  assert.ok(stateEqual(graph.state, [.5, .5, .5, -.5]));
});

test('CX and XC truth tables cover both directions on reversed and nonadjacent wire pairs', () => {
  for (const wires of [[0, 3], [3, 0], [1, 2], [2, 1]]) for (const gate of ['CX', 'XC']) {
    const control = wires[gate === 'XC' ? 1 : 0], target = wires[gate === 'XC' ? 0 : 1];
    assert.equal(controlWire(gate, wires), control);
    for (let basis = 0; basis < 16; basis++) {
      const prepare = Array.from({ length: 4 }, (_, row) => row).filter(row => basis & (1 << (3 - row))).map(row => fixed('X', row));
      const result = run(4, [prepare, [fixed(gate, ...wires)]]);
      const destination = basis & (1 << (3 - control)) ? basis ^ (1 << (3 - target)) : basis;
      assert.deepEqual(result.state, Array.from({ length: 16 }, (_, index) => index === destination ? 1 : 0), `${gate} on ${wires}, input ${basis}`);
    }
  }
});

test('XC can fill a hole, survives custom serialization and reverses a CNOT without changing the wire array', () => {
  const input = { wires: 3,
    columns: [[fixed('H', 2)], [hole('a', [0, 2], ['I', 'CX', 'XC', 'CZ'])]],
    target: [Math.SQRT1_2, 0, 0, 0, 0, Math.SQRT1_2, 0, 0] };
  const puzzle = validateCustomPuzzle(puzzleData(input)), id = getHoles(puzzle)[0].id;
  const placements = applyPlacement(puzzle, {}, { hole: id, gate: 'XC' });
  assert.deepEqual(puzzle.columns[1][0].wires, [0, 2]);
  assert.equal(simulate(puzzle, placements).solved, true);
  assert.equal(simulate(puzzle, { [id]: 'CX' }).solved, false);
  assert.deepEqual(solvePuzzle(puzzle, { limit: 1 }), [{ [id]: 'XC' }]);
  assert.ok(stateEqual(run(3, [[fixed('H', 2)], [fixed('XC', 0, 2)], [fixed('XC', 0, 2)]]).state,
    run(3, [[fixed('H', 2)]]).state));
});

test('All gate matrices agree with an independent dense evaluator in random four-wire contexts', () => {
  const random = seededRandom('matrix-contexts');
  for (let trial = 0; trial < 96; trial++) {
    const columns = Array.from({ length: 12 }, () => {
      const first = Math.floor(random() * 4), second = (first + 1 + Math.floor(random() * 3)) % 4;
      const gate = ['H', 'X', 'Z', 'CX', 'XC', 'CZ'][Math.floor(random() * 6)];
      return [fixed(gate, ...(['CX', 'XC', 'CZ'].includes(gate) ? [first, second] : [first]))];
    });
    const puzzle = fixture(4, columns), result = simulate(puzzle, { spare: 'I' });
    assert.ok(stateEqual(result.state, reference(puzzle, { spare: 'I' })), `matrix context ${trial}`);
    assert.ok(Math.abs(result.state.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-9);
  }
});

test('Gate edits and simulated states remain independent', () => {
  const puzzle = LEVELS[0], empty = simulate(puzzle);
  assert.equal(empty.solved, false);
  const chosen = applyPlacement(puzzle, {}, { hole: 'a', gate: 'X' });
  assert.deepEqual(chosen, { a: 'X' });
  assert.equal(simulate(puzzle, chosen).solved, true);
  assert.deepEqual(applyPlacement(puzzle, chosen, { hole: 'a', gate: null }), {});
  assert.deepEqual(chosen, { a: 'X' }, 'Edits do not mutate the undo snapshot.');
  assert.throws(() => applyPlacement(puzzle, {}, { hole: 'unknown', gate: 'X' }), RangeError);
  assert.throws(() => applyPlacement(puzzle, {}, { hole: 'a', gate: 'H' }), RangeError);
  assert.throws(() => validatePlacements(puzzle, { a: null }), RangeError);
  const result = simulate(puzzle, chosen);
  result.state[0] = 20;
  assert.deepEqual(simulate(puzzle, chosen).state, [0, 1]); assert.equal(puzzle.target[0], 0);
});

test('Unfilled holes use offered identity, including after erasing a wrong gate', () => {
  const puzzle = { wires: 1, columns: [[hole('a', [0], ['I', 'X'])], [hole('b', [0], ['I', 'H'])]], target: [0, 1] };
  const solution = { a: 'X' };
  assert.equal(simulate(puzzle, solution).solved, true);
  assert.deepEqual(simulate(puzzle, solution), simulate(puzzle, { ...solution, b: 'I' }));
  const wrong = applyPlacement(puzzle, solution, { hole: 'b', gate: 'H' });
  assert.equal(simulate(puzzle, wrong).solved, false);
  const erased = applyPlacement(puzzle, wrong, { hole: 'b', gate: null });
  assert.equal(simulate(puzzle, erased).solved, true);
  assert.deepEqual(wrong, { a: 'X', b: 'H' }, 'Undo snapshots keep the wrong gate until an actual undo');
  const required = { wires: 1, columns: [[hole('required', [0], ['X', 'H'])]], target: [1, 0] };
  assert.equal(simulate(required).solved, false, 'A missing gate cannot bypass choices that exclude identity');
  const matched = { ...required, columns: [[hole('optional', [0], ['I', 'H'])]] };
  assert.equal(simulate(matched).solved, true, 'An already matched custom identity needs no artificial action');
});

test('State comparison distinguishes basis outcomes and rejects invalid states', () => {
  assert.equal(stateEqual([1, 0], [0, 1]), false);
  assert.equal(stateEqual([1, 0], [NaN, 0]), false);
  assert.equal(stateEqual([0, 0], [0, 0]), false);
});

test('Malformed canonical circuits and incompatible placements are rejected before simulation', () => {
  const base = LEVELS[0];
  const variants = [
    null, {}, { ...base, wires: 0 }, { ...base, wires: 5 },
    { ...base, columns: [] }, { ...base, columns: Array(17).fill([]) },
    { ...base, columns: [[hole('a', [0]), fixed('H', 0)]] },
    { ...base, columns: [[hole('a', [1])]] },
    { ...base, columns: [[hole('__proto__', [0])]] },
    { ...base, columns: [[hole('a', [0], ['I', 'CX'])]] },
    { ...base, columns: [[hole('a', [0], ['I', 'XC'])]] },
    { ...base, columns: [[hole('a', [0], ['X', 'X'])]] },
    { ...base, columns: [[hole('a', [0])], [hole('a', [0])]] },
    { ...base, columns: [[fixed('Y', 0)], [hole('a', [0])]] },
    { ...base, columns: [[hole('a', [0])], [fixed('CX', 0, 0)]] },
    { ...base, columns: [[hole('a', [0])], [fixed('XC', 0)]] },
    { ...base, columns: Array(1) }, { ...base, columns: [Array(1)] },
    { ...base, target: [1, Infinity] }, { ...base, target: [1, .1] },
    { ...base, target: [1, ,] },
    { ...base, target: { '1': 1 } },
    { ...base, columns: [[{ wires: [0], choices: ['I', 'X'] }]] },
  ];
  for (const value of variants) assert.throws(() => validatePuzzle(value), RangeError);
  assert.throws(() => simulate(base, { unexpected: 'X' }), RangeError);
  assert.throws(() => simulate(base, []), RangeError);
  assert.throws(() => solvePuzzle(base, { limit: Infinity }), RangeError);
  const impossible = { ...base, target: [Math.sqrt(.3), Math.sqrt(.7)] };
  assert.throws(() => validatePlayablePuzzle(impossible), /cannot be reached/);
});

test('Custom holes get deterministic internal IDs and remain independent of the imported data', () => {
  const source = { wires: 2, columns: [
    [{ wires: [0], choices: ['I', 'X'] }, { wires: [1], choices: ['I', 'X'] }],
    [{ wires: [0], choices: ['I', 'H'] }, { wires: [1], choices: ['I', 'Z'] }],
    [{ wires: [0], choices: ['I', 'Z'] }],
  ], target: { '00': 1 } };
  const before = structuredClone(source), puzzle = validateCustomPuzzle(source);
  assert.deepEqual(getHoles(puzzle).map(entry => entry.id), ['h1', 'h2', 'h3', 'h4', 'h5']);
  assert.deepEqual(validateCustomPuzzle(source), puzzle);
  assert.deepEqual(validatePuzzle(puzzle), puzzle);
  assert.deepEqual(Object.keys(puzzle), ['wires', 'columns', 'target']);
  const placements = solvePuzzle(puzzle, { limit: 1 })[0];
  assert.equal(simulate(puzzle, placements).solved, true);
  assert.deepEqual(source, before);
  puzzle.columns[0][0].choices.push('Z'); puzzle.target[0] = 5;
  assert.deepEqual(source, before);
});

test('Custom targets use sparse signed binary labels and reject unreachable states', () => {
  const base = LEVELS[7], human = puzzleData(base);
  const puzzle = validateCustomPuzzle(human);
  assert.ok(Array.isArray(puzzle.target), 'Imported targets keep the numeric engine and network representation.');
  assert.ok(stateEqual(puzzle.target, base.target));
  const chosen = solvePuzzle(puzzle, { limit: 1 })[0];
  assert.equal(simulate(puzzle, chosen).solved, true);
  assert.deepEqual(puzzleData(puzzle).target, { '11': -1, '00': 1 });
  assert.deepEqual(human.target, { '00': 1, '11': -1 });
  const impossible = { wires: 1, columns: [[{ wires: [0], choices: ['I', 'Z'] }]], target: { '1': 1 } };
  assert.throws(() => validateCustomPuzzle(impossible), /cannot be reached/);
  assert.deepEqual(validatePlayablePuzzle(base), validatePuzzle(base), 'The visual editor validates circuit data without lesson metadata.');
});

test('Sign target helpers preserve phase and probabilities without mutating state', () => {
  const weights = Object.freeze([1, 0, 0, -1]), state = stateFromWeights(weights);
  assert.ok(stateEqual(state, [Math.SQRT1_2, 0, 0, -Math.SQRT1_2]));
  assert.ok(Math.abs(state.reduce((norm, amplitude) => norm + amplitude ** 2, 0) - 1) < 1e-12);
  assert.deepEqual(targetWeights(state), [1, 0, 0, -1]);
  assert.deepEqual(targetWeights(state.map(value => -value)), [-1, 0, 0, 1]);
  assert.deepEqual(weights, [1, 0, 0, -1]);
  assert.deepEqual(targetWeights(Array(16).fill(.25)), Array(16).fill(1));
  assert.equal(targetWeights([.6, .8]), null, 'Unequal target amplitudes must not be rounded to equal weights.');
  assert.equal(targetWeights([0, 0]), null);
  assert.equal(targetWeights([1, NaN]), null);
  assert.equal(targetWeights(null), null);
});

test('Custom targets reject malformed labels, non-sign weights and empty states', () => {
  const base = puzzleData(LEVELS[7]);
  for (const target of [
    null, [1, 0, 0, 0], {}, { '00': 0, '11': 0 }, { '0': 1 }, { '000': 1 }, { '02': 1 },
    { '00': '1' }, { '00': .5 }, { '00': Infinity }, { '00': NaN }, { '00': 2 },
    JSON.parse('{"__proto__":1}'), { constructor: 1 }, Object.create({ '00': 1 }),
  ]) assert.throws(() => validateCustomPuzzle({ ...base, target }), RangeError);
  for (const weights of [null, [], [0, 0], [1, 0, 0], [1, ,], [1, Infinity], [1, '1'], [1, .5], [1, 2]]) {
    assert.throws(() => stateFromWeights(weights), RangeError);
  }
  const sparse = Object.create(null); sparse['00'] = 1;
  const reachable = { wires: 2, columns: [[{ wires: [0], choices: ['I', 'Z'] }]], target: sparse };
  assert.deepEqual(validateCustomPuzzle(reachable).target, [1, 0, 0, 0]);
});

test('Custom exports contain only circuit data and preserve playable Clifford states through JSON', () => {
  for (const puzzle of [...LEVELS, ...Array.from({ length: 12 }, (_, seed) => generatePuzzle(`readable-${seed}`, seed % 3 + 1))]) {
    const before = structuredClone(puzzle), exported = puzzleData(puzzle);
    assert.deepEqual(Object.keys(exported), ['wires', 'columns', 'target']);
    assert.ok(exported.columns.flat().every(entry => !Object.hasOwn(entry, 'id')));
    assert.equal(Array.isArray(exported.target), false);
    assert.ok(Object.values(exported.target).every(weight => weight === 1 || weight === -1));
    assert.ok(Object.keys(exported.target).every(bits => bits.length === puzzle.wires && /^[01]+$/.test(bits)));
    const restored = validateCustomPuzzle(JSON.parse(JSON.stringify(exported)));
    assert.ok(stateEqual(restored.target, puzzle.target));
    assert.deepEqual(geometry(restored), geometry(puzzle));
    assert.equal(simulate(restored, solvePuzzle(restored, { limit: 1 })[0]).solved, true);
    assert.deepEqual(puzzle, before);
  }
  assert.throws(() => puzzleData({ ...LEVELS[0], target: [.6, .8] }), /equal chances/);
});

test('Object prototype names are ordinary hole IDs and redundant gate fields cannot override a hole', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
    const input = { ...LEVELS[0], columns: [[{ ...hole(id, [0], ['I', 'X']), gate: 'H' }]] };
    const puzzle = validatePuzzle(input);
    assert.equal(Object.hasOwn(puzzle.columns[0][0], 'gate'), false);
    assert.equal(simulate(puzzle).solved, false);
    assert.deepEqual(simulate(puzzle).state, [1, 0]);
    const placements = applyPlacement(puzzle, {}, { hole: id, gate: 'X' });
    assert.equal(Object.hasOwn(placements, id), true);
    assert.equal(simulate(puzzle, placements).solved, true);
    assert.deepEqual(applyPlacement(puzzle, placements, { hole: id, gate: null }), {});
  }
});

test('Reachability search respects its solution limit and gate choice order', () => {
  const holes = Array.from({ length: 6 }, (_, index) => hole(`h${index}`, [0], ['Z', 'I']));
  const puzzle = { wires: 1, columns: holes.map(entry => [entry]), target: [1, 0] };
  const first = Object.fromEntries(holes.map(entry => [entry.id, 'Z']));
  assert.deepEqual(solvePuzzle(puzzle, { limit: 1 }), [first]);
  assert.deepEqual(solvePuzzle(puzzle), [first, { ...first, h5: 'I' }]);
  const all = solvePuzzle(puzzle, { limit: 4096 });
  assert.equal(all.length, 64);
  assert.deepEqual(all.at(-1), Object.fromEntries(holes.map(entry => [entry.id, 'I'])));
  assert.equal(simulate(puzzle, first).solved, true);
  for (const limit of [0, -1, 4097, 1.5]) assert.throws(() => solvePuzzle(puzzle, { limit }), RangeError);
});

test('All tutorial puzzles are reachable, and later lessons exercise interference and entanglement', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(new Set(LEVELS.map(puzzle => puzzle.title)).size, LEVELS.length);
  for (const [index, puzzle] of LEVELS.entries()) {
    assert.ok(typeof puzzle.title === 'string' && puzzle.title.length > 0 && puzzle.title.length <= 40);
    const solutions = solvePuzzle(puzzle, { limit: 4096 });
    assert.ok(solutions.length > 0, `level ${index + 1} is reachable`);
    assert.equal(Object.hasOwn(puzzle, 'optimalMoves'), false);
    assert.deepEqual(Object.keys(puzzle), ['title', 'wires', 'columns', 'target']);
    for (const hole of getHoles(puzzle).filter(entry => entry.wires.length === 2)) {
      assert.deepEqual(hole.choices, ['I', 'CX', 'XC', 'CZ']);
    }
    for (const solution of solutions) {
      assert.equal(simulate(puzzle, solution).solved, true);
      assert.ok(stateEqual(reference(puzzle, solution), puzzle.target));
    }
  }
  assert.equal(LEVELS[10].wires, 3);
  assert.ok(stateEqual(LEVELS[7].target, [Math.SQRT1_2, 0, 0, -Math.SQRT1_2]));
});

test('Random puzzles are bounded, deterministic, solvable and require changing the empty circuit', () => {
  for (let difficulty = 1; difficulty <= 3; difficulty++) for (let seed = 0; seed < 24; seed++) {
    const puzzle = generatePuzzle(seed, difficulty);
    assert.deepEqual(puzzle, generatePuzzle(seed, difficulty));
    assert.equal(puzzle.wires, difficulty);
    assert.ok(getHoles(puzzle).length <= 6);
    for (const hole of getHoles(puzzle).filter(entry => entry.wires.length === 2)) {
      assert.deepEqual(hole.choices, ['I', 'CX', 'XC', 'CZ']);
    }
    const [solution] = solvePuzzle(puzzle, { limit: 1 });
    assert.equal(simulate(puzzle, solution).solved, true);
    assert.equal(Object.hasOwn(puzzle, 'optimalMoves'), false);
    assert.deepEqual(Object.keys(puzzle), ['wires', 'columns', 'target']);
    assert.equal(stateEqual(puzzle.target, simulate(puzzle).state), false);
  }
  assert.throws(() => generatePuzzle('x', 4), RangeError);
  assert.throws(() => generatePuzzle({}, 2), RangeError);
  assert.throws(() => generatePuzzle('x'.repeat(101), 2), RangeError);
});

test('Daily seeds use validated civil dates, stay reproducible and cannot leak mutable cached state', () => {
  const first = dailyPuzzle(DAILY_START);
  assert.deepEqual(first, dailyPuzzle(DAILY_START));
  assert.equal(first.date, DAILY_START);
  assert.deepEqual(Object.keys(first), ['wires', 'columns', 'target', 'date']);
  assert.equal(Object.hasOwn(first, 'optimalMoves'), false);
  assert.equal(DAILY_VERSION, 'quantum-signals-daily-v4');
  assert.deepEqual(first.target, generatePuzzle(`${DAILY_VERSION}:${DAILY_START}`, 3).target);
  first.columns[0][0].gate = 'X';
  assert.notDeepEqual(first, dailyPuzzle(DAILY_START));
  assert.throws(() => dailyPuzzle('2026-02-30'), RangeError);
  assert.throws(() => dailyPuzzle('2026-10-14'), RangeError);
});

test('Extracting the shared RNG preserves the previous circuit reduction sequence', () => {
  assert.equal(seededRandom, legacyRandom);
  const random = seededRandom('unchanged');
  assert.deepEqual(Array.from({ length: 4 }, () => random()), [
    0.3745188496541232, 0.9536303554195911, 0.11760481004603207, 0.6100607628468424,
  ]);
});
