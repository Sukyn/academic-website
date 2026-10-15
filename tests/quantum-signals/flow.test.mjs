import test from 'node:test';
import assert from 'node:assert/strict';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { simulate, solvePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, generatePuzzle } from '../../src/lib/quantum-signals/puzzles.js';

const fixed = (gate, ...wires) => ({ gate, wires });
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9,
    `${value} differs from ${expected[index]} at ${index}`));
};
function fixture(wires, columns) {
  return { wires, columns: [...columns, [{ id: 'spare', wires: [0], choices: ['I', 'X'] }]],
    target: [1, ...Array(2 ** wires - 1).fill(0)] };
}
const run = (wires, columns) => flowTrace(fixture(wires, columns));

test('Hadamard paths split, then recombine signed contributions before the next column', () => {
  const { columns, snapshots } = run(1, [[fixed('H', 0)], [fixed('H', 0)]]);
  assert.deepEqual(columns[0], [
    { from: 0, to: 0, amplitude: Math.SQRT1_2 },
    { from: 0, to: 1, amplitude: Math.SQRT1_2 },
  ]);
  close(snapshots[1], [Math.SQRT1_2, Math.SQRT1_2]);
  const canceled = columns[1].filter(edge => edge.to === 1);
  assert.equal(canceled.length, 2, 'Both interfering paths remain available to draw.');
  close(canceled.map(edge => edge.amplitude), [.5, -.5]);
  close(snapshots[2], [1, 0]);
  assert.deepEqual(columns[2].map(({ from, to }) => [from, to]), [[0, 0]],
    'Canceled amplitude cannot illuminate paths in later columns.');
});

test('X reroutes a path while Z changes its sign without changing its basis position', () => {
  const { columns, snapshots } = run(1, [[fixed('X', 0)], [fixed('Z', 0)]]);
  assert.deepEqual(columns[0], [{ from: 0, to: 1, amplitude: 1 }]);
  assert.deepEqual(columns[1], [{ from: 1, to: 1, amplitude: -1 }]);
  assert.deepEqual(snapshots[2], [0, -1]);
});

test('Controlled paths use declared control order, including reversed and separated wires', () => {
  assert.deepEqual(run(3, [[fixed('X', 2)], [fixed('CX', 2, 0)]]).columns[1],
    [{ from: 1, to: 5, amplitude: 1 }]);
  assert.deepEqual(run(3, [[fixed('X', 2)], [fixed('CX', 0, 2)]]).columns[1],
    [{ from: 1, to: 1, amplitude: 1 }]);
  assert.deepEqual(run(3, [[fixed('X', 2)], [fixed('XC', 0, 2)]]).columns[1],
    [{ from: 1, to: 5, amplitude: 1 }]);
  assert.deepEqual(run(3, [[fixed('X', 2)], [fixed('XC', 2, 0)]]).columns[1],
    [{ from: 1, to: 1, amplitude: 1 }]);
  const phase = run(3, [[fixed('X', 0), fixed('X', 2)], [fixed('CZ', 2, 0)]]);
  assert.deepEqual(phase.columns[1], [{ from: 5, to: 5, amplitude: -1 }]);
  assert.deepEqual(phase.snapshots[2], [0, 0, 0, 0, 0, -1, 0, 0]);
});

test('A reverse CNOT hole routes coherent branches using the second declared wire as control', () => {
  const puzzle = { wires: 3, columns: [[fixed('H', 2)], [{ id: 'a', wires: [0, 2], choices: ['I', 'CX', 'XC', 'CZ'] }]],
    target: [Math.SQRT1_2, 0, 0, 0, 0, Math.SQRT1_2, 0, 0] };
  const flow = flowTrace(puzzle, { a: 'XC' });
  assert.deepEqual(flow.columns[1], [
    { from: 0, to: 0, amplitude: Math.SQRT1_2 }, { from: 1, to: 5, amplitude: Math.SQRT1_2 },
  ]);
  close(flow.snapshots.at(-1), puzzle.target);
});

test('Joint paths distinguish correlated and anticorrelated Bell states', () => {
  const bell = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)]]);
  const opposite = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)], [fixed('X', 1)]]);
  const occupied = state => state.flatMap((amplitude, basis) => Math.abs(amplitude) < 1e-9 ? [] : [basis]);
  assert.deepEqual(occupied(bell.snapshots.at(-1)), [0, 3]);
  assert.deepEqual(occupied(opposite.snapshots.at(-1)), [1, 2]);
  assert.deepEqual(opposite.columns[2].map(({ from, to }) => [from, to]), [[0, 1], [3, 2]]);
});

