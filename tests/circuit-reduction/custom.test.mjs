import test from 'node:test';
import assert from 'node:assert/strict';
import { customCircuit, identityCircuit } from '../../src/lib/circuit-reduction/custom.js';
import { applyMove, isIdentity, isSolved } from '../../src/lib/circuit-reduction/engine.js';

test('identity editor starts with independent six-slot wires and accepts legal constructions', () => {
  for (let wires = 1; wires <= 4; wires++) {
    const initial = identityCircuit(wires);
    assert.ok(isSolved(initial)); assert.ok(isIdentity(initial));
    assert.equal(initial.length, wires); assert.ok(initial.every(row => row.length === 6));
    const circuit = applyMove(initial, { rule: 'cancel-h', row: wires - 1, column: 1 });
    const result = customCircuit({ circuit, optimalMoves: 999 });
    assert.deepEqual(result, circuit); assert.ok(isIdentity(result)); assert.ok(isSolved(initial));
    result[0][0] = 'X'; assert.equal(circuit[0][0], '.');
  }
});

test('custom imports reject malformed, empty and nonidentity circuits', () => {
  for (const value of [null, [], 'H H', {}, { circuit: identityCircuit() }, { circuit: [['X', '.']] },
    { circuit: [['ZU', '.']] }, { circuit: [['H', 'H'], ['.']] }]) assert.throws(() => customCircuit(value), RangeError);
  for (const wires of [0, 5, 1.5, NaN, Infinity, '2']) assert.throws(() => identityCircuit(wires), RangeError);
});
