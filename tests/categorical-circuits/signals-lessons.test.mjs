import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevels, getTutorial, generateSignals, fillSignals, signalsSolved, solveSignals, validateSignals } from '../../src/lib/categorical-circuits/puzzles.js';
import { simulate } from '../../src/lib/categorical-circuits/engine.js';
import { goalState, stateEqual } from '../../src/lib/quantum-signals/engine.js';

const op = (gate, wires, controls = []) => ({ gate, wires, ...(controls.length ? { controls } : {}) });
const lesson = profile => getLevels(profile, 'signals').at(-1);
const tripleFamily = puzzle => puzzle.holes.length >= 5 && puzzle.holes.slice(0, 3).every(hole =>
  hole.choices.join() === (hole.wires.length === 2 ? 'I,CX,XC' : 'I,X'));

function requiredActions(puzzle, profile, allSolutions = true) {
  assert.deepEqual(puzzle.target, goalState(puzzle.wires));
  assert.equal(signalsSolved(puzzle, puzzle.solution, profile), true);
  assert.equal(signalsSolved(puzzle, [], profile), false);
  puzzle.solution.forEach((_, index) => {
    const omitted = [...puzzle.solution]; omitted[index] = 'I';
    assert.equal(signalsSolved(puzzle, omitted, profile), false, `Hole ${index + 1} affects the output`);
  });
  const solutions = solveSignals(puzzle, { profile, limit: 4096 });
  assert.ok(solutions.length);
  if (allSolutions) assert.ok(solutions.every(solution => !solution.includes('I')), 'No winning placement leaves a required hole empty');
}

function closingInterference(puzzle, profile) {
  const closing = puzzle.holes.at(-1);
  assert.equal(closing.choices.includes('X'), false, 'The final hole cannot be used as an unconditional bit flip');
  const solutions = solveSignals(puzzle, { profile, limit: 4096 });
  assert.ok(solutions.length && solutions.every(solution => solution.at(-1) === 'H'), 'Every solution must recombine the final two paths');
  const before = simulate(fillSignals(puzzle, puzzle.solution.slice(0, -1), profile), undefined, profile);
  const goal = 2 ** puzzle.wires - 1, other = goal ^ (1 << (puzzle.wires - closing.wires[0] - 1));
  assert.equal(stateEqual(before, before.map((_, basis) => basis === goal ? -Math.SQRT1_2 : basis === other ? Math.SQRT1_2 : 0)), true,
    'The final gate receives opposite phases, not an already-uncomputed basis state');
}

test('category lessons and tutorials finish by interference instead of a final flip', () => {
  for (const profile of ['prop', 'controlled']) {
    for (const puzzle of [...getLevels(profile, 'signals'), getTutorial(profile, 'signals')]) closingInterference(puzzle, profile);
  }
});

test('every generated category puzzle requires its closing Hadamard and keeps varied layouts', () => {
  for (const profile of ['prop', 'controlled']) for (const difficulty of [1, 2, 3]) {
    const variants = new Set();
    let emptyHoles = 0;
    for (let seed = 0; seed < 30; seed++) {
      const puzzle = generateSignals(profile, { seed: 'interference-' + seed, difficulty });
      assert.deepEqual(puzzle, generateSignals(profile, { seed: 'interference-' + seed, difficulty }));
      closingInterference(puzzle, profile);
      variants.add(JSON.stringify({ columns: puzzle.columns, holes: puzzle.holes }));
      emptyHoles += puzzle.solution.includes('I');
    }
    assert.ok(variants.size >= 12, `${profile}, difficulty ${difficulty}: ${variants.size} varied wires, controls and placements`);
    assert.ok(emptyHoles > 0, `${profile}, difficulty ${difficulty}: optional identity holes remain available`);
  }
});

