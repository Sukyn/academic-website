import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateMemo, gateMemoChoices, gateMemoMap } from '../../src/lib/quantum-signals/gate-memo.js';
import { applyGate } from '../../src/lib/quantum-signals/engine.js';
import { applyOperation, holeOperation } from '../../src/lib/categorical-circuits/engine.js';

const token = (bits, flipsColour = false) => ({ bits, flipsColour });

test('H swaps colour only on its 1-to-1 branch', () => {
  const map = gateMemoMap({ wires: [3], choices: ['I', 'H'] }, 'H');
  assert.deepEqual(map.wires, [3]);
  assert.deepEqual(map.rows, [
    { input: '0', outputs: [token('0'), token('1')] },
    { input: '1', outputs: [token('0'), token('1', true)] },
  ]);
});

test('X, Z and both CNOT directions use top-to-bottom local bits, including reversed wire declarations', () => {
  const rows = (gate, wires) => gateMemoMap({ wires, choices: ['I', gate] }, gate).rows.map(row => row.outputs);
  assert.deepEqual(rows('X', [2]), [[token('1')], [token('0')]]);
  assert.deepEqual(rows('Z', [2]), [[token('0')], [token('1', true)]]);
  assert.deepEqual(rows('CX', [0, 2]), [[token('00')], [token('01')], [token('11')], [token('10')]]);
  assert.deepEqual(rows('CX', [2, 0]), [[token('00')], [token('11')], [token('10')], [token('01')]]);
  assert.deepEqual(rows('XC', [2, 0]), rows('CX', [0, 2]));
  assert.deepEqual(rows('CZ', [2, 0]), [[token('00')], [token('01')], [token('10')], [token('11', true)]]);
});

function checkAgainstFullCircuit(hole, choice, adapter = {}) {
  const operation = adapter.operation ?? ((entry, gate) => ({ gate, wires: entry.wires }));
  const evolve = adapter.apply ?? ((state, op, wires) => applyGate(state, op.gate, op.wires, wires));
  const map = gateMemoMap(hole, choice, adapter), op = operation(hole, choice);
  for (const row of map.rows) for (const [phase, name] of [[1, 'positive'], [-1, 'negative']]) {
    let input = 15;
    [...row.input].forEach((bit, index) => {
      const mask = 1 << (3 - map.wires[index]); input = bit === '1' ? input | mask : input & ~mask;
    });
    const state = Array(16).fill(0); state[input] = phase;
    if (op) evolve(state, op, 4);
    const expected = state.flatMap((value, basis) => Math.abs(value) < 1e-9 ? [] : [{ bits: map.wires.map(wire => basis >> (3 - wire) & 1).join(''), phase: Math.sign(value) }]);
    const annotated = row.outputs.map(output => ({ bits: output.bits, phase: phase * (output.flipsColour ? -1 : 1) }));
    assert.deepEqual(annotated, expected, `${choice}, ${row.input}, ${name}: one annotation works for either incoming colour`);
  }
}

test('Local maps match full four-wire simulation while ignoring every spectator wire', () => {
  for (const gate of ['I', 'H', 'X', 'Z']) for (const wire of [0, 3]) checkAgainstFullCircuit({ wires: [wire], choices: ['I', 'H', 'X', 'Z'] }, gate);
  for (const gate of ['CX', 'XC', 'CZ']) for (const wires of [[0, 3], [3, 0]]) checkAgainstFullCircuit({ wires, choices: ['I', 'CX', 'XC', 'CZ'] }, gate);
  const adapter = { operation: holeOperation, apply: applyOperation };
  for (const gate of ['I', 'H', 'X', 'Z']) checkAgainstFullCircuit({ wires: [3], controls: [0, 2], choices: ['I', 'H', 'X', 'Z'] }, gate, adapter);
  for (const gate of ['I', 'SWAP']) checkAgainstFullCircuit({ wires: [1, 2], controls: [0], choices: ['I', 'SWAP'] }, gate, adapter);
  for (const gate of ['CX', 'XC', 'CZ']) checkAgainstFullCircuit({ wires: [3, 0], choices: ['I', 'CX', 'XC', 'CZ'] }, gate, adapter);
});

test('Memo inputs are bounded and invalid simulator output is rejected', () => {
  assert.throws(() => gateMemoMap({ wires: [0], choices: ['I', 'H'] }, 'Z'), RangeError);
  assert.throws(() => gateMemoMap({ wires: [4], choices: ['I', 'H'] }, 'H'), RangeError);
  assert.throws(() => gateMemoMap({ wires: [0], choices: ['H'] }, 'H', { apply: state => { state[0] = NaN; } }), RangeError);
});

