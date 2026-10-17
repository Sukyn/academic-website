import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, applyOperation, applyMove, simulate, validateCircuit, isIdentity, isSolved,
  getLegalMoves, selectionCells, matchesSelection, flowTrace } from '../../src/lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals, validateSignals, fillSignals, signalsSolved, solveSignals, signalsData, verifySolution } from '../../src/lib/categorical-circuits/puzzles.js';
import { applyGate } from '../../src/lib/quantum-signals/engine.js';

const close = (first, second) => {
  assert.equal(first.length, second.length);
  first.forEach((value, index) => assert.ok(Math.abs(value - second[index]) < 1e-9, index + ': ' + value + ' ≠ ' + second[index]));
};
const op = (gate, wires, controls) => ({ gate, wires, ...(controls ? { controls } : {}) });

test('categorical operations implement SWAP, Toffoli, controlled H and controlled SWAP on named wires', () => {
  const basis = index => Array.from({ length: 8 }, (_, current) => Number(index === current));
  close(applyOperation(basis(1), op('SWAP', [0, 2]), 3), basis(4));
  close(applyOperation(basis(6), op('X', [2], [0, 1]), 3), basis(7));
  close(applyOperation(basis(2), op('X', [2], [0, 1]), 3), basis(2));
  close(applyOperation(basis(5), op('SWAP', [1, 2], [0]), 3), basis(6));
  close(applyOperation(basis(1), op('SWAP', [1, 2], [0]), 3), basis(1));
  close(simulate({ wires: 2, columns: [[op('H', [0])], [op('H', [1], [0])]] }),
    [Math.SQRT1_2, 0, .5, .5]);
});

test('standard and advanced signals share gate math while preserving both CNOT wire conventions', () => {
  for (let wires = 1; wires <= 4; wires++) {
    const initial = Array.from({ length: 2 ** wires }, (_, index) => Math.sin(index + .4));
    for (let first = 0; first < wires; first++) {
      for (const gate of ['H', 'X', 'Z']) {
        const standard = [...initial]; applyGate(standard, gate, [first], wires);
        assert.deepEqual(applyOperation([...initial], op(gate, [first]), wires), standard);
      }
      const identity = [...initial]; applyGate(identity, 'I', [first], wires);
      assert.deepEqual(identity, initial);
      for (let second = 0; second < wires; second++) if (first !== second) for (const gate of ['CX', 'XC', 'CZ']) {
        const standard = [...initial]; applyGate(standard, gate, [first, second], wires);
        const control = gate === 'XC' ? second : first, target = gate === 'XC' ? first : second;
        assert.deepEqual(applyOperation([...initial], op(gate === 'CZ' ? 'Z' : 'X', [target], [control]), wires), standard);
      }
    }
  }
});

test('all categorical rules and all permitted controlled liftings are exact matrices', () => {
  for (const rule of RULES) {
    for (let controls = 0; controls <= 4 - rule.wires; controls++) {
      const wires = rule.wires + controls, outer = Array.from({ length: controls }, (_, index) => rule.wires + index);
      const lift = columns => ({ wires, columns: columns.map(column => column.map(operation => ({ ...operation,
        controls: [...(operation.controls ?? []), ...outer] }))) });
      const left = lift(rule.left), right = lift(rule.right), size = 2 ** wires;
      for (let input = 0; input < size; input++) {
        const state = Array.from({ length: size }, (_, index) => Number(input === index));
        close(simulate(left, state), simulate(right, state));
      }
      const arbitrary = Array.from({ length: size }, (_, index) => Math.sin(index * .73 + .4));
      close(simulate(left, arbitrary), simulate(right, arbitrary));
    }
  }
});

