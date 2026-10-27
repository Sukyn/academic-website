import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCircuitInstruction, renderGolfInstruction } from '../../src/lib/games/tutorial-gates.js';

function fixture(context) {
  class Node {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.textContent = ''; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    appendChild(child) { this.children.push(child); }
    prepend(child) { this.children.unshift(child); }
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

test('Circuit instructions use accessible pairs or the single-wire endpoints from the rules', context => {
  const node = fixture(context);
  for (const singleWire of [false, true]) {
    renderCircuitInstruction(node, 'Use H–X–H, Z, CNOT and CZ.', { singleWire });
    const gates = node.children.filter(child => child.attrs['data-gate']);
    assert.deepEqual(gates.map(gate => gate.attrs['data-gate']), ['H', 'X', 'H', 'Z', singleWire ? 'XU' : 'CX', singleWire ? 'ZU' : 'CZ']);
    assert.ok(gates.every(gate => gate.textContent === '' && gate.attrs.role === 'img'));
    if (singleWire) {
      for (const gate of gates.slice(4)) {
        assert.equal(gate.children[0].tag, 'svg');
        assert.equal(gate.children[0].children[0].attrs.d, 'M22 22V44');
      }
    } else {
      const pair = gates[4].children[0].children;
      assert.deepEqual(pair.map(glyph => glyph.children[0].tag), ['circle', 'circle']);
      assert.deepEqual(pair.map(glyph => glyph.children.length), [1, 2]);
    }
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

test('NOTC instructions show the lower control rather than the ordinary CNOT direction', context => {
  const node = fixture(context);
  renderCircuitInstruction(node, 'Apply NOTC, then CNOT.');
  const gates = node.children.filter(child => child.attrs['data-gate']);
  assert.deepEqual(gates.map(gate => gate.attrs['data-gate']), ['XC', 'CX']);
  assert.equal(gates[0].attrs['aria-label'], 'CNOT: lower control');
  assert.deepEqual(gates[0].children[0].children.map(glyph => glyph.children.length), [2, 1],
    'The X target is above the Z control');
  assert.deepEqual(gates[1].children[0].children.map(glyph => glyph.children.length), [1, 2],
    'The existing CNOT orientation stays unchanged');
  renderCircuitInstruction(node, 'Apply NOTC.', { singleWire: true });
  const endpoint = node.children.find(child => child.attrs['data-gate']);
  assert.equal(endpoint.attrs['data-gate'], 'XD');
  assert.equal(endpoint.children[0].children[0].attrs.d, 'M22 0V22', 'The connector continues above the lower endpoint');
});