test('Signals appends category-specific CNOT lessons without changing existing level IDs', () => {
  const originalTitles = {
    prop: ['Move the excitation', 'Move a superposition', 'Move a correlation', 'Return to one path'],
    controlled: ['Unequal branches', 'Two control bits', 'Choose which crossing', 'A controlled interference'],
  };
  for (const profile of ['prop', 'controlled']) {
    const levels = getLevels(profile, 'signals');
    for (const level of levels) requiredActions(level, profile);
    assert.deepEqual(levels.slice(0, 4).map(({ id, title }) => [id, title]), originalTitles[profile].map((title, index) => [index + 1, title]));
    const puzzle = lesson(profile);
    assert.equal(puzzle.id, 5);
    assert.equal(puzzle.title, profile === 'prop' ? 'Three CNOTs make a swap' : 'Control three CNOTs');
    assert.equal(tripleFamily(puzzle), true);
    requiredActions(puzzle, profile);
    const swap = profile === 'prop' ? op('SWAP', [0, 1]) : op('SWAP', [1, 2], [0]);
    const filled = fillSignals(puzzle, puzzle.solution, profile);
    const reference = simulate({ wires: puzzle.wires, columns: [...puzzle.columns, [swap], ...filled.columns.slice(puzzle.columns.length + 3)] }, undefined, profile);
    assert.equal(stateEqual(puzzle.target, reference), true, 'The target is exactly the corresponding swap');
    if (profile === 'prop') {
      assert.ok(puzzle.holes.every(hole => !Object.hasOwn(hole, 'controls')));
      assert.deepEqual(solveSignals(puzzle, { profile, limit: 4096 }).map(solution => solution.slice(0, 3)), [['CX', 'XC', 'CX'], ['XC', 'CX', 'XC']]);
    } else {
      assert.ok(puzzle.holes.slice(0, 3).every(hole => hole.controls.includes(0)), 'The decomposition uses a shared constructor');
    }
  }
});

test('PROP Signals teaches a crossing followed by three complete alternating CNOT gates', () => {
  const puzzle = getTutorial('prop', 'signals');
  assert.deepEqual(puzzle.steps.map(({ hole, gate }) => [hole, gate]), [[0, 'SWAP'], [1, 'CX'], [2, 'XC'], [3, 'CX'], [4, 'CX'], [5, 'H']]);
  assert.ok(puzzle.holes.every(hole => !Object.hasOwn(hole, 'controls')));
  requiredActions(puzzle, 'prop', false);
  const filled = fillSignals(puzzle, puzzle.solution, 'prop');
  const reference = simulate({ wires: puzzle.wires, columns: [...puzzle.columns, [op('SWAP', [0, 1])], [op('SWAP', [0, 1])], ...filled.columns.slice(puzzle.columns.length + 4)] }, undefined, 'prop');
  assert.equal(stateEqual(puzzle.target, reference), true);
});

test('Controlled Signals teaches the constructor from its first guided action', () => {
  const puzzle = getTutorial('controlled', 'signals');
  assert.deepEqual(puzzle.steps.map(({ gate }) => gate), ['SWAP', 'H', 'H']);
  assert.ok(puzzle.holes.slice(0, 2).every(hole => hole.controls.includes(0)));
  assert.match(puzzle.steps[0].text, /control.*first bit is 1/);
  requiredActions(puzzle, 'controlled');
});

test('Signals random generation samples varied swap decompositions alongside existing families', () => {
  for (const [profile, difficulty] of [['prop', 2], ['prop', 3], ['controlled', 3]]) {
    let triples = 0, others = 0;
    const variants = new Set(), pairs = new Set(), directions = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const puzzle = generateSignals(profile, { seed, difficulty });
      assert.deepEqual(generateSignals(profile, { seed, difficulty }), puzzle);
      validateSignals(puzzle, profile);
      assert.equal(signalsSolved(puzzle, puzzle.solution, profile), true);
      if (!tripleFamily(puzzle)) { others++; continue; }
      triples++;
      requiredActions(puzzle, profile);
      const first = puzzle.holes[0], second = puzzle.holes[1];
      const targets = profile === 'prop' ? first.wires : [second.wires[0], first.wires[0]];
      const controls = profile === 'prop' ? [] : first.controls.filter(wire => !targets.includes(wire));
      assert.equal(Math.abs(targets[0] - targets[1]), 1);
      const filled = fillSignals(puzzle, puzzle.solution, profile);
      const reference = simulate({ wires: puzzle.wires, columns: [...puzzle.columns, [op('SWAP', targets, controls)], ...filled.columns.slice(puzzle.columns.length + 3)] }, undefined, profile);
      assert.equal(stateEqual(puzzle.target, reference), true);
      assert.equal(stateEqual(simulate(fillSignals(puzzle, puzzle.solution, profile), undefined, profile), reference), true);
      variants.add(JSON.stringify({ columns: puzzle.columns, holes: puzzle.holes }));
      pairs.add([...targets].sort().join()); directions.add(targets[0] < targets[1]);
    }
    assert.ok(triples > 5 && others > 5, `${profile} ${difficulty}: both puzzle families are represented`);
    assert.ok(variants.size >= 4, `${profile} ${difficulty}: varied adjacent pairs and directions`);
    assert.ok(pairs.size >= 2); assert.equal(directions.size, 2);
  }
});