test('controlled rewriting selects targets, consumes controls and respects their context', () => {
  const circuit = { wires: 3, columns: [[op('Z', [2], [0, 1])], [op('Z', [2], [0, 1])]] };
  const move = { rule: 'cancel-z', column: 0, wires: [2], controls: [0, 1] };
  assert.deepEqual(selectionCells(move), ['2:0', '2:1']);
  assert.equal(matchesSelection(move, ['2:0', '2:1']), true);
  assert.equal(matchesSelection(move, ['0:0', '0:1', '2:0', '2:1']), false);
  assert.equal(isSolved(applyMove(circuit, move)), true);
  assert.ok(getLegalMoves(circuit, { selection: ['2:0', '2:1'] }).some(candidate => candidate.rule === 'cancel-z'));
  const interrupted = { wires: 2, columns: [[op('H', [1], [0])], [op('X', [0])], [op('H', [1], [0])]] };
  assert.throws(() => applyMove(interrupted, { rule: 'basis-z', column: 0, wires: [1], controls: [0] }), /match|interrupt/);
  const different = { wires: 3, columns: [[op('Z', [2], [0])], [op('Z', [2], [1])]] };
  assert.throws(() => applyMove(different, { ...move, controls: [0] }), /match/);
  const parallel = { wires: 3, columns: Array.from({ length: 2 }, () => [op('H', [1], [0]), op('X', [2], [0])]) };
  const remaining = applyMove(parallel, { rule: 'cancel-h', column: 0, wires: [1], controls: [0] });
  assert.deepEqual(remaining.columns, [[op('X', [2], [0])], [op('X', [2], [0])]]);
  assert.equal(isSolved(applyMove(remaining, { rule: 'cancel-x', column: 0, wires: [2], controls: [0] })), true);
  const modifiedControl = { wires: 2, columns: [[op('X', [0])], [op('X', [1], [0])], []] };
  assert.throws(() => applyMove(modifiedControl, { rule: 'basis-x', column: 0, wires: [1], controls: [0], reverse: true }), /interrupt/);
  const readTarget = { wires: 3, columns: [[op('X', [2], [1])], [op('X', [1])], []] };
  assert.throws(() => applyMove(readTarget, { rule: 'basis-x', column: 0, wires: [1], reverse: true }), /interrupt/);
});

test('PROP retains full linked-gate selections and rejects new controlled generators', () => {
  const circuit = { wires: 2, columns: [[op('Z', [1], [0])], [op('Z', [1], [0])]] };
  const move = { rule: 'cancel-z', column: 0, wires: [1], controls: [0] };
  assert.deepEqual(selectionCells(move, { profile: 'prop' }).sort(), ['0:0', '0:1', '1:0', '1:1']);
  assert.equal(isSolved(applyMove(circuit, move, { profile: 'prop' })), true);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('H', [1], [0])]] }, 'prop'), /switch/);
  assert.throws(() => validateCircuit({ wires: 3, columns: [[op('X', [2], [0, 1])]] }, 'prop'), /switch/);
});

test('rewrites preserve disjoint gates, never mutate sources and reject dangling or overlapping controls', () => {
  const circuit = { wires: 3, columns: [[op('H', [0]), op('Z', [2])], [op('H', [0])]] };
  const before = structuredClone(circuit);
  const result = applyMove(circuit, { rule: 'cancel-h', column: 0, wires: [0] });
  assert.deepEqual(result.columns, [[op('Z', [2])], []]);
  assert.deepEqual(circuit, before);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('X', [0], [0])]] }), /distinct/);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('X', [1], [0]), op('Z', [0])]] }), /disjoint/);
  assert.throws(() => validateCircuit({ wires: 2, columns: Array(49).fill([]) }), /48/);
  assert.throws(() => applyMove(circuit, { rule: 'cancel-h', column: 0, wires: [0], controls: [0] }), /distinct/);
});

test('identity validation retains global phase and flow traces agree with direct evolution', () => {
  const minusIdentity = { wires: 1, columns: ['X', 'Z', 'X', 'Z'].map(gate => [op(gate, [0])]) };
  assert.equal(isIdentity(minusIdentity), false);
  assert.equal(isIdentity({ wires: 2, columns: [[op('SWAP', [0, 1])], [op('SWAP', [0, 1])]] }), true);
  const circuit = { wires: 3, columns: [[op('H', [0])], [op('H', [1], [0])], [op('SWAP', [1, 2], [0])], [op('Z', [2], [0])]] };
  close(flowTrace(circuit).snapshots.at(-1), simulate(circuit));
});

test('categorical campaigns and tutorials have executable exact witnesses', () => {
  for (const profile of ['prop', 'controlled']) {
    for (const level of [...getLevels(profile), getTutorial(profile)]) {
      assert.equal(isIdentity(level.circuit, profile), true, profile + ' ' + level.title);
      assert.equal(verifySolution(level.circuit, level.solution, profile), true, profile + ' ' + level.title);
    }
    for (const level of [...getLevels(profile, 'signals'), getTutorial(profile, 'signals')]) {
      assert.equal(signalsSolved(level, level.solution, profile), true, level.title);
      assert.equal(signalsSolved(level, [], profile), false, level.title);
      assert.ok(solveSignals(level, { profile }).length, level.title);
    }
  }
});

