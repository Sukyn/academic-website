import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTarget } from '../../src/lib/quantum-signals/state-visuals.js';
import { stateEqual } from '../../src/lib/quantum-signals/engine.js';

test('Goal markers align equivalent states while preserving the output trace phase', () => {
  const target = [Math.SQRT1_2, 0, 0, -Math.SQRT1_2];
  const positive = [...target], negative = target.map(value => value === 0 ? 0 : -value);
  assert.deepEqual(alignTarget(target, positive), positive);
  assert.deepEqual(alignTarget(target, negative), negative);
  assert.deepEqual(alignTarget(negative, positive), positive);
  assert.ok(stateEqual(alignTarget(target, negative), target));
});

test('Alignment preserves probabilities, normalization and every relative phase', () => {
  const target = [.5, -.5, .5, -.5], output = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const aligned = alignTarget(target, output);
  assert.deepEqual(aligned, [-.5, .5, -.5, .5]);
  assert.deepEqual(aligned.map(value => value ** 2), target.map(value => value ** 2));
  assert.equal(aligned.reduce((norm, value) => norm + value ** 2, 0), 1);
  for (let index = 1; index < target.length; index++) {
    assert.equal(aligned[index] * aligned[0], target[index] * target[0]);
  }
  assert.equal(stateEqual(aligned, output), false, 'Different relative phase cannot be aligned into a win.');
});

test('Alignment uses the first shared populated outcome, even when the first target outcome is absent', () => {
  const target = [-Math.SQRT1_2, Math.SQRT1_2, 0, 0], output = [0, -1, 0, 0];
  assert.deepEqual(alignTarget(target, output), [Math.SQRT1_2, -Math.SQRT1_2, 0, 0]);
  const tiny = [1e-12, -1], opposite = [-1, 1e-12];
  assert.deepEqual(alignTarget(tiny, opposite), [-1e-12, 1], 'Numerical dust does not choose the reference.');
});

test('Disjoint support uses a positive first target outcome and never changes either input', () => {
  const target = Object.freeze([0, -Math.SQRT1_2, Math.SQRT1_2, 0]);
  const output = Object.freeze([1, 0, 0, 0]);
  const aligned = alignTarget(target, output);
  assert.deepEqual(aligned, [0, Math.SQRT1_2, -Math.SQRT1_2, 0]);
  assert.notEqual(aligned, target);
  aligned[0] = 42;
  assert.deepEqual(target, [0, -Math.SQRT1_2, Math.SQRT1_2, 0]);
  assert.deepEqual(output, [1, 0, 0, 0]);
  assert.notEqual(alignTarget(output, output), output, 'Already aligned states are still copied.');
});