test('A column of independent Hadamards shows all four branches and preserves relative phase', () => {
  const { columns, snapshots } = run(2, [[fixed('X', 1)], [fixed('H', 0), fixed('H', 1)]]);
  assert.deepEqual(columns[1].map(({ from, to }) => [from, to]), [[1, 0], [1, 1], [1, 2], [1, 3]]);
  close(columns[1].map(edge => edge.amplitude), [.5, -.5, .5, -.5]);
  close(snapshots[2], [.5, -.5, .5, -.5]);
});

test('Empty holes are identity paths, and prototype-named hole IDs require an own placement', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
    const puzzle = { wires: 1, columns: [[{ id, gate: 'H', wires: [0], choices: ['I', 'X'] }]], target: [0, 1] };
    assert.deepEqual(flowTrace(puzzle).columns, [[{ from: 0, to: 0, amplitude: 1 }]]);
    assert.deepEqual(flowTrace(puzzle, { [id]: 'X' }).columns, [[{ from: 0, to: 1, amplitude: 1 }]]);
    assert.deepEqual(flowTrace(puzzle, { [id]: 'I' }).snapshots.at(-1), [1, 0]);
  }
  assert.throws(() => flowTrace(LEVELS[0], { a: 'CZ' }), RangeError);
  assert.throws(() => flowTrace({}), RangeError);
});

test('Every path boundary agrees with the circuit simulator across tutorials and random puzzles', () => {
  const fourWires = fixture(4, [
    [fixed('H', 0), fixed('H', 1), fixed('H', 2), fixed('H', 3)],
    [fixed('CZ', 0, 3), fixed('XC', 2, 1)],
    [fixed('H', 0), fixed('H', 1), fixed('H', 2), fixed('H', 3)],
  ]);
  const puzzles = [...LEVELS, fourWires, ...Array.from({ length: 12 }, (_, seed) => generatePuzzle(`flow-${seed}`, seed % 3 + 1))];
  for (const puzzle of puzzles) for (const placements of [{}, solvePuzzle(puzzle, { limit: 1 })[0]]) {
    const original = JSON.stringify({ puzzle, placements });
    const { snapshots, columns } = flowTrace(puzzle, placements), simulation = simulate(puzzle, placements);
    assert.equal(columns.length, puzzle.columns.length);
    assert.equal(snapshots.length, puzzle.columns.length + 1);
    close(snapshots.at(-1), simulation.state);
    snapshots.forEach((snapshot, boundary) => {
      const prefix = { ...puzzle, columns: puzzle.columns.slice(0, boundary) };
      if (!prefix.columns.flat().some(entry => entry.id)) prefix.columns.push([{ id: 'boundary', wires: [0], choices: ['I', 'X'] }]);
      const ids = new Set(prefix.columns.flat().map(entry => entry.id));
      const chosen = Object.fromEntries(Object.entries(placements ?? {}).filter(([id]) => ids.has(id)));
      close(snapshot, simulate(prefix, chosen).state);
      assert.ok(Math.abs(snapshot.reduce((sum, amplitude) => sum + amplitude ** 2, 0) - 1) < 1e-9);
    });
    columns.forEach((edges, index) => {
      const summed = Array(2 ** puzzle.wires).fill(0);
      for (const edge of edges) {
        assert.ok(Number.isInteger(edge.from) && edge.from >= 0 && edge.from < summed.length);
        assert.ok(Number.isInteger(edge.to) && edge.to >= 0 && edge.to < summed.length);
        assert.ok(Math.abs(edge.amplitude) >= 1e-9);
        summed[edge.to] += edge.amplitude;
      }
      close(summed, snapshots[index + 1]);
    });
    assert.equal(JSON.stringify({ puzzle, placements }), original, 'Drawing the flow never mutates game state.');
    const again = flowTrace(puzzle, placements);
    snapshots[0][0] = 42;
    columns[0][0].amplitude = 42;
    assert.equal(again.snapshots[0][0], 1);
    assert.notEqual(again.columns[0][0].amplitude, 42);
  }
});
