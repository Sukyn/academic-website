import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, getHoles, simulate } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';
import { TUTORIAL_STEPS } from '../../src/lib/quantum-signals/tutorial.js';

test('the worked tutorial fills the three-qubit circuit and reaches its complete target', () => {
  const puzzle = LEVELS.at(-1), saved = structuredClone(puzzle);
  assert.equal(puzzle.wires, 3);
  assert.deepEqual(TUTORIAL_STEPS.map(({ hole, gate }) => [hole, gate]), [['a', 'H'], ['b', 'CX'], ['c', 'CZ'], ['d', 'H'], ['e', 'Z']]);
  assert.equal(TUTORIAL_STEPS.length, getHoles(puzzle).length);
  let placements = {};
  for (const [index, { hole, gate, text }] of TUTORIAL_STEPS.entries()) {
    assert.ok(text.length > 0 && text.length < 150);
    placements = applyPlacement(puzzle, placements, { hole, gate });
    assert.equal(simulate(puzzle, placements).solved, index === TUTORIAL_STEPS.length - 1);
  }
  assert.deepEqual(puzzle, saved);
});
