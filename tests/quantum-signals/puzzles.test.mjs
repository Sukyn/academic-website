import test from 'node:test';
import assert from 'node:assert/strict';
import { getHoles, goalState, simulate, solvePuzzle, validateCustomPuzzle, puzzleData } from '../../src/lib/quantum-signals/engine.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { DAILY_START, DAILY_VERSION, LEVELS, generatePuzzle, dailyPuzzle } from '../../src/lib/quantum-signals/puzzles.js';

const pairGate = gate => gate === 'CX' || gate === 'XC' || gate === 'CZ';
const active = state => state.filter(value => Math.abs(value) > 1e-9).length;
const permutations = values => values.length ? values.flatMap((value, index) =>
  permutations(values.filter((_, other) => index !== other)).map(tail => [value, ...tail])) : [[]];

// Ignore internal hole IDs, parallel-entry order, and equivalent pair encodings.
function layout(puzzle, mapping = Array.from({ length: puzzle.wires }, (_, wire) => wire)) {
  const swapped = gate => gate === 'CX' ? 'XC' : gate === 'XC' ? 'CX' : gate;
  return JSON.stringify(puzzle.columns.map(column => column.map(entry => {
    const wires = entry.wires.map(wire => mapping[wire]), reverse = wires.length === 2 && wires[0] > wires[1];
    const gate = value => reverse ? swapped(value) : value;
    if (reverse) wires.reverse();
    return [wires, entry.id ? entry.choices.map(gate).sort() : gate(entry.gate)];
  }).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)))));
}

const canonicalLayout = puzzle => permutations(Array.from({ length: puzzle.wires }, (_, wire) => wire))
  .map(mapping => layout(puzzle, mapping)).sort()[0];

function assertConstrained(puzzle) {
  assert.deepEqual(puzzle.target, goalState(puzzle.wires));
  assert.equal(simulate(puzzle).solved, false);
  assert.ok(puzzle.columns.length <= 16 && getHoles(puzzle).length <= 6);
  const closing = puzzle.columns.at(-1);
  assert.equal(closing.length, 1); assert.equal(closing[0].gate, 'H');
  assert.ok(!closing[0].id, 'The last gate is imposed, with no editable X suffix');
  const firstHole = puzzle.columns.findIndex(column => column.some(entry => entry.id));
  assert.ok(firstHole < puzzle.columns.length - 1, 'Imposed gates occur after editable holes');
  const solutions = solvePuzzle(puzzle, { limit: 4096 });
  assert.ok(solutions.length);
  for (const solution of solutions) {
    const gates = Object.values(solution);
    assert.ok(gates.includes('H') && gates.includes('Z'), 'Every solution uses a Hadamard and a phase flip');
    if (puzzle.wires > 1) assert.ok(gates.some(pairGate), 'Entanglement cannot be solved with only single-wire gates');
    const trace = flowTrace(puzzle, solution), beforeFinal = trace.snapshots.at(-2);
    assert.equal(active(beforeFinal), 2, 'Final interference receives two coherent contributions, not a basis-state X finish');
    assert.ok(beforeFinal.some(value => value > 1e-9) && beforeFinal.some(value => value < -1e-9));
    assert.equal(simulate(puzzle, solution).solved, true);
  }
  return solutions;
}

test('random layouts are deterministic constrained interference puzzles, not an inverse prefix followed by flips', () => {
  for (let difficulty = 1; difficulty <= 3; difficulty++) {
    for (let seed = 0; seed < 32; seed++) {
      const puzzle = generatePuzzle(`interference-${seed}`, difficulty), saved = structuredClone(puzzle);
      assert.deepEqual(puzzle, generatePuzzle(`interference-${seed}`, difficulty));
      assertConstrained(puzzle);
      assert.deepEqual(validateCustomPuzzle(puzzleData(puzzle)).target, puzzle.target);
      assert.deepEqual(puzzle, saved);
    }
  }
});

test('medium and hard puzzles vary after wire relabelling, with scattered holes and varied gate palettes', context => {
  for (const difficulty of [2, 3]) {
    const raw = new Set(), canonical = new Set(), holePatterns = new Set(), palettes = new Set();
    for (let seed = 0; seed < 96; seed++) {
      const puzzle = generatePuzzle(`variety-${seed}`, difficulty);
      raw.add(layout(puzzle)); canonical.add(canonicalLayout(puzzle));
      holePatterns.add(JSON.stringify(puzzle.columns.map(column => column.map(entry => entry.id ? entry.wires.length : 0).sort())));
      for (const hole of getHoles(puzzle)) palettes.add(hole.choices.slice().sort().join(','));
    }
    assert.ok(raw.size >= 86, `${difficulty}: ${raw.size}/96 distinct labelled layouts`);
    assert.ok(canonical.size >= 64, `${difficulty}: ${canonical.size}/96 distinct layouts after wire relabelling`);
    assert.ok(holePatterns.size >= 24, `${difficulty}: ${holePatterns.size} different editable/fixed patterns`);
    assert.ok(palettes.size >= 6, `${difficulty}: ${palettes.size} gate palettes`);
    context.diagnostic(`Difficulty ${difficulty}: ${raw.size}/96 layouts, ${canonical.size}/96 after wire relabelling, ${holePatterns.size} hole patterns, ${palettes.size} palettes.`);
  }
});

test('construction stays bounded and solvable across hundreds of seeds at every difficulty', () => {
  for (let difficulty = 1; difficulty <= 3; difficulty++) for (let seed = 0; seed < 300; seed++) {
    const puzzle = generatePuzzle(`construction-${seed}`, difficulty);
    assert.equal(puzzle.wires, difficulty);
    assert.ok(puzzle.columns.length <= 16 && getHoles(puzzle).length <= 6);
    const solution = solvePuzzle(puzzle, { limit: 1 })[0];
    assert.ok(solution); assert.equal(simulate(puzzle, solution).solved, true);
    assert.equal(puzzle.columns.at(-1)[0].gate, 'H');
  }
});

test('later official levels keep their names and require nontrivial placements before an imposed closing H', () => {
  for (const puzzle of LEVELS.slice(6)) {
    assert.ok(puzzle.title.length > 0);
    const solutions = assertConstrained(puzzle);
    assert.ok(solutions.every(solution => Object.values(solution).every(gate => gate !== 'I')), 'No official level has an identity bait');
  }
});

test('daily boards use the new deterministic layouts and return detached data', () => {
  assert.equal(DAILY_START, '2026-10-25');
  assert.equal(DAILY_VERSION, 'quantum-signals-daily-v7');
  const first = dailyPuzzle(DAILY_START), saved = structuredClone(first);
  assertConstrained(first);
  first.target[0] = 99; first.columns[0][0].gate = 'I';
  assert.deepEqual(dailyPuzzle(DAILY_START), saved);
  assert.throws(() => dailyPuzzle('2026-10-24'), RangeError);
  for (const seed of [null, {}, NaN, Infinity, 'x'.repeat(101)]) assert.throws(() => generatePuzzle(seed), RangeError);
  for (const difficulty of [0, 4, 1.5]) assert.throws(() => generatePuzzle('x', difficulty), RangeError);
});