function dom(context) {
  const previous = globalThis.document;
  context.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.handlers = {}; this.open = false; }
    append(...nodes) { this.children.push(...nodes); nodes.forEach(node => { node.parent = this; }); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.children.length ? this.children.map(node => node.textContent).join('') : this.text ?? ''; }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    closest(selector) { return selector === '[data-memo-choice]' && this.dataset.memoChoice !== undefined ||
      selector === '[data-memo-input]' && this.dataset.memoInput !== undefined ? this : this.parent?.closest(selector); }
    querySelector(selector) { return this.children.find(node => selector === `[data-memo-input="${node.dataset.memoInput}"]`) ??
      this.children.map(node => node.querySelector(selector)).find(Boolean); }
    focus() { this.focused = true; document.activeElement = this; }
  }
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  const nodes = new Map(['signal-memo', 'signal-memo-tabs', 'signal-memo-body', 'signal-memo-map', 'signal-memo-caption', 'signal-memo-key'].map(id => [id, new Node('div')]));
  return { get: id => nodes.get(id), icon: () => new Node('svg') };
}

test('Visual memo tabs retain context across network updates and support keyboard navigation', context => {
  const { get, icon } = dom(context); let evolved = 0;
  const memo = createGateMemo({ get, icon, apply(state, op, wires) { evolved++; applyGate(state, op.gate, op.wires, wires); } });
  const hole = { id: 'first', wires: [2], choices: ['I', 'H', 'X'] };
  memo.update(hole);
  const tabs = get('signal-memo-tabs'), diagrams = get('signal-memo-body').children, count = evolved;
  assert.equal(count, 8, 'All four one-wire gates are simulated once per basis; white inputs follow by linearity.');
  assert.deepEqual(tabs.children.map(button => button.dataset.memoChoice), ['I', 'H', 'X', 'Z']);
  assert.equal(get('signal-memo').open, false); assert.equal(get('signal-memo').hidden, false);
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 3');
  assert.equal(tabs.children[1].attrs['aria-selected'], 'true');
  assert.equal(diagrams.length, 1); assert.equal(diagramLanes(diagrams[0]).length, 2);
  assert.doesNotMatch(get('signal-memo-body').textContent, /0\.707|Hadamard/);
  const buttons = tabs.children;
  memo.update({ ...hole, id: 'another-hole', wires: [...hole.wires], choices: ['I', 'Z'] });
  assert.equal(tabs.children, buttons); assert.equal(get('signal-memo-body').children, diagrams); assert.equal(evolved, count);
  let prevented = false;
  tabs.handlers.keydown({ target: buttons[1], key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(buttons[2].focused, true); assert.equal(buttons[2].attrs['aria-selected'], 'true');
  assert.equal(diagramNodes(get('signal-memo-body').children[0], 'output')[0].attrs['data-bits'], '1');
  get('signal-memo').open = true; memo.update(null);
  assert.equal(get('signal-memo').hidden, true); assert.equal(get('signal-memo').open, true);
  memo.update(hole); assert.equal(evolved, count);
  memo.update({ ...hole, wires: [0] });
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 1'); assert.notEqual(tabs.children, buttons);
  assert.equal(tabs.children[2].attrs['aria-selected'], 'true', 'A chosen gate remains selected in the next compatible context.');
});

test('A restricted paired hole exposes every two-wire reference without changing its playable choices', context => {
  const { get, icon } = dom(context);
  const memo = createGateMemo({ get, icon });
  const hole = { wires: [0, 2], choices: ['I', 'CX'] }, saved = structuredClone(hole);
  memo.update(hole);
  assert.deepEqual(get('signal-memo-tabs').children.map(button => button.dataset.memoChoice), ['I', 'CX', 'XC', 'CZ']);
  assert.equal(diagramLanes(get('signal-memo-body').children[0]).length, 4);
  assert.deepEqual(hole, saved);
  memo.update({ wires: [2], choices: ['I', 'X'] });
  assert.deepEqual(get('signal-memo-tabs').children.map(button => button.dataset.memoChoice), gateMemoChoices({ wires: [2] }));
  assert.equal(diagramLanes(get('signal-memo-body').children[0]).length, 2);
});

test('Full one-target references retain the selected hole’s fixed controls', context => {
  const { get, icon } = dom(context);
  const memo = createGateMemo({ get, icon, operation: holeOperation, apply: applyOperation });
  const hole = { wires: [3], controls: [0, 2], choices: ['I', 'H'] }, saved = structuredClone(hole);
  memo.update(hole);
  const tabs = get('signal-memo-tabs');
  assert.deepEqual(tabs.children.map(button => button.dataset.memoChoice), ['I', 'H', 'X', 'Z']);
  tabs.handlers.click({ target: tabs.children[2] });
  assert.equal(diagramLanes(get('signal-memo-body').children[0]).length, 8, 'Both controls and the target are included in the reference map');
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 1, wire 3, wire 4');
  assert.equal(diagramNodes(get('signal-memo-body').children[0], 'output')[0].attrs['data-bits'], '000', 'An inactive control leaves the input unchanged');
  get('signal-memo-body').handlers.click({ target: inputButton(get('signal-memo-body').children[0], '110') });
  assert.equal(diagramNodes(get('signal-memo-body').children[0], 'output')[0].attrs['data-bits'], '111', 'Both active controls allow X to flip the target');
  assert.deepEqual(hole, saved);
});

function diagramNodes(diagram, role) {
  return diagram.children[0].children.filter(node => node.tag === 'circle' && node.attrs['data-role'] === role);
}
function diagramLanes(diagram) { return diagram.children[0].children.filter(node => node.tag === 'line'); }
function inputButton(diagram, bits) { return diagram.children.find(node => node.dataset.memoInput === bits); }

test('Changing the selected input keeps keyboard focus, clamping its lane when the next hole has fewer wires', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon });
  const body = get('signal-memo-body');
  memo.update({ wires: [0, 1], choices: ['I', 'CX'] });
  const before = inputButton(body.children[0], '11'); before.focus();
  body.handlers.click({ target: before });
  const selected = inputButton(body.children[0], '11');
  assert.notEqual(selected, before); assert.equal(document.activeElement, selected);
  memo.update({ wires: [0], choices: ['I', 'X'] });
  assert.equal(document.activeElement, inputButton(body.children[0], '1'));
  assert.equal(document.activeElement.attrs['aria-pressed'], 'true');
  const tabs = get('signal-memo-tabs');
  tabs.handlers.keydown({ target: tabs.children[2], key: 'End', preventDefault() {} });
  assert.equal(document.activeElement, tabs.children[3]);
  assert.equal(tabs.children[3].tabIndex, 0);
});