test('seeded categorical generators preserve witnesses, profiles and nontrivial targets', () => {
  const signatures = new Set();
  for (const profile of ['prop', 'controlled']) for (const difficulty of [1, 2, 3]) for (let seed = 0; seed < 20; seed++) {
    const puzzle = randomIdentity(profile, { seed, difficulty });
    assert.deepEqual(randomIdentity(profile, { seed, difficulty }), puzzle);
    validateCircuit(puzzle.circuit, profile);
    assert.equal(isIdentity(puzzle.circuit), true);
    assert.equal(verifySolution(puzzle.circuit, puzzle.solution, profile), true, profile + ' ' + difficulty + ' ' + seed);
    signatures.add(JSON.stringify(puzzle.circuit));
    const signals = generateSignals(profile, { seed, difficulty });
    assert.deepEqual(generateSignals(profile, { seed, difficulty }), signals);
    validateSignals(signals, profile);
    assert.equal(signalsSolved(signals, signals.solution, profile), true);
    assert.equal(signalsSolved(signals, [], profile), false);
    close(simulate(fillSignals(signals, signals.solution, profile)), signals.target);
  }
  assert.ok(signatures.size >= 70, 'generated circuit diversity: ' + signatures.size);
});

test('categorical custom data rejects malformed choices, target vectors, profiles and resource excesses', () => {
  const puzzle = getLevels('controlled', 'signals')[0];
  assert.throws(() => validateSignals({ ...puzzle, holes: Array(7).fill(puzzle.holes[0]) }), /1–6/);
  assert.throws(() => validateSignals({ ...puzzle, target: [Infinity, 0, 0, 0] }), /normalized/);
  assert.throws(() => validateSignals({ ...puzzle, holes: [{ wires: [0, 1], choices: ['I', 'H'] }] }), /target/);
  assert.throws(() => fillSignals(puzzle, ['H']), /offered/);
  assert.throws(() => solveSignals(puzzle, { limit: 99999 }), /4096/);
  assert.throws(() => randomIdentity('unknown', { seed: 0 }), /PROP/);
  assert.throws(() => generateSignals('prop', { seed: 0, difficulty: 4 }), /difficulty/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: [null] }), /cells/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: ['0:5'] }), /cells/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: {} }), /cells/);
  assert.throws(() => validateSignals({ ...puzzle, target: [1, , , ] }), /normalized/);
  const unequal = getLevels('controlled', 'signals').find(level => level.title === 'Unequal branches');
  const data = signalsData(unequal);
  assert.equal(Object.hasOwn(data, 'target'), false);
  close(validateSignals(JSON.parse(JSON.stringify(data))).target, unequal.target);
  assert.throws(() => validateSignals({ ...unequal, targetCircuit: { wires: 2, columns: [[]] } }), /disagree/);
  assert.throws(() => validateSignals({ ...puzzle, holes: Array(1) }), /distinct gates/);
});

test('unfilled mandatory signal holes preview identity but cannot win or accept an unoffered identity', () => {
  const puzzle = { wires: 1, columns: [], holes: Array.from({ length: 2 }, () => ({ wires: [0], choices: ['H', 'X'] })), target: [1, 0] };
  close(simulate(fillSignals(puzzle, [])), [1, 0]);
  assert.equal(signalsSolved(puzzle, []), false);
  assert.equal(signalsSolved(puzzle, Array(2)), false);
  assert.equal(signalsSolved(puzzle, ['H', 'H']), true);
  assert.throws(() => fillSignals(puzzle, ['I']), /offered/);
  assert.throws(() => fillSignals(puzzle, [null]), /offered/);
  assert.throws(() => fillSignals(puzzle, ['H', 'H', 'H']), /each hole/);
});

test('Signals reference exports retain reachable targets when a solver witness has opposite global phase', () => {
  const puzzle = generateSignals('prop', { seed: 'categorical-browser-quality', difficulty: 2 });
  const data = signalsData(puzzle, undefined, 'prop');
  const restored = validateSignals(JSON.parse(JSON.stringify(data)), 'prop');
  const solution = solveSignals(restored, { profile: 'prop' })[0];
  assert.ok(solution);
  assert.equal(signalsSolved(restored, solution, 'prop'), true);
  const opposite = { ...restored, target: restored.target.map(value => -value) };
  assert.doesNotThrow(() => validateSignals(opposite, 'prop'));
  assert.equal(signalsSolved(opposite, solution, 'prop'), true);
});
