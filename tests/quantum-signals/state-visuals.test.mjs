import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_COLORS, GOAL_COLOR, GOAL_RADIUS, phaseColor, phasePathColor } from '../../src/lib/quantum-signals/state-visuals.js';
import { goalState, stateEqual } from '../../src/lib/quantum-signals/engine.js';

test('The fixed all-ones goal accepts either overall sign without recolouring the signal', () => {
  for (let wires = 1; wires <= 4; wires++) {
    const target = goalState(wires), negative = target.map(value => value === 0 ? 0 : -value);
    assert.equal(target.at(-1), 1); assert.equal(target.slice(0, -1).every(value => value === 0), true);
    assert.equal(stateEqual(negative, target), true);
    assert.equal(phaseColor(target.at(-1)), '#000000');
    assert.equal(phaseColor(negative.at(-1)), '#ffffff', 'A valid negative output remains visibly white.');
  }
  assert.equal(GOAL_COLOR, '#f2d572'); assert.equal(GOAL_RADIUS, 9);
});

test('Phase colours retain every relative sign and never mutate or align the state vector', () => {
  const state = Object.freeze([.5, -.5, .5, -.5]), saved = [...state];
  assert.deepEqual(state.map(phaseColor), ['#000000', '#ffffff', '#000000', '#ffffff']);
  assert.deepEqual(state.map(value => phaseColor(-value)), ['#ffffff', '#000000', '#ffffff', '#000000']);
  assert.deepEqual(state.map(phasePathColor), [phasePathColor(1), phasePathColor(-1), phasePathColor(1), phasePathColor(-1)]);
  assert.notEqual(phasePathColor(1), phasePathColor(-1));
  assert.deepEqual(state, saved);
  assert.equal(stateEqual(state, [.5, .5, .5, .5]), false, 'Relative phases remain mathematically distinct.');
});

test('Phase colours are immutable constants for black and white signals', () => {
  assert.equal(Object.isFrozen(PHASE_COLORS), true);
  assert.equal(phaseColor(1e-12), '#000000'); assert.equal(phaseColor(-1e-12), '#ffffff');
});
