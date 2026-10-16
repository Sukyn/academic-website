import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES, applyMove, cloneCircuit, getLegalMoves, isIdentity,
  isSolved, lowerBound, sequenceCost, solveShortest, validateCircuit,
} from '../../src/lib/circuit-reduction/engine.js';
import { decodeCircuit } from '../../src/lib/circuit-reduction/stored-puzzles.js';
import { generatePuzzle, LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { DAILY_START } from '../../src/lib/circuit-reduction/puzzles.js';

// Independent dense-matrix evaluator: tensor ordering is row 0 most significant.
// Linked X/Z gates use explicit CNOT matrices or a rank-one XX reflection,
// rather than the state-vector/H-conjugation implementation being tested.
const identity = size => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => Number(x === y)));
const multiply = (a, b) => a.map(row => b[0].map((_, x) => row.reduce((sum, value, k) => sum + value * b[k][x], 0)));
const tensor = (a, b) => a.flatMap(row => b.map(line => row.flatMap(value => line.map(cell => value * cell))));
const H = [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
const X = [[0, 1], [1, 0]], Z = [[1, 0], [0, -1]];
const permutation = images => images.map((_, row) => images.map(image => Number(image === row)));
const linked = {
  ZUZD: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, -1]],
  ZUXD: permutation([0, 1, 3, 2]),
  XUZD: permutation([0, 3, 2, 1]),
  XUXD: [1, -1, -1, 1].map((a, row) => [1, -1, -1, 1].map((b, column) => Number(row === column) - a * b / 2)),
};

function circuitMatrix(circuit) {
  const wires = circuit.length;
  let result = identity(2 ** wires);
  for (let column = 0; column < circuit[0].length; column++) {
    for (let row = 0; row < wires; row++) {
      const cell = circuit[row][column];
      if (cell === '.' || cell.endsWith('D')) continue;
      const local = cell.endsWith('U') ? linked[cell + circuit[row + 1][column]] : ({ H, X, Z })[cell];
      assert.ok(local, `Unsupported independent matrix gate ${cell}`);
      const width = cell.endsWith('U') ? 2 : 1;
      const gate = tensor(tensor(identity(2 ** row), local), identity(2 ** (wires - row - width)));
      result = multiply(gate, result);
    }
  }
  return result;
}

function assertMatrixEqual(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  for (let row = 0; row < actual.length; row++) for (let column = 0; column < actual.length; column++) {
    assert.ok(Math.abs(actual[row][column] - expected[row][column]) < 1e-9, `${label} at (${row}, ${column})`);
  }
}

function ruleContexts(rule) {
  const variants = [];
  if (rule.left.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('U'))) {
    for (const partner of ['ZD', 'XD']) {
      const lower = rule.left[0].map((cell, column) => cell.endsWith('U') || rule.right[0][column].endsWith('U') ? partner : '.');
      variants.push({ left: [...cloneCircuit(rule.left), lower], right: [...cloneCircuit(rule.right), [...lower]], row: 0 });
    }
  } else if (rule.left.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('D'))) {
    for (const partner of ['ZU', 'XU']) {
      const upper = rule.left[0].map((cell, column) => cell.endsWith('D') || rule.right[0][column].endsWith('D') ? partner : '.');
      variants.push({ left: [upper, ...cloneCircuit(rule.left)], right: [[...upper], ...cloneCircuit(rule.right)], row: 1 });
    }
  } else variants.push({ left: cloneCircuit(rule.left), right: cloneCircuit(rule.right), row: 0 });
  return variants;
}

