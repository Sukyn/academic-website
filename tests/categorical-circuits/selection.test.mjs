import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, getLegalMoves, matchesSelection, selectionCells } from '../../src/lib/categorical-circuits/engine.js';

const op = (gate, wires, controls) => ({ gate, wires, ...(controls?.length ? { controls } : {}) });
const legal = (circuit, selection, profile, rule) => getLegalMoves(circuit, { selection, profile, allowedRules: [rule] });

test('a basis expansion selects its gate alone while existing identity padding is inferred', () => {
  for (const profile of ['prop', 'controlled']) {
    const circuit = { wires: 1, columns: [[], [], [op('X', [0])], [], [op('H', [0])]] };
    const saved = structuredClone(circuit), move = { rule: 'basis-x', column: 1, wires: [0], reverse: true };
    assert.deepEqual(selectionCells(move, { profile }), ['0:2']);
    for (const selection of [['0:2'], ['0:1', '0:2'], ['0:1', '0:2', '0:3']]) {
      assert.deepEqual(legal(circuit, selection, profile, 'basis-x'), [move]);
      assert.equal(matchesSelection(move, selection, { profile, circuit }), true);
    }
    assert.deepEqual(applyMove(circuit, move, { profile }).columns.slice(1, 4),
      [[op('H', [0])], [op('Z', [0])], [op('H', [0])]]);
    assert.equal(legal(circuit, ['0:0', '0:2'], profile, 'basis-x').length, 0, 'An empty cell outside the window is not ignored');
    assert.equal(legal(circuit, ['0:2', '0:4'], profile, 'basis-x').length, 0, 'Another selected gate is not ignored');
    assert.equal(matchesSelection(move, ['0:2', null], { profile, circuit }), false);
    assert.deepEqual(circuit, saved);
  }
});

test('implicit identity selection does not overwrite a neighbour or synthesize missing padding', () => {
  for (const profile of ['prop', 'controlled']) {
    assert.equal(legal({ wires: 1, columns: [[op('H', [0])], [op('X', [0])], []] }, ['0:1'], profile, 'basis-x').length, 0);
    assert.equal(legal({ wires: 1, columns: [[op('X', [0])], [], []] }, ['0:0'], profile, 'basis-x').length, 0);
    const full = { wires: 1, columns: [[op('H', [0])], [op('Z', [0])], [op('H', [0])]] };
    assert.equal(legal(full, ['0:0', '0:2'], profile, 'basis-x').length, 0, 'Every nonempty gate is still required');
  }
});

test('empty-side insertion still requires an explicit complete identity window', () => {
  const circuit = { wires: 1, columns: [[], [], []] };
  for (const profile of ['prop', 'controlled']) {
    assert.equal(legal(circuit, [], profile, 'cancel-h').length, 0);
    assert.equal(legal(circuit, ['0:1'], profile, 'cancel-h').length, 0);
    assert.deepEqual(legal(circuit, ['0:0', '0:1'], profile, 'cancel-h'),
      [{ rule: 'cancel-h', column: 0, wires: [0], reverse: true }]);
  }
});

test('multiwire equations require gate endpoints, while empty positions within their window are optional', () => {
  for (const profile of ['prop', 'controlled']) {
    const circuit = { wires: 2, columns: [[op('SWAP', [0, 1])], [op('H', [0])]] };
    const move = { rule: 'swap-h', column: 0, wires: [0, 1] };
    const required = ['0:0', '1:0', '0:1'];
    assert.deepEqual(selectionCells(move, { profile }), required);
    assert.ok(legal(circuit, required, profile, 'swap-h').some(candidate => !candidate.reverse));
    assert.ok(legal(circuit, [...required, '1:1'], profile, 'swap-h').some(candidate => !candidate.reverse));
    assert.equal(legal(circuit, ['0:0', '0:1'], profile, 'swap-h').length, 0, 'A swap still needs both endpoints');
    const swap = { wires: 2, columns: [[], [op('SWAP', [0, 1])], []] };
    assert.ok(legal(swap, ['0:1', '1:1'], profile, 'swap-cnot').some(candidate => candidate.reverse));
  }
});

test('controlled PROP keeps controls as context while PROP selects complete controlled gates', () => {
  const circuit = { wires: 2, columns: [[], [op('X', [1], [0])], []] };
  const move = { rule: 'controlled-basis', column: 0, wires: [0, 1], reverse: true };
  assert.deepEqual(selectionCells(move), ['1:1']);
  assert.deepEqual(selectionCells(move, { profile: 'prop' }), ['1:1', '0:1']);
  assert.ok(legal(circuit, ['1:1'], 'controlled', 'controlled-basis').length);
  assert.equal(legal(circuit, ['1:1', '0:1'], 'controlled', 'controlled-basis').length, 0);
  assert.equal(legal(circuit, ['1:1'], 'prop', 'controlled-basis').length, 0);
  assert.ok(legal(circuit, ['1:1', '0:1'], 'prop', 'controlled-basis').length);
  assert.ok(legal(circuit, ['1:0', '1:1', '1:2', '0:0', '0:1', '0:2'], 'prop', 'controlled-basis').length);
});
