import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, compactCircuit, isIdentity, isSolved, moveCost, sequenceCost } from '../../src/lib/circuit-reduction/engine.js';
import { TUTORIAL_CIRCUIT, TUTORIAL_STEPS } from '../../src/lib/circuit-reduction/tutorial.js';

test('the tutorial teaches the uncontrolled basis change before its controlled version and solves the paper circuit', () => {
  let circuit = TUTORIAL_CIRCUIT;
  const original = structuredClone(circuit), originalSteps = structuredClone(TUTORIAL_STEPS), sequence = [], spacing = [];
  assert.deepEqual(circuit.map(row => row.slice(0, 4)), [['X', 'X', 'H', 'H'], ['.', '.', '.', '.']]);
  assert.deepEqual(TUTORIAL_STEPS.slice(0, 2).map(step => step.move), [
    { rule: 'cancel-x', row: 0, column: 0 }, { rule: 'cancel-h', row: 0, column: 2 },
  ]);
  assert.equal(TUTORIAL_STEPS[2].move.rule, 'basis-x');
  assert.equal(TUTORIAL_STEPS[4].move.rule, 'basis-up');
  assert.ok(isIdentity(circuit));
  assert.equal(isSolved(circuit), false);
  for (const [index, { text, target, layout, move }] of TUTORIAL_STEPS.entries()) {
    assert.ok(text.length && text.length < 120, 'Instructions remain brief');
    if (layout) {
      const arrange = { rule: 'arrange', row: 0, column: 0, circuit: layout };
      const before = compactCircuit(circuit);
      circuit = applyMove(circuit, arrange); sequence.push(arrange);
      assert.equal(moveCost(arrange), 0);
      assert.deepEqual(compactCircuit(circuit), before, 'Every preparation changes only spacing');
      assert.ok(isIdentity(circuit));
      assert.equal(isSolved(circuit), false, 'Preparing the next rule never completes the tutorial');
      if (index === 4) assert.deepEqual(circuit, original.map(row => row.slice(8)), 'The introductory rules lead into the original paper example');
    }
    const before = circuit;
    circuit = applyMove(circuit, move); sequence.push(move);
    assert.ok(isIdentity(circuit), 'Every action preserves the identity circuit');
    assert.equal(isSolved(circuit), index === TUTORIAL_STEPS.length - 1, 'Only the final rule completes the tutorial');
    if (index < 2) {
      assert.deepEqual(circuit[0].slice(0, 4), index === 0 ? ['.', '.', 'H', 'H'] : ['.', '.', '.', '.']);
      assert.deepEqual(circuit.map(row => row.slice(8)), original.map(row => row.slice(8)), 'The introductory moves leave the harder block intact');
    }
    if (target) {
      spacing.push(move.rule);
      assert.equal(moveCost(move), 0);
      assert.deepEqual(compactCircuit(circuit), compactCircuit(before), 'Only empty slots change');
      if (move.rule === 'insert-column') {
        assert.equal(target, '[data-space="0:5"]');
        assert.equal(circuit[0].length, before[0].length + 1);
        assert.ok(circuit.every(row => row[move.column] === '.'));
      } else {
        assert.equal(target, '#compact-identities');
        assert.deepEqual(circuit, [['X', 'X'], ['.', '.']]);
      }
    }
  }
  assert.deepEqual(spacing, ['insert-column', 'compact-identities']);
  assert.equal(sequenceCost(sequence), 11);
  assert.ok(isSolved(circuit));
  assert.deepEqual(TUTORIAL_CIRCUIT, original, 'The fixed example is never mutated');
  assert.deepEqual(TUTORIAL_STEPS, originalSteps, 'Prepared layouts are never mutated');
});