test('Every printed/Unity rewrite preserves its exact quantum matrix in both directions', () => {
  for (const rule of RULES) for (const context of ruleContexts(rule)) {
    const { left, right, row } = context;
    const savedLeft = cloneCircuit(left), savedRight = cloneCircuit(right);
    validateCircuit(left); validateCircuit(right);
    assertMatrixEqual(circuitMatrix(left), circuitMatrix(right), rule.id);
    const move = { rule: rule.id, row, column: 0 };
    assert.ok(getLegalMoves(left).some(item => JSON.stringify(item) === JSON.stringify(move)), rule.id);
    assert.deepEqual(applyMove(left, move), right, `${rule.id} forward`);
    assert.deepEqual(applyMove(right, move), left, `${rule.id} reverse`);
    assert.ok(Math.abs(lowerBound(left) - lowerBound(right)) <= 1, `${rule.id} admissible bound`);
    assert.deepEqual(left, savedLeft, `${rule.id} source not mutated`);
    assert.deepEqual(right, savedRight, `${rule.id} reverse source not mutated`);
  }
});

test('Selected rule windows preserve both directions and never scan the rest of a long wire', () => {
  for (const rule of RULES) for (const context of ruleContexts(rule)) for (const side of ['left', 'right']) {
    const circuit = context[side].map(line => ['.', ...line, '.']);
    const window = { row: context.row, column: 1, height: rule.left.length, width: rule.left[0].length };
    const expected = getLegalMoves(circuit).filter(move => {
      const match = RULES.find(item => item.id === move.rule);
      return move.row === window.row && move.column === window.column && match.left.length === window.height && match.left[0].length === window.width;
    });
    assert.deepEqual(getLegalMoves(circuit, { window }), expected, `${rule.id} ${side}`);
    assert.deepEqual(getLegalMoves(circuit, { window, allowedRules: [rule.id] }), [{ rule: rule.id, row: context.row, column: 1 }]);
  }
  const line = Array(10_000).fill('.'); line[5_000] = line[5_001] = 'H';
  const selectedOnly = new Proxy(line, { get(target, property) {
    if (/^\d+$/.test(String(property))) assert.ok(Number(property) >= 5_000 && Number(property) <= 5_001, 'Only selected cells are inspected');
    return Reflect.get(target, property);
  } });
  assert.deepEqual(getLegalMoves([selectedOnly], {
    allowedRules: ['cancel-h'], window: { row: 0, column: 5_000, height: 1, width: 2 },
  }), [{ rule: 'cancel-h', row: 0, column: 5_000 }]);
});

test('Empty slots, partner endpoints, and padding are validated explicitly', () => {
  assert.throws(() => applyMove([['H', '.', 'H']], { rule: 'cancel-h', row: 0, column: 0 }), RangeError);
  assert.throws(() => applyMove([['H', 'H']], { rule: 'unknown', row: 0, column: 0 }), RangeError);
  assert.throws(() => applyMove([['H', 'H']], { rule: 'cancel-h', row: .5, column: 0 }), RangeError);
  assert.throws(() => applyMove([['H', 'H']], { rule: 'remove-column', row: 0, column: 0 }), RangeError);
  assert.throws(() => validateCircuit([['ZU', '.'], ['.', '.']]), RangeError);
  assert.throws(() => validateCircuit([['X', '.'], ['.', '.', '.']]), RangeError);
  const original = [['H', '.', 'H'], ['X', '.', 'X']];
  const compact = applyMove(original, { rule: 'remove-column', row: 0, column: 1 });
  assertMatrixEqual(circuitMatrix(original), circuitMatrix(compact), 'padding removal');
  assert.deepEqual(applyMove(compact, { rule: 'insert-column', row: 0, column: 1 }), original);
  assert.deepEqual(original, [['H', '.', 'H'], ['X', '.', 'X']]);
});

