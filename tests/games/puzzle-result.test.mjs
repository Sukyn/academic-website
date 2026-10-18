import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzleResult } from '../../src/lib/games/puzzle-result.js';

test('puzzle results are reused until immutable inputs change, retaining only the current pair', () => {
  let calls = 0;
  const evaluate = createPuzzleResult((puzzle, placements) => { calls++; return puzzle.goal === placements.gate; });
  const puzzle = { goal: 'H' }, empty = {}, filled = { gate: 'H' };
  assert.equal(evaluate(puzzle, empty), false); assert.equal(evaluate(puzzle, empty), false);
  assert.equal(calls, 1);
  assert.equal(evaluate(puzzle, filled), true); assert.equal(evaluate(puzzle, filled), true);
  assert.equal(calls, 2);
  assert.equal(evaluate({ goal: 'H' }, filled), true); assert.equal(calls, 3);
  assert.equal(evaluate(puzzle, empty), false); assert.equal(calls, 4);
});

test('failed evaluations do not replace the cached result or suppress a retry', () => {
  let calls = 0;
  const puzzle = {}, valid = {}, invalid = {};
  const evaluate = createPuzzleResult((_, placements) => {
    calls++;
    if (placements === invalid) throw new RangeError('Invalid placement');
    return true;
  });
  assert.equal(evaluate(puzzle, valid), true);
  assert.throws(() => evaluate(puzzle, invalid), /Invalid placement/);
  assert.throws(() => evaluate(puzzle, invalid), /Invalid placement/);
  assert.equal(evaluate(puzzle, valid), true); assert.equal(calls, 3);
});
