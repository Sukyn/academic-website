import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard, renderFlow, highlightFlowBits, highlightSignalFocus, pinFlowLabels } from '../../src/lib/quantum-signals/rendering.js';
import { goalState } from '../../src/lib/quantum-signals/engine.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { GOAL_COLOR, GOAL_RADIUS, phasePathColor, phaseColor } from '../../src/lib/quantum-signals/state-visuals.js';

function surface(context) {
  class Node {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } }; }
    get className() { return this.attrs.class ?? ''; }
    set className(value) { this.attrs.class = value; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text ?? ''; }
    set textContent(value) { this.text = value; this.children = []; }
    appendChild(child) { for (const node of child.tag === 'fragment' ? child.children : [child]) { node.parentElement = this; this.children.push(node); } return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    querySelectorAll(selector) {
      const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
      const matches = (node, part) => {
        if (part.endsWith(' tspan')) return node.tag === 'tspan' && matches(node.parentElement, part.slice(0, -6));
        if (part.startsWith('[data-')) return node.dataset[part.slice(6, -1)] !== undefined;
        return node.attrs.class?.split(' ').includes(part.slice(1));
      };
      return walk(this).filter(node => selector.split(',').some(part => matches(node, part.trim())));
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
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), createDocumentFragment: () => new Node('fragment'),
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  const svg = new Node('svg'), target = new Node('svg'); svg.parentElement = { scrollLeft: 72 };
  return { svg, target, board: new Node('div') };
}

