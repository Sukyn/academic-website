import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, circuitKey, compactCircuit, getLegalMoves, getRewriteMoves,
  insertWireSpace, removeWireSpace, isIdentity, isSolved, moveCost, PAPER_RULE_IDS,
  sequenceCost, solveShortest, validateCircuit,
} from '../../src/lib/circuit-reduction/engine.js';

test('Wire space is free, unbounded, and propagates through linked gate dependencies', () => {
  const original = [
    ['H', '.', 'ZU', '.', '.', '.'],
    ['.', 'X', 'ZD', 'ZU', '.', '.'],
    ['H', '.', '.', 'ZD', 'X', '.'],
  ];
  const saved = structuredClone(original);
  const spaced = insertWireSpace(original, 0, 1, 30);
  validateCircuit(spaced);
  assert.equal(spaced[0].length, 36);
  assert.equal(spaced[0][32], 'ZU');
  assert.equal(spaced[1][32], 'ZD');
  assert.equal(spaced[1][33], 'ZU');
  assert.equal(spaced[2][33], 'ZD');
  assert.equal(spaced[2][34], 'X');
  assert.equal(spaced[1][1], 'X', 'an independent earlier gate stays put');
  assert.deepEqual(compactCircuit(spaced), compactCircuit(original));
  assert.deepEqual(original, saved);
  assert.equal(moveCost({ rule: 'insert-space' }), 0);
  assert.throws(() => insertWireSpace(original, 3, 0), RangeError);
  assert.throws(() => insertWireSpace(original, 0, 0, 1.5), RangeError);
});

test('Remove all identities compacts each wire while retaining shared endpoints and gate order', () => {
  const original = [['.', 'H', '.', '.', 'ZU', '.', 'H'], ['X', '.', 'X', '.', 'ZD', '.', '.']];
  const compact = compactCircuit(original);
  assert.deepEqual(compact, [['H', '.', 'ZU', 'H'], ['X', 'X', 'ZD', '.']]);
  assert.deepEqual(compactCircuit(compact), compact);
  assert.deepEqual(applyMove(original, { rule: 'compact-identities', row: 0, column: 0 }), compact);
  assert.deepEqual(compactCircuit([Array(50).fill('.'), Array(50).fill('.')]), [['.', '.'], ['.', '.']]);
  const long = Array(150_000).fill('X');
  assert.deepEqual(compactCircuit([long]), [long], 'Unbounded layouts do not pass every gate as a function argument');
});

test('Removing one wire identity closes its gap without shifting independent wires', () => {
  const original = [['H', '.', 'X', 'Z'], ['.', 'H', '.', 'X']];
  const saved = structuredClone(original);
  const removed = removeWireSpace(original, 0, 1);
  assert.deepEqual(removed, [['H', 'X', 'Z', '.'], ['.', 'H', '.', 'X']]);
  assert.deepEqual(compactCircuit(removed), compactCircuit(original));
  assert.deepEqual(original, saved);
  assert.deepEqual(applyMove(original, { rule: 'remove-space', row: 0, column: 1 }), removed);
  assert.equal(moveCost({ rule: 'remove-space' }), 0);
  assert.equal(sequenceCost([{ rule: 'remove-space', row: 0, column: 1 }, { rule: 'cancel-h', row: 0, column: 0 }]), 1);
});

test('Removing an identity pulls linked predecessor chains left without changing gate order', () => {
  const original = [
    ['.', '.', '.', '.', 'ZU', 'H'],
    ['.', '.', 'ZU', 'X', 'ZD', '.'],
    ['.', 'H', 'ZD', '.', '.', 'X'],
  ];
  const removed = removeWireSpace(original, 0, 3);
  assert.deepEqual(removed, [
    ['.', '.', '.', 'ZU', 'H', '.'],
    ['.', 'ZU', 'X', 'ZD', '.', '.'],
    ['H', 'ZD', '.', '.', '.', 'X'],
  ]);
  validateCircuit(removed);
  assert.deepEqual(compactCircuit(removed), compactCircuit(original));
  assert.equal(removed[2][5], 'X', 'an independent successor remains where it was');
});

test('Right-click spacing removal rejects gates, invalid slots, and indispensable alignment identities', () => {
  const blocked = [['.', 'ZU', 'H'], ['H', 'ZD', '.']];
  const saved = structuredClone(blocked);
  assert.throws(() => removeWireSpace(blocked, 0, 0), /needed for alignment/);
  assert.deepEqual(blocked, saved);
  assert.throws(() => removeWireSpace(blocked, 0, 1), /empty slot/);
  assert.throws(() => removeWireSpace(blocked, -1, 0), /empty slot/);
  assert.throws(() => removeWireSpace(blocked, 2, 0), /empty slot/);
  assert.throws(() => removeWireSpace(blocked, 0, 3), /empty slot/);
  assert.throws(() => removeWireSpace(blocked, 0, 0.5), /empty slot/);
  assert.throws(() => removeWireSpace([['H', '.', '.'], ['.', '.', 'X']], 0, 1), /needed for alignment/);
});

