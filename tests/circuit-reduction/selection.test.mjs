import assert from 'node:assert/strict';
import test from 'node:test';
import { gateCells, getSelectionMoves } from '../../src/lib/circuit-reduction/engine.js';

const windowCells = (row, column, height, width) => Array.from({ length: height }, (_, y) =>
  Array.from({ length: width }, (_, x) => (row + y) + ':' + (column + x))).flat();

test('linked gate selection includes both endpoints from either side without including other gates', () => {
  const circuit = [['ZU', 'XU', 'H', '.'], ['XD', 'ZD', '.', 'Z']];
  assert.deepEqual(gateCells(circuit, '0:0'), ['0:0', '1:0']);
  assert.deepEqual(gateCells(circuit, '1:0'), ['1:0', '0:0']);
  assert.deepEqual(gateCells(circuit, '0:1'), ['0:1', '1:1']);
  assert.deepEqual(gateCells(circuit, '1:1'), ['1:1', '0:1']);
  assert.deepEqual(gateCells(circuit, '0:2'), ['0:2']);
  assert.deepEqual(gateCells(circuit, '0:3'), ['0:3']);
  for (const key of [null, '', '0', '-1:0', '0:4', '2:0', '0:1.5']) assert.throws(() => gateCells(circuit, key), /inside/);
});

test('whole CNOT and CZ cancellation matches after selecting either row of endpoints', () => {
  for (const [circuit, rule] of [
    [[['ZU', 'ZU'], ['XD', 'XD']], 'cancel-cnot-down'],
    [[['XU', 'XU'], ['ZD', 'ZD']], 'cancel-cnot-up'],
    [[['ZU', 'ZU'], ['ZD', 'ZD']], 'cancel-cz'],
  ]) for (const row of [0, 1]) {
    const expected = [{ rule, row: 0, column: 0 }];
    assert.deepEqual(getSelectionMoves(circuit, windowCells(row, 0, 1, 2), { allowedRules: [rule] }), expected);
    assert.deepEqual(getSelectionMoves(circuit, new Set(windowCells(0, 0, 2, 2)), { allowedRules: [rule] }), expected);
    assert.deepEqual(getSelectionMoves(circuit, [row + ':0'], { allowedRules: [rule] }), []);
  }
});

test('partial controlled rules preserve their one-wire windows with selected linked context', () => {
  for (const [circuit, rule, row] of [
    [[['H', 'ZU', 'H'], ['.', 'ZD', '.']], 'basis-up', 0],
    [[['.', 'ZU', '.'], ['H', 'ZD', 'H']], 'basis-down', 1],
    [[['Z', 'ZU', '.'], ['.', 'ZD', '.']], 'phase-up', 0],
    [[['.', 'ZU', '.'], ['Z', 'ZD', '.']], 'phase-down', 1],
    [[['.', 'XU', '.'], ['.', 'ZD', '.']], 'basis-up', 0],
  ]) {
    const original = structuredClone(circuit), cells = windowCells(row, 0, 1, 3);
    const expanded = new Set([...cells, (1 - row) + ':1']);
    const expected = [{ rule, row, column: 0 }];
    assert.deepEqual(getSelectionMoves(circuit, cells, { allowedRules: [rule] }), expected);
    assert.deepEqual(getSelectionMoves(circuit, expanded, { allowedRules: [rule] }), expected);
    assert.deepEqual(getSelectionMoves(circuit, [...expanded, (1 - row) + ':0'], { allowedRules: [rule] }), []);
    assert.deepEqual(circuit, original);
  }
});

test('selection matching leaves unrelated context alone and respects rule unlocks and column offsets', () => {
  const circuit = [['.', 'H', 'ZU', 'H', '.'], ['.', 'X', 'ZD', 'X', '.'], ['.', '.', 'Z', '.', '.']];
  const selection = ['0:1', '0:2', '1:2', '0:3'];
  assert.deepEqual(getSelectionMoves(circuit, selection, { allowedRules: ['basis-up'] }), [{ rule: 'basis-up', row: 0, column: 1 }]);
  assert.deepEqual(getSelectionMoves(circuit, selection, { allowedRules: ['basis-down'] }), []);
  assert.deepEqual(getSelectionMoves(circuit, [...selection, '2:2']), []);
  assert.deepEqual(getSelectionMoves(circuit, []), []);
  for (const selection of [null, {}, '0:0', ['0:99'], ['0:1', null]]) {
    assert.throws(() => getSelectionMoves(circuit, selection), /inside/);
  }
});
