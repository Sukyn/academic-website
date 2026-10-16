import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCircuitInstruction, renderGolfInstruction } from '../../src/lib/games/tutorial-gates.js';

function fixture(context) {
  class Node {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.textContent = ''; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag),
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  return new Node('p');
}

test('Golf instructions keep their prose and mark standalone H/T tokens for the button colors', context => {
  const node = fixture(context);
  renderGolfInstruction(node, 'Apply H, then T. The height stays fixed.');
  assert.equal(node.children.map(child => child.textContent).join(''), 'Apply H, then T. The height stays fixed.');
  const gates = node.children.filter(child => child.attrs['data-gate']);
  assert.deepEqual(gates.map(gate => gate.attrs), [
    { 'data-gate': 'H', role: 'img', 'aria-label': 'H' }, { 'data-gate': 'T', role: 'img', 'aria-label': 'T' },
  ]);
  assert.ok(gates.every(gate => gate.className === 'tutorial-gate tutorial-letter'));
});

test('Circuit instructions use accessible gate drawings with the actual CNOT direction', context => {
  const node = fixture(context);
  for (const [direction, endpoints] of [['CX', ['circle', 'circle']], ['XC', ['circle', 'circle']]]) {
    renderCircuitInstruction(node, 'Use H–X–H, Z, CNOT and CZ.', direction);
    const gates = node.children.filter(child => child.attrs['data-gate']);
    assert.deepEqual(gates.map(gate => gate.attrs['data-gate']), ['H', 'X', 'H', 'Z', direction, 'CZ']);
    assert.ok(gates.every(gate => gate.textContent === '' && gate.attrs.role === 'img'));
    const pair = gates[4].children[0].children;
    assert.deepEqual(pair.map(glyph => glyph.children[0].tag), endpoints);
    assert.deepEqual(pair.map(glyph => glyph.children.length), direction === 'CX' ? [1, 2] : [2, 1]);
    assert.equal(gates[4].attrs['aria-label'], 'CNOT');
  }
});

test('Instructions replace previous tokens and never interpret prose as HTML', context => {
  const node = fixture(context);
  renderCircuitInstruction(node, 'Use H.');
  renderCircuitInstruction(node, '<img src=x onerror=alert(1)>');
  assert.deepEqual(node.children.map(child => [child.tag, child.textContent]), [['span', '<img src=x onerror=alert(1)>']]);
  renderCircuitInstruction(node, '');
  assert.equal(node.children.filter(child => child.attrs['data-gate']).length, 0);
});