test('Identity recognition agrees with independent matrices, including both X endpoints', () => {
  const circuits = [
    '. .', 'H H', 'X X', 'Z Z', 'H Z H X', 'X Z X Z',
    'ZU ZU / ZD ZD', 'ZU ZU / XD XD', 'XU XU / ZD ZD', 'XU XU / XD XD',
    'ZU XU / XD ZD', 'H . / X .',
  ];
  for (const text of circuits) {
    const circuit = validateCircuit(decodeCircuit(text));
    const matrix = circuitMatrix(circuit), expected = identity(matrix.length);
    const equalsIdentity = matrix.every((row, y) => row.every((cell, x) => Math.abs(cell - expected[y][x]) < 1e-9));
    assert.equal(isIdentity(circuit), equalsIdentity, text);
  }
  const symbols = ['.', 'H', 'X', 'Z'];
  for (let code = 0; code < 256; code++) {
    const circuit = [Array.from({ length: 4 }, (_, column) => symbols[(code >>> (2 * column)) & 3])];
    const matrix = circuitMatrix(circuit), expected = identity(2);
    const equalsIdentity = matrix.every((row, y) => row.every((cell, x) => Math.abs(cell - expected[y][x]) < 1e-9));
    assert.equal(isIdentity(circuit), equalsIdentity, `exhaustive single wire ${code}`);
  }
});

test('500 generated circuits have independently verified identity and certified 10–14 rewrite witnesses', () => {
  for (let seed = 0; seed < 100; seed++) for (let difficulty = 10; difficulty <= 14; difficulty++) {
    const puzzle = generatePuzzle(`independent-audit-${seed}`, difficulty);
    validateCircuit(puzzle.circuit);
    assert.equal(puzzle.optimalMoves, difficulty);
    assert.ok(lowerBound(puzzle.circuit) < difficulty, 'hard puzzles require decisions beyond gate cancellation');
    assert.equal(sequenceCost(puzzle.solution), difficulty);
    assertMatrixEqual(circuitMatrix(puzzle.circuit), identity(2 ** puzzle.circuit.length), `seed ${seed}, difficulty ${difficulty}`);
    let current = puzzle.circuit;
    for (const move of puzzle.solution) {
      current = applyMove(current, move);
      validateCircuit(current);
    }
    assert.ok(isSolved(current));
    if (seed < 2) assert.deepEqual(generatePuzzle(`independent-audit-${seed}`, difficulty), puzzle, 'seed reproducibility');
  }
});

test('Campaign witnesses are legal, solve identity circuits, and tutorial optima are exact', () => {
  for (const level of LEVELS) {
    assertMatrixEqual(circuitMatrix(level.circuit), identity(2 ** level.circuit.length), `campaign ${level.id}`);
    let current = level.circuit;
    for (const move of level.solution) current = applyMove(current, move);
    assert.ok(isSolved(current), `campaign ${level.id} witness`);
    assert.equal(sequenceCost(level.solution), level.optimalMoves ?? level.parMoves, `campaign ${level.id} rewrite score`);
    if (level.optimalMoves !== null && level.optimalMoves <= 7) {
      const result = solveShortest(level.circuit, { maxDepth: level.optimalMoves, maxNodes: 250000, allowedRules: level.allowedRules });
      assert.equal(result.status, 'optimal', `campaign ${level.id} solver completed`);
      assert.equal(result.optimalMoves, level.optimalMoves, `campaign ${level.id} claimed optimum`);
    }
  }
});

test('100 daily dates are deterministic, exact 10–14 moves, and cached values are isolated', () => {
  for (let day = 0; day < 100; day++) {
    const date = new Date(`${DAILY_START}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + day);
    const key = date.toISOString().slice(0, 10), puzzle = dailyPuzzle(key);
    assert.ok(puzzle.optimalMoves >= 10 && puzzle.optimalMoves <= 14);
    assert.ok(lowerBound(puzzle.circuit) <= puzzle.optimalMoves);
    assert.equal(sequenceCost(puzzle.solution), puzzle.optimalMoves);
    assert.deepEqual(dailyPuzzle(key), puzzle);
    let current = puzzle.circuit;
    for (const move of puzzle.solution) current = applyMove(current, move);
    assert.ok(isSolved(current), key);
    puzzle.circuit[0][0] = 'invalid';
    assert.notEqual(dailyPuzzle(key).circuit[0][0], 'invalid');
  }
  for (const date of ['2026-10-13', '2026-02-30', 'bad', '', null]) assert.throws(() => dailyPuzzle(date), RangeError);
});
