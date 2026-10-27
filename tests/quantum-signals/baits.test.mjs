import test from 'node:test';
import assert from 'node:assert/strict';
import { getHoles, simulate, solvePuzzle, stateEqual } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, dailyPuzzle, generatePuzzle } from '../../src/lib/quantum-signals/puzzles.js';

const omitIdentities = solution => Object.fromEntries(Object.entries(solution).filter(([, gate]) => gate !== 'I'));

test('official levels need no identity baits, including the editable interference finish', () => {
  assert.deepEqual(LEVELS.slice(0, 6).map(puzzle => getHoles(puzzle).length), [1, 2, 2, 1, 3, 2]);
  for (const puzzle of LEVELS) {
    assert.ok(puzzle.title.length > 0);
    assert.ok(getHoles(puzzle).length <= 6);
    assert.equal(stateEqual(simulate(puzzle).state, puzzle.target), false);
    assert.ok(getHoles(puzzle).every(hole => hole.choices.some(gate => gate !== 'I')));
    assert.ok(solvePuzzle(puzzle, { limit: 4096 }).some(solution => Object.values(solution).every(gate => gate !== 'I')),
      'Every fixed level has a solution using a real gate in every hole');
  }
  assert.equal(simulate(LEVELS[4], { a: 'H', b: 'Z', c: 'H' }).solved, true);
});

test('random puzzles remain deterministic and can be solved with identity holes left empty', () => {
  for (let difficulty = 1; difficulty <= 3; difficulty++) {
    let withIdentities = 0;
    for (let seed = 0; seed < 24; seed++) {
      const puzzle = generatePuzzle(`bait-${seed}`, difficulty);
      assert.deepEqual(puzzle, generatePuzzle(`bait-${seed}`, difficulty));
      assert.deepEqual(Object.keys(puzzle).sort(), ['columns', 'target', 'wires']);
      assert.ok(getHoles(puzzle).length <= 6);
      for (const hole of getHoles(puzzle)) {
        const compatible = hole.wires.length === 1 ? ['I', 'H', 'X', 'Z'] : ['I', 'CX', 'XC', 'CZ'];
        assert.ok(hole.choices.includes('I') && hole.choices.length >= 2 && hole.choices.length <= 4);
        assert.ok(hole.choices.every(gate => compatible.includes(gate)), 'Each hole offers a constrained, compatible gate set');
      }
      assert.equal(stateEqual(simulate(puzzle).state, puzzle.target), false, 'The untouched circuit is never already the solution');
      const solution = solvePuzzle(puzzle, { limit: 1 })[0];
      assert.ok(solution);
      const placements = omitIdentities(solution);
      if (Object.keys(placements).length < Object.keys(solution).length) withIdentities++;
      assert.equal(simulate(puzzle, placements).solved, true);
    }
    assert.ok(withIdentities > 0, `Difficulty ${difficulty} includes solutions with empty identity holes`);
  }
});

test('daily puzzles share the same empty-identity behavior without exposing bait metadata', () => {
  let withIdentities = 0;
  for (let day = 25; day < 32; day++) {
    const date = `2026-10-${day}`, puzzle = dailyPuzzle(date);
    assert.deepEqual(puzzle, dailyPuzzle(date));
    assert.deepEqual(Object.keys(puzzle).sort(), ['columns', 'date', 'target', 'wires']);
    const solution = solvePuzzle(puzzle, { limit: 1 })[0];
    assert.ok(solution);
    const placements = omitIdentities(solution);
    if (Object.keys(placements).length < Object.keys(solution).length) withIdentities++;
    assert.equal(simulate(puzzle, placements).solved, true);
  }
  assert.ok(withIdentities > 0);
});
