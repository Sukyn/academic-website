import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFlow, highlightFlowBits, pinFlowLabels } from '../../src/lib/quantum-signals/rendering.js';
import { simulate } from '../../src/lib/quantum-signals/engine.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { basisRow, grayBasis } from '../../src/lib/quantum-signals/state-visuals.js';

function surface(context) {
  class Node {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.dataset = {}; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text ?? ''; }
    set textContent(value) { this.text = value; this.children = []; }
    appendChild(child) { this.children.push(...(child.tag === 'fragment' ? child.children : [child])); return child; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    querySelectorAll(selector) {
      const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
      if (selector === '.signal-flow-label tspan') return walk(this).filter(node => node.attrs.class === 'signal-flow-label').flatMap(node => node.children);
      return walk(this).filter(node => node.attrs.class?.split(' ').includes(selector.slice(1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    get classList() { return { toggle: (name, enabled) => {
      const classes = new Set(this.attrs.class?.split(' ').filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.attrs.class = [...classes].join(' ');
    } }; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElementNS: (_, tag) => new Node(tag), createDocumentFragment: () => new Node('fragment'),
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  const svg = new Node('svg'), target = new Node('svg'); svg.parentElement = { scrollLeft: 72 };
  return { svg, target };
}

test('SVG paths, amplitudes, targets and cancellation walls use Gray rows without reindexing state', context => {
  const { svg, target } = surface(context), hadamards = Array.from({ length: 3 }, (_, wire) => ({ gate: 'H', wires: [wire] }));
  const puzzle = { wires: 3, columns: [hadamards, [{ gate: 'CZ', wires: [0, 2] }], hadamards,
    [{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: [1, ...Array(7).fill(0)] };
  puzzle.target = simulate(puzzle, {}).state;
  const original = structuredClone(puzzle), trace = flowTrace(puzzle), y = basis => 44 + basisRow(basis) * 34;
  renderFlow(svg, target, puzzle, {}, 'a');
  assert.deepEqual(puzzle, original);
  assert.equal(target.dataset.match, 'true');
  assert.equal(svg.querySelectorAll('.signal-flow-target').length, 0, 'Targets have a separate fixed surface');
  assert.equal(target.attrs.width, '52');
  assert.equal(target.attrs.height, svg.attrs.height, 'Both surfaces share the same vertical scale');
  assert.deepEqual(svg.querySelectorAll('.signal-flow-label').map(node => node.textContent),
    ['000', '001', '011', '010', '110', '111', '101', '100']);
  assert.deepEqual(svg.querySelectorAll('.signal-flow-lane').map(node => Number(node.dataset.basis)),
    Array.from({ length: 8 }, (_, row) => grayBasis(row)));
  const paths = svg.querySelectorAll('.signal-flow-path');
  assert.equal(paths.length, trace.columns.flat().length);
  for (const path of paths) {
    const column = Number(path.dataset.column), from = Number(path.dataset.from), to = Number(path.dataset.to);
    assert.equal(path.attrs.d, `M${48 + column * 88},${y(from)} C${92 + column * 88},${y(from)} ${92 + column * 88},${y(to)} ${136 + column * 88},${y(to)}`);
  }
  for (const node of [...svg.querySelectorAll('.signal-flow-node'), ...target.querySelectorAll('.signal-flow-target')]) {
    assert.equal(Number(node.attrs.cy), y(Number(node.dataset.basis)));
    assert.equal(node.attrs.role, 'img');
    assert.ok(node.attrs['aria-label'].includes(Number(node.dataset.basis).toString(2).padStart(3, '0')));
  }
  const walls = svg.querySelectorAll('.signal-flow-cancellation');
  assert.ok(walls.length > 0);
  for (const wall of walls) assert.ok(wall.attrs.d.startsWith(`M${48 + Number(wall.dataset.boundary) * 88 - 3},${y(Number(wall.dataset.basis)) - 7}`));
  assert.equal(svg.querySelector('.signal-flow-gutter').attrs.transform, 'translate(72,0)');
  pinFlowLabels(svg, 144);
  assert.equal(svg.querySelector('.signal-flow-gutter').attrs.transform, 'translate(144,0)');
});

test('Tutorial highlights the declared wire bits while keeping complete basis labels unchanged', context => {
  const { svg, target } = surface(context), puzzle = { wires: 3, columns: [[{ id: 'a', wires: [0, 2], choices: ['I', 'CZ'] }]],
    target: [1, ...Array(7).fill(0)] };
  renderFlow(svg, target, puzzle, {});
  const labels = svg.querySelectorAll('.signal-flow-label'), before = labels.map(label => label.textContent);
  highlightFlowBits(svg, [0, 2]);
  labels.forEach(label => label.children.forEach((bit, wire) => {
    assert.equal(Number(bit.dataset.wire), wire);
    assert.equal(bit.dataset.bit, label.textContent[wire]);
    assert.equal(bit.attrs.class.includes('signal-flow-bit-highlight'), wire !== 1);
  }));
  assert.deepEqual(labels.map(label => label.textContent), before);
  highlightFlowBits(svg);
  assert.ok(labels.every(label => label.children.every(bit => !bit.attrs.class.includes('signal-flow-bit-highlight'))));
});
