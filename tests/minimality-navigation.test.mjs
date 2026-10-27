import assert from 'node:assert/strict';
import test from 'node:test';
import { moveCircuitFocus } from '../src/lib/minimality/circuit-navigation.js';

test('horizontal arrows follow the same wire through insertion gaps and gates', () => {
  const positions = [
    { key: 'before', column: 0, row: 1 },
    { key: 'gate', column: 1, row: 1 },
    { key: 'after', column: 2, row: 1 },
    { key: 'other-wire', column: 1, row: 0 },
  ];
  assert.deepEqual(moveCircuitFocus(positions, 'before', 'ArrowRight'), { key: 'gate', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, 'gate', 'ArrowRight'), { key: 'after', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, 'after', 'ArrowLeft'), { key: 'gate', row: 1 });
  assert.equal(moveCircuitFocus(positions, 'before', 'ArrowLeft'), null);
  assert.equal(moveCircuitFocus(positions, 'after', 'ArrowRight'), null);
});

test('sparse circuits keep a wire before moving to a closer column on another wire', () => {
  const positions = [
    { key: 'start', column: 0, row: 2 },
    { key: 'diagonal', column: 1, row: 1 },
    { key: 'same-wire', column: 7, row: 2 },
  ];
  assert.deepEqual(moveCircuitFocus(positions, 'start', 'ArrowRight'), { key: 'same-wire', row: 2 });
  assert.deepEqual(moveCircuitFocus(positions.slice(0, 2), 'start', 'ArrowRight'), { key: 'diagonal', row: 1 });
});

test('vertical arrows keep the column and choose the nearest control in that column', () => {
  const positions = [
    { key: 'phase', column: 1, row: 0 },
    { key: 'first-wire', column: 1, row: 1 },
    { key: 'second-wire', column: 1, row: 2 },
    { key: 'next-column', column: 2, row: 1 },
  ];
  assert.deepEqual(moveCircuitFocus(positions, 'phase', 'ArrowDown'), { key: 'first-wire', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, 'first-wire', 'ArrowDown'), { key: 'second-wire', row: 2 });
  assert.deepEqual(moveCircuitFocus(positions, 'second-wire', 'ArrowUp'), { key: 'first-wire', row: 1 });
  assert.equal(moveCircuitFocus(positions, 'phase', 'ArrowUp'), null);
  assert.equal(moveCircuitFocus(positions, 'second-wire', 'ArrowDown'), null);
});

test('entering a multiwire gate preserves the entry wire when leaving it horizontally', () => {
  const positions = [
    { key: 'upper-before', column: 0, row: 0 },
    { key: 'lower-before', column: 0, row: 1 },
    { key: 'two-wire-gate', column: 1, row: 0, rowEnd: 1 },
    { key: 'upper-after', column: 2, row: 0 },
    { key: 'lower-after', column: 2, row: 1 },
  ];
  const entered = moveCircuitFocus(positions, 'lower-before', 'ArrowRight');
  assert.deepEqual(entered, { key: 'two-wire-gate', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, entered.key, 'ArrowRight', entered.row), { key: 'lower-after', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, entered.key, 'ArrowLeft', entered.row), { key: 'lower-before', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, entered.key, 'ArrowRight'), { key: 'upper-after', row: 0 });
});

test('vertical arrows leave the full footprint of a spanning gate', () => {
  const positions = [
    { key: 'above', column: 1, row: 0 },
    { key: 'spanning', column: 1, row: 1, rowEnd: 3 },
    { key: 'beside', column: 2, row: 2 },
    { key: 'below', column: 1, row: 4 },
  ];
  assert.deepEqual(moveCircuitFocus(positions, 'spanning', 'ArrowDown', 2), { key: 'below', row: 4 });
  assert.deepEqual(moveCircuitFocus(positions, 'spanning', 'ArrowUp', 2), { key: 'above', row: 0 });
  assert.deepEqual(moveCircuitFocus(positions, 'above', 'ArrowDown'), { key: 'spanning', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, 'below', 'ArrowUp'), { key: 'spanning', row: 3 });
});

test('Home and End stay on the active wire, including spanning gates', () => {
  const positions = [
    { key: 'other-wire-first', column: 0, row: 0 },
    { key: 'first', column: 1, row: 1 },
    { key: 'middle', column: 3, row: 1 },
    { key: 'last', column: 5, row: 0, rowEnd: 1 },
    { key: 'other-wire-last', column: 7, row: 0 },
  ];
  assert.deepEqual(moveCircuitFocus(positions, 'middle', 'Home'), { key: 'first', row: 1 });
  assert.deepEqual(moveCircuitFocus(positions, 'middle', 'End'), { key: 'last', row: 1 });
  assert.equal(moveCircuitFocus(positions, 'first', 'Home'), null);
  assert.equal(moveCircuitFocus(positions, 'last', 'End', 1), null);
  assert.deepEqual(moveCircuitFocus(positions, 'last', 'End', 0), { key: 'other-wire-last', row: 0 });
});

test('navigation has stable ties, does not mutate positions, and tolerates missing targets', () => {
  const positions = Object.freeze([
    Object.freeze({ key: 'start', column: 0, row: 1 }),
    Object.freeze({ key: 'upper', column: 1, row: 0 }),
    Object.freeze({ key: 'lower', column: 1, row: 2 }),
  ]);
  assert.deepEqual(moveCircuitFocus(positions, 'start', 'ArrowRight'), { key: 'upper', row: 0 });
  assert.equal(moveCircuitFocus(positions, 'missing', 'ArrowRight'), null);
  assert.equal(moveCircuitFocus([], 'missing', 'Home'), null);
  assert.equal(moveCircuitFocus(positions, 'start', 'Enter'), null);
  assert.deepEqual(moveCircuitFocus(positions, 'start', 'End', -100), null);
});