test('The neutral memo marks colour swaps without assuming an input colour or recomputing gate maps', context => {
  const { get, icon } = dom(context); let evolved = 0;
  const memo = createGateMemo({ get, icon, apply(state, op, wires) { evolved++; applyGate(state, op.gate, op.wires, wires); } });
  memo.update({ wires: [0], choices: ['I', 'H'] });
  const count = evolved;
  const check = input => {
      const diagram = get('signal-memo-body').children[0];
      assert.equal(diagram.dataset.input, String(input));
      assert.equal(diagram.children[0].attrs.role, 'img');
      assert.ok([...diagramNodes(diagram, 'input'), ...diagramNodes(diagram, 'output')].every(node => node.attrs.fill === 'none' && !Object.hasOwn(node.attrs, 'data-phase')));
      const outputs = diagramNodes(diagram, 'output');
      assert.deepEqual(outputs.map(node => node.attrs['data-bits']), ['0', '1']);
      assert.deepEqual(outputs.map(node => node.attrs['data-colour-swap']), ['false', String(input === 1)]);
      assert.ok(diagram.children[0].children.filter(node => node.tag === 'path').every(node => node.attrs.stroke === '#dde3d7'));
      const markers = diagram.children[0].children.filter(node => node.attrs.class === 'signal-memo-colour-swap');
      assert.deepEqual(markers.map(node => [node.attrs['data-from'], node.attrs['data-to'], node.attrs['data-active']]), [['1', '1', String(input === 1)]]);
  };
  check(0); assert.equal(get('signal-memo-key').hidden, false);
  get('signal-memo-body').handlers.click({ target: inputButton(get('signal-memo-body').children[0], '1') }); check(1);
  const diagrams = get('signal-memo-body').children;
  get('signal-memo-body').handlers.click({ target: inputButton(diagrams[0], '1') });
  assert.equal(get('signal-memo-body').children, diagrams, 'Selecting the current input does not redraw');
  const tabs = get('signal-memo-tabs'); tabs.handlers.click({ target: tabs.children[2] });
  assert.equal(get('signal-memo-key').hidden, true, 'NOT preserves colour and needs no colour-swap key');
  assert.equal(evolved, count, 'Changing the input or reference gate uses the existing linear maps');
});

test('NOT crosses the fixed 0 and 1 lanes, highlighting one input without combining reference cases', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon });
  memo.update({ wires: [0], choices: ['I', 'X'] });
  const diagram = get('signal-memo-body').children[0];
  const contents = get('signal-memo-body').children;
  get('signal-memo-body').handlers.click({ target: diagram.children[0] });
  assert.equal(get('signal-memo-body').children, contents, 'Clicking a path or label outside the input controls does nothing');
  assert.deepEqual(diagramLanes(diagram).map(node => [node.attrs['data-basis'], node.attrs.y1, node.attrs.y2]), [['0', '56', '56'], ['1', '100', '100']]);
  const paths = diagram.children[0].children.filter(node => node.tag === 'path');
  assert.deepEqual(paths.map(node => [node.attrs['data-from'], node.attrs['data-to']]).sort(), [['0', '1'], ['1', '0']]);
  assert.equal(paths.find(node => node.attrs['data-from'] === '0').attrs.d, 'M60,56 C140,56 140,100 220,100');
  assert.equal(paths.find(node => node.attrs['data-from'] === '1').attrs.d, 'M60,100 C140,100 140,56 220,56');
  assert.equal(diagramNodes(diagram, 'output')[0].attrs.cy, '100');
  get('signal-memo-body').handlers.click({ target: inputButton(diagram, '1') });
  const selected = get('signal-memo-body').children[0];
  assert.equal(selected.dataset.input, '1');
  assert.equal(diagramNodes(selected, 'output')[0].attrs.cy, '56');
  assert.equal(inputButton(selected, '1').attrs['aria-pressed'], 'true');
});
