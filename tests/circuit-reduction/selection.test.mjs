import assert from 'node:assert/strict';
import test from 'node:test';
import { RULES, applyMove, gateCells, getSelectionMoves, compactCircuit, validateCircuit, moveCost } from '../../src/lib/circuit-reduction/engine.js';

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
    assert.deepEqual(getSelectionMoves(circuit, [...expanded, (1 - row) + ':0'], { allowedRules: [rule] }), expected, 'Extra empty context does not prevent a gate rewrite');
    assert.deepEqual(circuit, original);
  }
});

test('every nonempty rule side matches by selecting only its gates, with spaces optional', () => {
  for (const rule of RULES) for (const side of ['left', 'right']) {
    const pattern = rule[side], cells = pattern.map(line => [...line]);
    let row = 0;
    if (pattern.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('U'))) {
      cells.push(pattern[0].map(cell => cell.endsWith('U') ? 'ZD' : '.'));
    } else if (pattern.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('D'))) {
      cells.unshift(pattern[0].map(cell => cell.endsWith('D') ? 'ZU' : '.')); row = 1;
    }
    const gates = pattern.flatMap((line, y) => line.flatMap((symbol, column) => symbol === '.' ? [] : [(row + y) + ':' + column]));
    const fullWindow = windowCells(row, 0, pattern.length, pattern[0].length), move = { rule: rule.id, row, column: 0 };
    assert.deepEqual(getSelectionMoves(cells, gates, { allowedRules: [rule.id] }), gates.length ? [move] : [], `${rule.id} ${side}: gate-only selection`);
    assert.deepEqual(getSelectionMoves(cells, fullWindow, { allowedRules: [rule.id] }), [move], `${rule.id} ${side}: explicit spaces still work`);
  }
});

test('a single X or controlled endpoint can expand without selecting its existing padding', () => {
  for (const [circuit, key, rule, row] of [
    [[['.', 'X', '.']], '0:1', 'basis-x', 0],
    [[['.', 'Z', '.']], '0:1', 'basis-z', 0],
    [[['.', 'XU', '.'], ['.', 'ZD', '.']], '0:1', 'basis-up', 0],
    [[['.', 'ZU', '.'], ['.', 'XD', '.']], '1:1', 'basis-down', 1],
  ]) {
    const saved = structuredClone(circuit), move = { rule, row, column: 0 };
    for (const selection of [[key], [key, row + ':0'], [key, row + ':2']]) {
      assert.deepEqual(getSelectionMoves(circuit, selection, { allowedRules: [rule] }), [move]);
    }
    assert.deepEqual(applyMove(applyMove(circuit, move), move), circuit, 'Replay coordinates and reversible rewrites are unchanged');
    assert.deepEqual(circuit, saved);
  }
});

const prepare = (circuit, { prefix = [] }) => prefix.reduce(applyMove, circuit);

test('missing padding is inserted at boundaries and beside occupied gates without overwriting them', () => {
  for (const [circuit, key] of [
    [[['X', '.']], '0:0'],
    [[['.', 'X']], '0:1'],
    [[['H', 'X', '.']], '0:1'],
    [[['.', 'X', 'Z']], '0:1'],
  ]) {
    const saved = structuredClone(circuit), moves = getSelectionMoves(circuit, [key], { allowedRules: ['basis-x'] });
    assert.equal(moves.length, 1);
    const arranged = prepare(circuit, moves[0]);
    assert.deepEqual(compactCircuit(arranged), compactCircuit(circuit), 'Padding preserves every gate and wire order');
    assert.ok(moves[0].prefix?.length);
    assert.ok(moves[0].prefix.every(move => moveCost(move) === 0));
    validateCircuit(applyMove(arranged, moves[0]));
    assert.deepEqual(circuit, saved);
  }
  const circuit = [['.', 'X', '.', 'H']];
  assert.deepEqual(getSelectionMoves(circuit, ['0:1', '0:3'], { allowedRules: ['basis-x'] }), [], 'Extra selected gates cannot be ignored');
});

test('every nonempty rule side works on a compact circuit without selecting or adding its padding', () => {
  for (const rule of RULES.filter(rule => moveCost({ rule: rule.id }))) for (const pattern of [rule.left, rule.right]) {
    let circuit = pattern.map(line => [...line]), row = 0;
    if (pattern.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('U'))) circuit.push(pattern[0].map(cell => cell.endsWith('U') ? 'ZD' : '.'));
    else if (pattern.length === 1 && [...rule.left[0], ...rule.right[0]].some(cell => cell.endsWith('D'))) {
      circuit.unshift(pattern[0].map(cell => cell.endsWith('D') ? 'ZU' : '.')); row = 1;
    }
    const expected = compactCircuit(applyMove(circuit, { rule: rule.id, row, column: 0 }));
    circuit = compactCircuit(circuit);
    const gates = circuit.flatMap((line, y) => line.flatMap((symbol, x) => symbol === '.' ? [] : [y + ':' + x]));
    if (!gates.length) continue;
    const moves = getSelectionMoves(circuit, gates, { allowedRules: [rule.id] });
    assert.ok(moves.length, rule.id);
    const actual = moves.map(move => compactCircuit(applyMove(prepare(circuit, move), move)));
    assert.ok(actual.some(next => JSON.stringify(next) === JSON.stringify(expected)), rule.id + ': same rewrite modulo space');
  }
});

test('CZ and a single Z commute on either wire while making room for neighbouring gates', () => {
  for (const row of [0, 1]) {
    const circuit = row ? [['.', 'ZU', '.', 'ZU'], ['Z', 'ZD', 'Z', 'ZD']] : [['Z', 'ZU', 'Z', 'ZU'], ['.', 'ZD', '.', 'ZD']];
    const rule = row ? 'phase-down' : 'phase-up';
    const moves = getSelectionMoves(circuit, [row + ':0', row + ':1'], { allowedRules: [rule] });
    assert.equal(moves.length, 1); assert.ok(moves[0].prefix?.length);
    assert.deepEqual(compactCircuit(prepare(circuit, moves[0])), compactCircuit(circuit));
    const next = applyMove(prepare(circuit, moves[0]), moves[0]);
    assert.deepEqual(next[row].filter(cell => cell !== '.'), [row ? 'ZD' : 'ZU', 'Z', 'Z', row ? 'ZD' : 'ZU']);
  }
});

test('identity insertions still require an explicit empty window', () => {
  const circuit = [['.', '.', '.', '.']];
  assert.deepEqual(getSelectionMoves(circuit, []), []);
  assert.deepEqual(getSelectionMoves(circuit, ['0:1'], { allowedRules: ['cancel-h'] }), []);
  assert.deepEqual(getSelectionMoves(circuit, ['0:1', '0:2'], { allowedRules: ['cancel-h'] }), [{ rule: 'cancel-h', row: 0, column: 1 }]);
});

test('inferred padding inspects only local rule windows on an unbounded wire', () => {
  const line = Array(10_000).fill('.'); line[5_000] = 'X';
  const local = new Proxy(line, { get(target, property) {
    if (/^\d+$/.test(String(property))) assert.ok(Number(property) >= 4_998 && Number(property) <= 5_002, 'Only candidate windows next to the selected gate are inspected');
    return Reflect.get(target, property);
  } });
  assert.deepEqual(getSelectionMoves([local], ['0:5000'], { allowedRules: ['basis-x'] }), [{ rule: 'basis-x', row: 0, column: 4_999 }]);
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
