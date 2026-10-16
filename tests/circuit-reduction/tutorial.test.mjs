import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, compactCircuit, isIdentity, isSolved, moveCost, sequenceCost } from '../../src/lib/circuit-reduction/engine.js';
import { TUTORIAL_CIRCUIT, TUTORIAL_STEPS } from '../../src/lib/circuit-reduction/tutorial.js';

test('the worked tutorial teaches free insertion and Tidy within its seven-rewrite solution', () => {
  let circuit = TUTORIAL_CIRCUIT;
  const original = structuredClone(circuit), sequence = [], spacing = [];
  for (const { text, target, layout, move } of TUTORIAL_STEPS) {
    assert.ok(text.length && text.length < 120, 'Instructions remain brief');
    if (layout) {
      const arrange = { rule: 'arrange', row: 0, column: 0, circuit: layout };
      circuit = applyMove(circuit, arrange); sequence.push(arrange);
    }
    const before = circuit;
    circuit = applyMove(circuit, move); sequence.push(move);
    assert.ok(isIdentity(circuit), 'Every action preserves the identity circuit');
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
  assert.equal(sequenceCost(sequence), 7);
  assert.ok(isSolved(circuit));
  assert.deepEqual(TUTORIAL_CIRCUIT, original, 'The fixed example is never mutated');
});