test('SVG paths, amplitudes, targets and cancellation walls use binary rows without reindexing state', context => {
  const { svg, target } = surface(context), hadamards = Array.from({ length: 3 }, (_, wire) => ({ gate: 'H', wires: [wire] }));
  const puzzle = { wires: 3, columns: [hadamards, [{ gate: 'CZ', wires: [0, 2] }], hadamards,
    [{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: goalState(3) };
  const original = structuredClone(puzzle), trace = flowTrace(puzzle), y = basis => 44 + basis * 34;
  renderFlow(svg, target, puzzle, {}, 'a');
  assert.deepEqual(puzzle, original);
  assert.equal(target.dataset.match, 'false');
  assert.equal(svg.querySelectorAll('.signal-flow-target').length, 0, 'Targets have a separate fixed surface');
  assert.equal(target.attrs.width, '52');
  assert.equal(target.attrs.height, svg.attrs.height, 'Both surfaces share the same vertical scale');
  assert.deepEqual(svg.querySelectorAll('.signal-flow-label').map(node => node.textContent),
    ['000', '001', '010', '011', '100', '101', '110', '111']);
  assert.deepEqual(svg.querySelectorAll('.signal-flow-lane').map(node => Number(node.dataset.basis)),
    Array.from({ length: 8 }, (_, row) => row));
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
    target: goalState(3) };
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

test('Tutorial focus connects the gate and circuit wires to the same bit positions and signed basis paths', context => {
  const { svg, target, board } = surface(context), puzzle = { wires: 3, columns: [
    [0, 1, 2].map(wire => ({ gate: 'H', wires: [wire] })), [{ gate: 'CZ', wires: [0, 2] }],
    [{ id: 'a', wires: [0], choices: ['I', 'Z'] }]], target: goalState(3) };
  renderBoard(board, puzzle, {}); renderFlow(svg, target, puzzle, {});
  const has = (node, name) => node.attrs.class?.split(' ').includes(name);
  const boardChildren = board.children, flowChildren = svg.children;
  const phases = svg.querySelectorAll('.signal-flow-path').map(node => node.attrs.stroke);
  highlightSignalFocus(board, svg, { wires: [0, 2], bases: [5, 7], column: 1 });
  assert.equal(board.children, boardChildren); assert.equal(svg.children, flowChildren, 'Focus never rebuilds the animated SVG.');
  assert.deepEqual(board.querySelectorAll('.signal-wire-label'), [], 'Circuit wires have no number labels');
  assert.deepEqual(board.querySelectorAll('.signal-path').map(node => has(node, 'signal-wire-focus')), [true, false, true]);
  for (const gate of board.querySelectorAll('[data-column]')) assert.equal(has(gate, 'signal-gate-focus'), gate.dataset.column === '1');
  assert.equal(svg.querySelectorAll('.signal-flow-wire-heading').length, 0, 'Only basis labels appear beside the paths');
  for (const bit of svg.querySelectorAll('.signal-flow-label tspan')) {
    assert.equal(has(bit, 'signal-flow-bit-highlight'), bit.dataset.wire !== '1');
  }
  for (const lane of svg.querySelectorAll('.signal-flow-lane, .signal-flow-label')) assert.equal(has(lane, 'signal-flow-focus'), [5, 7].includes(Number(lane.dataset.basis)));
  const focused = svg.querySelectorAll('.signal-flow-path').filter(node => has(node, 'signal-flow-focus'));
  assert.equal(focused.length, 2);
  assert.ok(focused.every(node => node.dataset.column === '1' && node.attrs.stroke === phasePathColor(-1)));
  assert.deepEqual(svg.querySelectorAll('.signal-flow-path').map(node => node.attrs.stroke), phases, 'Bit focus never changes phase colours.');
  highlightSignalFocus(board, svg);
  assert.ok(!has(svg, 'signal-flow-context'));
  for (const selector of ['.signal-path', '[data-column]']) assert.ok(board.querySelectorAll(selector).every(node => !has(node, 'signal-wire-focus') && !has(node, 'signal-gate-focus')));
  for (const selector of ['.signal-flow-path', '.signal-flow-node', '.signal-flow-lane', '.signal-flow-label']) assert.ok(svg.querySelectorAll(selector).every(node => !has(node, 'signal-flow-focus')));
});

test('Both amplitude signs retain white dot outlines and readable distinct path colours', context => {
  const { svg, target } = surface(context), puzzle = { wires: 1, columns: [[{ gate: 'X', wires: [0] }], [{ gate: 'H', wires: [0] }],
    [{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: goalState(1) };
  renderFlow(svg, target, puzzle, {});
  const luminance = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const sign of [-1, 1]) {
    const paths = svg.querySelectorAll('.signal-flow-path').filter(node => Number(node.dataset.amplitude) * sign > 0);
    assert.ok(paths.length > 0);
    assert.ok(paths.every(node => node.attrs.stroke === phasePathColor(sign)));
    assert.ok((luminance(phasePathColor(sign)) + .05) / (luminance('#1b2822') + .05) > 4.5);
  }
  assert.notEqual(phasePathColor(1), phasePathColor(-1));
  for (const node of svg.querySelectorAll('.signal-flow-node')) {
    assert.equal(node.attrs.fill, phaseColor(Number(node.dataset.amplitude)));
    assert.equal(node.attrs.stroke, '#ffffff');
  }
  const goal = target.querySelector('.signal-flow-target');
  assert.equal(goal.attrs.fill, 'none'); assert.equal(goal.attrs.stroke, GOAL_COLOR); assert.equal(Number(goal.attrs.r), GOAL_RADIUS);
  assert.equal(goal.attrs['aria-label'], 'Collect every path at 1');
});

test('Tutorial gate focus distinguishes holes sharing a column and preserves complete paired gates', context => {
  const { board, svg, target } = surface(context), puzzle = { wires: 2, columns: [
    [{ id: 'a', wires: [0], choices: ['I', 'X'] }, { id: 'b', wires: [1], choices: ['I', 'X'] }],
    [{ id: 'c', wires: [0, 1], choices: ['I', 'XC'] }]], target: goalState(2) };
  renderBoard(board, puzzle, {}); renderFlow(svg, target, puzzle, {});
  const focused = () => board.querySelectorAll('[data-column]').filter(node => node.className.split(' ').includes('signal-gate-focus')).map(node => node.dataset.hole);
  highlightSignalFocus(board, svg, { wires: [0], column: 0 }); assert.deepEqual(focused(), ['a']);
  highlightSignalFocus(board, svg, { wires: [1], column: 0 }); assert.deepEqual(focused(), ['b']);
  for (const wires of [[0], [1], [0, 1]]) {
    highlightSignalFocus(board, svg, { wires, column: 1 }); assert.deepEqual(focused(), ['c']);
  }
});

test('A destination filter isolates the opposite-sign contributions at one H cancellation junction', context => {
  const { svg, target, board } = surface(context), puzzle = { wires: 1, columns: [
    [{ gate: 'X', wires: [0] }], [{ gate: 'H', wires: [0] }], [{ gate: 'H', wires: [0] }],
    [{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: goalState(1) };
  renderBoard(board, puzzle, {}); renderFlow(svg, target, puzzle, {});
  highlightSignalFocus(board, svg, { wires: [0], column: 2, toBases: [0] });
  const focused = selector => svg.querySelectorAll(selector).filter(node => node.attrs.class.split(' ').includes('signal-flow-focus'));
  const paths = focused('.signal-flow-path');
  assert.equal(paths.length, 2);
  assert.ok(paths.every(node => node.dataset.column === '2' && node.dataset.to === '0'));
  assert.deepEqual(paths.map(node => Math.sign(Number(node.dataset.amplitude))).sort(), [-1, 1]);
  assert.deepEqual(paths.map(node => node.attrs.stroke).sort(), [phasePathColor(1), phasePathColor(-1)].sort());
  assert.equal(focused('.signal-flow-node').length, 2, 'Both incoming black/white dots stay visible.');
  assert.equal(focused('.signal-flow-cancellation').length, 1, 'The wall at the selected zero-sum output is highlighted.');
  assert.ok(!svg.querySelectorAll('.signal-flow-path').some(node => node.dataset.column === '3' && node.dataset.from === '0'), 'No path continues after the wall.');
});

test('Applying a global phase or changing relative phases never moves or recolours the goal', context => {
  const { svg, target } = surface(context);
  const puzzle = { wires: 2, columns: [[{ gate: 'X', wires: [0] }, { gate: 'X', wires: [1] }],
    [{ id: 'a', wires: [0], choices: ['I', 'Z'] }], [{ id: 'b', wires: [1], choices: ['I', 'Z'] }]],
    target: goalState(2) };
  const markers = () => target.querySelectorAll('.signal-flow-target').map(node => ({ ...node.attrs }));
  renderFlow(svg, target, puzzle, {});
  const fixed = markers(), nodes = target.querySelectorAll('.signal-flow-target');
  for (const placements of [{ a: 'Z' }, { b: 'Z' }, { a: 'Z', b: 'Z' }, {}]) {
    renderFlow(svg, target, { ...puzzle, target: [...puzzle.target] }, placements);
    assert.equal(target.dataset.match, 'true', 'Both overall signs occupy the fixed goal.');
    assert.deepEqual(markers(), fixed);
    assert.ok(target.querySelectorAll('.signal-flow-target').every((node, index) => node === nodes[index]), 'The fixed goal is not rebuilt for edits or normalized puzzle copies');
  }
  renderFlow(svg, target, { ...puzzle, wires: 3, target: goalState(3) }, {});
  const resized = target.querySelectorAll('.signal-flow-target');
  assert.equal(resized[0].dataset.basis, '7', 'A wire-count change moves the goal to the new all-ones row');
  assert.notEqual(resized[0], nodes[0]);
  assert.equal(target.attrs.height, String(8 * 34 + 62));
});
