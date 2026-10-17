import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, getHoles, simulate, stateEqual, validatePlayablePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { TUTORIAL_PUZZLE, TUTORIAL_STEPS } from '../../src/lib/quantum-signals/tutorial.js';

test('the worked tutorial fills the three-qubit circuit and reaches its complete target', () => {
  const puzzle = TUTORIAL_PUZZLE, saved = structuredClone(puzzle), official = structuredClone(LEVELS);
  const actions = TUTORIAL_STEPS.filter(step => step.hole);
  assert.equal(puzzle.wires, 3);
  assert.deepEqual(validatePlayablePuzzle(puzzle), puzzle, 'The tutorial has a fixed prefix followed only by holes');
  assert.deepEqual(actions.map(({ hole, gate }) => [hole, gate]), [['a', 'H'], ['b', 'CX'], ['c', 'CZ'], ['d', 'H'], ['f', 'H'], ['e', 'Z']]);
  assert.equal(actions.length, getHoles(puzzle).length);
  let placements = {};
  assert.equal(stateEqual(simulate(puzzle).state, puzzle.target), false);
  for (const [index, { hole, gate, text }] of actions.entries()) {
    assert.ok(text.length > 0 && text.length < 150);
    placements = applyPlacement(puzzle, placements, { hole, gate });
    const result = simulate(puzzle, placements), complete = index === actions.length - 1;
    assert.equal(result.solved, complete);
    assert.equal(stateEqual(result.state, puzzle.target), complete, 'Earlier prefixes do not already match the target');
  }
  assert.ok(TUTORIAL_STEPS.every(step => step.text.length > 0 && step.text.length < 150));
  assert.equal(TUTORIAL_STEPS.at(-2).target, '.signal-flow-cancellation');
  assert.equal(TUTORIAL_STEPS.at(-1).hole, 'e', 'A final gate demonstrates that canceled paths stop before later gates');
  assert.deepEqual(puzzle, saved);
  assert.deepEqual(LEVELS, official, 'The tutorial never changes official levels');
});

test('the tutorial shows destructive interference before a final gate, with no amplitude beyond its walls', () => {
  const solution = Object.fromEntries(TUTORIAL_STEPS.filter(step => step.hole).map(({ hole, gate }) => [hole, gate]));
  const before = { ...solution }; delete before.f; delete before.e;
  assert.equal(flowTrace(TUTORIAL_PUZZLE, before).snapshots.at(-1).filter(value => Math.abs(value) > 1e-9).length, 8);
  for (const placements of [{ ...before, f: 'H' }, solution]) {
    const { columns, snapshots, cancellations } = flowTrace(TUTORIAL_PUZZLE, placements);
    const recombination = TUTORIAL_PUZZLE.columns.findIndex(column => column.some(entry => entry.id === 'f'));
    assert.ok(recombination < columns.length - 1);
    assert.deepEqual(cancellations[recombination], [2, 3, 4, 5]);
    for (const basis of cancellations[recombination]) {
      const incoming = columns[recombination].filter(edge => edge.to === basis);
      assert.equal(incoming.length, 2);
      assert.ok(incoming.some(edge => edge.amplitude > 0) && incoming.some(edge => edge.amplitude < 0));
      assert.ok(Math.abs(incoming.reduce((sum, edge) => sum + edge.amplitude, 0)) < 1e-9);
      assert.ok(Math.abs(snapshots[recombination + 1][basis]) < 1e-9);
      assert.ok(!columns[recombination + 1].some(edge => edge.from === basis), 'The later gate receives no canceled amplitude');
      assert.ok(Math.abs(snapshots.at(-1)[basis]) < 1e-9);
    }
  }
  assert.equal(simulate(TUTORIAL_PUZZLE, { ...before, f: 'H' }).solved, false, 'The wall explanation precedes completion');
});

test('CZ explains and highlights the actual first two bits, regardless of the third bit', () => {
  const step = TUTORIAL_STEPS.find(step => step.gate === 'CZ');
  const hole = getHoles(TUTORIAL_PUZZLE).find(hole => hole.id === step.hole);
  assert.deepEqual(step.bits, hole.wires);
  assert.deepEqual(step.bits, [0, 1]);
  assert.match(step.text, /first two wires.*first two bits.*11/);
  const before = simulate(TUTORIAL_PUZZLE, { a: 'H', b: 'CX' }).state;
  const after = simulate(TUTORIAL_PUZZLE, { a: 'H', b: 'CX', c: 'CZ' }).state;
  assert.ok(Math.abs(before[6]) > 0 && Math.abs(before[7]) > 0);
  for (let basis = 0; basis < before.length; basis++) {
    assert.ok(Math.abs(after[basis] - before[basis] * (basis >= 6 ? -1 : 1)) < 1e-9);
  }
});
