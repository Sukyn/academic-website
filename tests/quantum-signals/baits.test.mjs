import test from 'node:test';
import assert from 'node:assert/strict';
import { getHoles, simulate, solvePuzzle, stateEqual } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, dailyPuzzle, generatePuzzle } from '../../src/lib/quantum-signals/puzzles.js';

const omitIdentities = solution => Object.fromEntries(Object.entries(solution).filter(([, gate]) => gate !== 'I'));

test('official levels retain their original holes and need no identity baits', () => {
  assert.deepEqual(LEVELS.map(puzzle => getHoles(puzzle).length), [1, 1, 1, 1, 1, 2, 1, 1, 2, 2, 3, 5]);
  for (const puzzle of LEVELS) {
    assert.ok(puzzle.title.length > 0);
    assert.ok(getHoles(puzzle).length <= 6);
    assert.equal(stateEqual(simulate(puzzle).state, puzzle.target), false);
    assert.ok(getHoles(puzzle).every(hole => hole.choices.some(gate => gate !== 'I')));
    assert.ok(solvePuzzle(puzzle, { limit: 4096 }).some(solution => Object.values(solution).every(gate => gate !== 'I')),
      'Every fixed level has a solution using a real gate in each original hole');
  }
  assert.equal(getHoles(LEVELS.at(-1)).length, 5, 'The tutorial source level retains its five original holes');
});

test('random puzzles remain deterministic and can be solved with identity holes left empty', () => {
  for (let difficulty = 1; difficulty <= 3; difficulty++) {
    let withIdentities = 0, baits = 0;
    for (let seed = 0; seed < 24; seed++) {
      const puzzle = generatePuzzle(`bait-${seed}`, difficulty);
      assert.deepEqual(puzzle, generatePuzzle(`bait-${seed}`, difficulty));
      assert.deepEqual(Object.keys(puzzle).sort(), ['columns', 'target', 'wires']);
      assert.ok(getHoles(puzzle).length <= 6);
      assert.equal(stateEqual(simulate(puzzle).state, puzzle.target), false, 'The untouched circuit is never already the solution');
      const solution = solvePuzzle(puzzle, { limit: 1 })[0];
      assert.ok(solution);
      const placements = omitIdentities(solution);
      if (Object.keys(placements).length < Object.keys(solution).length) withIdentities++;
      assert.equal(simulate(puzzle, placements).solved, true);
      const bait = getHoles(puzzle).find(hole => hole.choices.length === 2 && hole.choices[0] === 'I' && hole.choices[1] === 'H');
      if (bait) {
        baits++;
        const solutions = solvePuzzle(puzzle, { limit: 4096 });
        assert.ok(solutions.every(solution => solution[bait.id] === 'I'), 'Every valid filling must leave the bait as identity');
        assert.ok(solutions.every(solution => Object.values(solution).includes('I')), 'There is no solution made entirely of real gates');
      }
    }
    assert.ok(withIdentities > 0, `Difficulty ${difficulty} includes solutions with empty identity holes`);
    assert.ok(baits > 0 && baits < 24, `Difficulty ${difficulty} sometimes includes a forced identity`);
  }
});

test('daily puzzles share the same empty-identity behavior without exposing bait metadata', () => {
  let withIdentities = 0;
  for (let day = 16; day < 23; day++) {
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
