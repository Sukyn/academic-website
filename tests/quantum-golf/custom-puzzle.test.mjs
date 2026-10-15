import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCustomPuzzle } from '../../src/lib/quantum-golf/custom-puzzle.js';
import { traceDistance } from '../../src/lib/quantum-golf/quantum.js';

test('custom Golf exchanges preserve the hole and normalize only the target vector', () => {
  const input = { target: Object.freeze([2, -2, 1]), epsilon: .2, sequence: 'HT', optimalMoves: 2, level: 1 };
  const puzzle = validateCustomPuzzle(input);
  assert.deepEqual(puzzle, { target: [2 / 3, -2 / 3, 1 / 3], epsilon: .2 });
  assert.deepEqual(input.target, [2, -2, 1]);
  assert.notEqual(puzzle.target, input.target);
  assert.deepEqual(validateCustomPuzzle(JSON.parse(JSON.stringify(puzzle))), puzzle);
  assert.ok(traceDistance(puzzle.target, input.target) < 1e-12);
  for (const epsilon of [.03, .4]) assert.equal(validateCustomPuzzle({ target: [0, 1, 0], epsilon }).epsilon, epsilon);
});

test('custom Golf imports reject malformed vectors and unsafe hole sizes', () => {
  const valid = { target: [0, 1, 0], epsilon: .2 };
  for (const input of [null, [], {},
    ...[null, [], [1, 0], [1, 0, 0, 0], [0, 0, 0], [1, '0', 0], [1, NaN, 0], [1, Infinity, 0],
      [1.7e308, 1.7e308, 1.7e308], [1, , 0]].map(target => ({ ...valid, target })),
    ...[0, -.1, .029, .401, 1, '0.2', null, NaN, Infinity].map(epsilon => ({ ...valid, epsilon })),
  ]) assert.throws(() => validateCustomPuzzle(input), RangeError);
});
