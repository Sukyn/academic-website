import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMove, seededRandom } from '../../src/lib/circuit-reduction/engine.js';
import { CERTIFIED_PUZZLES, LEVELS } from '../../tools/circuit-reduction/witnesses.js';
import { layoutMoves } from '../../tools/circuit-reduction/layout-moves.js';

function reconstruct(from, target) {
  const original = structuredClone(from), desired = structuredClone(target);
  const moves = layoutMoves(from, target);
  for (const move of moves) assert.ok(['compact-identities', 'insert-column', 'remove-space'].includes(move.rule));
  assert.deepEqual(moves.reduce(applyMove, from), target);
  assert.deepEqual(from, original);
  assert.deepEqual(target, desired);
  return moves;
}

test('Public spacing controls reproduce every campaign and catalogue witness layout', () => {
  for (const puzzle of [...LEVELS, ...CERTIFIED_PUZZLES]) {
    let circuit = puzzle.circuit;
    for (const move of puzzle.solution) {
      if (move.rule === 'arrange') reconstruct(circuit, move.circuit);
      circuit = applyMove(circuit, move);
    }
  }
});

test('Spacing plans preserve a linked successor while shifting only one earlier wire', () => {
  const from = [['H', 'ZU'], ['X', 'ZD']];
  const target = [['H', '.', 'ZU'], ['.', 'X', 'ZD']];
  const moves = reconstruct(from, target);
  assert.equal(moves.reduce((count, move) => count + (move.count ?? 1), 0), 3);
  assert.deepEqual(layoutMoves(target, target), []);
  assert.throws(() => layoutMoves(from, [['H', 'ZU'], ['Z', 'ZD']]), RangeError);
});

test('Spacing plans accept independently padded layouts without local insertion', () => {
  const random = seededRandom('public-spacing-plans');
  for (let sample = 0; sample < 50; sample++) {
    let from = LEVELS[sample % LEVELS.length].circuit, target = from;
    const insert = circuit => applyMove(circuit, {
      rule: 'insert-space', row: Math.floor(random() * circuit.length),
      column: Math.floor(random() * (circuit[0].length + 1)), count: 1 + Math.floor(random() * 5),
    });
    for (let step = 0; step < 5; step++) { from = insert(from); target = insert(target); }
    reconstruct(from, target);
  }
  reconstruct([['.', '.']], [['.', '.', '.', '.']]);
});
