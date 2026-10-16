import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyCorrectionColumns } from '../../src/lib/graph-states/clifford.js';
import { applyMove, correctionColumns, pathGraph } from '../../src/lib/graph-states/engine.js';
import { seededRandom } from '../../src/lib/games/random.js';

// Independent complex 2×2 matrices test the entire unitary, not one graph state.
const IDENTITY = [[1, 0], [0, 0], [0, 0], [1, 0]];
const MATRICES = {
  H: [[Math.SQRT1_2, 0], [Math.SQRT1_2, 0], [Math.SQRT1_2, 0], [-Math.SQRT1_2, 0]],
  S: [[1, 0], [0, 0], [0, 0], [0, 1]],
  SDG: [[1, 0], [0, 0], [0, 0], [0, -1]],
  X: [[0, 0], [1, 0], [1, 0], [0, 0]],
  Z: [[1, 0], [0, 0], [0, 0], [-1, 0]],
};
const product = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];

function multiply(a, b) {
  return Array.from({ length: 4 }, (_, index) => {
    const row = Math.floor(index / 2), column = index % 2;
    const first = product(a[row * 2], b[column]), second = product(a[row * 2 + 1], b[column + 2]);
    return [first[0] + second[0], first[1] + second[1]];
  });
}

function unitary(word) {
  return word.reduce((state, gate) => multiply(MATRICES[gate], state), IDENTITY);
}

function equivalent(a, b) {
  const pivot = b.findIndex(([real, imaginary]) => Math.hypot(real, imaginary) > .1);
  const [br, bi] = b[pivot], [ar, ai] = a[pivot], scale = br * br + bi * bi;
  const phase = [(ar * br + ai * bi) / scale, (ai * br - ar * bi) / scale];
  return Math.abs(Math.hypot(...phase) - 1) < 1e-10 && b.every((value, index) => {
    const expected = product(phase, value);
    return Math.hypot(a[index][0] - expected[0], a[index][1] - expected[1]) < 1e-10;
  });
}

const columnsFor = word => word.map(gate => [{ gate, wires: [0] }]);
const wireWord = (columns, wire) => columns.flatMap(column => column.filter(entry => entry.wires[0] === wire).map(entry => entry.gate));

test('all 24 local Cliffords use shortest words of at most three gates, verified with complex matrices', () => {
  const words = [[]], classes = [];
  for (let cursor = 0; cursor < words.length; cursor++) {
    const word = words[cursor], matrix = unitary(word), columns = simplifyCorrectionColumns(1, columnsFor(word));
    let known = classes.find(entry => equivalent(matrix, entry.matrix));
    if (!known) { known = { matrix, length: word.length }; classes.push(known); }
    const compact = wireWord(columns, 0);
    assert.ok(equivalent(unitary(compact), matrix), `${word.join(' ')} changed its unitary`);
    assert.equal(compact.length, known.length, `Non-minimal form for ${word.join(' ')}`);
    assert.ok(columns.length <= 3);
    if (word.length < 4) for (const gate of Object.keys(MATRICES)) words.push([...word, gate]);
  }
  assert.equal(classes.length, 24);
  assert.equal(Math.max(...classes.map(entry => entry.length)), 3);
});

test('inverses and Pauli phases cancel, while corrections on separate wires can run in parallel', () => {
  for (const word of [['H', 'H'], ['S', 'SDG'], ['SDG', 'S'], ['S', 'S', 'S', 'S'], ['X', 'X'], ['Z', 'Z'], ['X', 'Z', 'X', 'Z']]) {
    assert.deepEqual(simplifyCorrectionColumns(3, columnsFor(word)), [], word.join(' '));
  }
  assert.deepEqual(simplifyCorrectionColumns(3, columnsFor(['S', 'S'])), [[{ gate: 'Z', wires: [0] }]]);
  assert.deepEqual(simplifyCorrectionColumns(3, [
    [{ gate: 'H', wires: [0] }], [{ gate: 'SDG', wires: [1] }], [{ gate: 'S', wires: [2] }],
  ]), [[{ gate: 'H', wires: [0] }, { gate: 'SDG', wires: [1] }, { gate: 'S', wires: [2] }]]);
  assert.deepEqual(simplifyCorrectionColumns(8, []), []);
});

test('every prefix of long mixed graph histories preserves each complete local correction unitary', () => {
  const random = seededRandom('compact-local-clifford-matrix-proof');
  for (let vertices = 3; vertices <= 8; vertices++) {
    let graph = pathGraph(vertices);
    const columns = [];
    for (let step = 0; step < 128; step++) {
      const move = random() < .5 ? { vertex: Math.floor(random() * vertices) } : { edge: graph.edges[Math.floor(random() * graph.edges.length)] };
      columns.push(...correctionColumns(graph, move));
      graph = applyMove(graph, move);
      const simplified = simplifyCorrectionColumns(vertices, columns);
      assert.ok(simplified.length <= 3);
      for (const column of simplified) assert.equal(new Set(column.map(entry => entry.wires[0])).size, column.length);
      for (let wire = 0; wire < vertices; wire++) {
        assert.ok(equivalent(unitary(wireWord(simplified, wire)), unitary(wireWord(columns, wire))),
          `Changed wire ${wire} after ${step + 1} operations on ${vertices} vertices`);
      }
    }
  }
});

test('simplification leaves input data untouched and every returned gate is detached', () => {
  const columns = correctionColumns(pathGraph(4), { vertex: 1 }), saved = structuredClone(columns);
  const compact = simplifyCorrectionColumns(4, columns), expected = structuredClone(compact);
  assert.deepEqual(columns, saved);
  compact[0][0].gate = 'X'; compact[0][0].wires[0] = 99; compact.pop();
  assert.deepEqual(simplifyCorrectionColumns(4, columns), expected);
  assert.deepEqual(columns, saved);
});