test('Removing trailing identities trims one shared column and retains the minimum board width', () => {
  const circuit = [['H', '.', '.', '.'], ['.', 'X', '.', '.']];
  const trimmed = removeWireSpace(circuit, 0, 3);
  assert.deepEqual(trimmed, [['H', '.', '.'], ['.', 'X', '.']]);
  assert.deepEqual(removeWireSpace(trimmed, 0, 2), [['H', '.'], ['.', 'X']]);
  assert.throws(() => removeWireSpace([['H', '.'], ['.', 'X']], 0, 1), /needed for alignment/);
  assert.deepEqual(removeWireSpace([['.', 'H'], ['.', 'X']], 0, 0), [['H', '.'], ['.', 'X']]);
});

test('Insertion followed by removal retains quantum identity and the original dependency graph', () => {
  const original = [['H', 'H', 'ZU', 'ZU'], ['X', 'X', 'ZD', 'ZD']];
  const spaced = insertWireSpace(original, 0, 2, 30);
  const removed = removeWireSpace(spaced, 0, 2);
  assert.equal(removed[0][31], 'ZU');
  assert.equal(removed[1][31], 'ZD');
  assert.equal(removed[0].length, spaced[0].length - 1);
  assert.ok(isIdentity(removed));
  assert.deepEqual(compactCircuit(removed), compactCircuit(original));
});

test('Free arrangement accepts only the same circuit dependency graph', () => {
  const original = [['H', '.', 'ZU'], ['.', 'X', 'ZD']];
  const rearranged = [['H', '.', '.', 'ZU'], ['X', '.', '.', 'ZD']];
  assert.deepEqual(applyMove(original, { rule: 'arrange', row: 0, column: 0, circuit: rearranged }), rearranged);
  for (const circuit of [
    [['H', '.', 'ZU'], ['X', 'X', 'ZD']],
    [['ZU', 'H', '.'], ['ZD', 'X', '.']],
    [['H', '.', 'XU'], ['.', 'X', 'ZD']],
  ]) assert.throws(() => applyMove(original, { rule: 'arrange', row: 0, column: 0, circuit }), RangeError);
});

test('Logical rewrites align independent wire identities and retain quantum identity', () => {
  const circuit = [['H', '.', 'H', '.', 'ZU', '.', 'ZU'], ['.', 'X', '.', 'X', 'ZD', '.', 'ZD']];
  assert.ok(isIdentity(circuit));
  const rewrites = getRewriteMoves(circuit);
  assert.ok(rewrites.some(({ move }) => move.rule === 'cancel-h'));
  assert.ok(rewrites.some(({ move }) => move.rule === 'cancel-cz'));
  for (const { move, next, prefix } of rewrites) {
    let replay = circuit;
    for (const action of [...prefix, move]) replay = applyMove(replay, action);
    assert.deepEqual(replay, next);
    validateCircuit(next);
    assert.ok(isIdentity(next), `logical ${move.rule}`);
    assert.equal(sequenceCost([...prefix, move]), 1);
  }
});

test('Shortest solutions count rewrites and ignore every identity layout action', () => {
  const circuit = [['H', '.', 'H', '.', '.', '.'], ['.', '.', '.', 'X', '.', 'X']];
  const result = solveShortest(circuit, { maxDepth: 2, allowedRules: ['cancel-h', 'cancel-x'] });
  assert.equal(result.status, 'optimal');
  assert.equal(result.optimalMoves, 2);
  assert.equal(sequenceCost(result.solution), 2);
  assert.ok(result.solution.some(move => move.rule === 'arrange'));
  let current = circuit;
  for (const action of result.solution) current = applyMove(current, action);
  assert.ok(isSolved(current));
  const prefixed = [{ rule: 'insert-space', row: 0, column: 1, count: 100 }, { rule: 'compact-identities', row: 0, column: 0 }];
  assert.equal(sequenceCost(prefixed), 0);
  assert.equal(moveCost({ rule: 'slide-h' }), 0);
  assert.equal(moveCost({ rule: 'cancel-h' }), 1);
});

test('Tutorial rule restrictions apply to aligned and logical rewrites', () => {
  const circuit = [['Z', 'Z']];
  assert.ok(getLegalMoves(circuit).some(move => move.rule === 'cancel-z'));
  assert.ok(!getLegalMoves(circuit, { allowedRules: PAPER_RULE_IDS }).some(move => move.rule === 'cancel-z'));
  assert.ok(!getRewriteMoves(circuit, { allowedRules: PAPER_RULE_IDS }).some(({ move }) => move.rule === 'cancel-z'));
  const derived = solveShortest(circuit, { maxDepth: 7, allowedRules: PAPER_RULE_IDS });
  assert.equal(derived.status, 'optimal');
  assert.equal(derived.optimalMoves, 7);
  assert.equal(solveShortest(circuit, { maxDepth: 1 }).optimalMoves, 1);
  assert.equal(circuitKey(compactCircuit(circuit)), 'Z,Z');
});
