import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitViewport } from '../../src/lib/games/circuit-viewport.js';

function surface(width, maximum, left = 0) {
  let position = 0;
  const listeners = new Map();
  return {
    clientWidth: width, clientLeft: 2, scrollWidth: width + maximum,
    get scrollLeft() { return position; },
    set scrollLeft(value) { position = Math.max(0, Math.min(maximum, value)); },
    addEventListener(type, action, options) { listeners.set(type, action); assert.equal(options.passive, true); },
    getBoundingClientRect() { return { left }; },
    emit() { listeners.get('scroll')(); },
  };
}

test('circuit viewports synchronize scrolling in either direction and use native bounds', () => {
  const circuit = surface(320, 600), flow = surface(268, 580), pinned = [];
  createCircuitViewport(circuit, flow, left => pinned.push(left));
  circuit.scrollLeft = 600; circuit.emit();
  assert.equal(flow.scrollLeft, 580); assert.equal(circuit.scrollLeft, 580);
  flow.scrollLeft = 120; flow.emit();
  assert.equal(circuit.scrollLeft, 120);
  circuit.emit();
  assert.deepEqual(pinned, [580, 120, 120]);
});

test('following a gate reserves space for pinned labels and follows completion to the output', () => {
  const circuit = surface(350, 600, 20), flow = surface(298, 580);
  const viewport = createCircuitViewport(circuit, flow, () => {});
  viewport.follow({ getBoundingClientRect: () => ({ left: 300, width: 88 }) });
  assert.equal(circuit.scrollLeft, 153); assert.equal(flow.scrollLeft, 153);
  viewport.follow(null, true);
  assert.equal(circuit.scrollLeft, 580); assert.equal(flow.scrollLeft, 580);
  viewport.follow(null);
  assert.equal(circuit.scrollLeft, 0); assert.equal(flow.scrollLeft, 0);
});
