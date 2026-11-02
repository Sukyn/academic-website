import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateMemo, gateMemoMap } from '../../src/lib/quantum-signals/gate-memo.js';
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
  const nodes = new Map(['signal-memo', 'signal-memo-tabs', 'signal-memo-body', 'signal-memo-map', 'signal-memo-caption'].map(id => [id, new Node('div')]));
  return { get: id => nodes.get(id), icon: () => new Node('svg') };
}


const all = element => element.children.flatMap(child => [child, ...all(child)]);
const dots = (diagram, role) => all(diagram).filter(node => node.tag === 'circle' && node.attrs['data-role'] === role);
const lanes = diagram => all(diagram).filter(node => node.tag === 'line');
const example = (get, input, phase) => get('signal-memo-body').children.find(node => node.dataset.input === input && node.dataset.phase === String(phase));

test('Memo retains gate/context caching and keyboard tabs while showing every input in both colours', context => {
  const { get, icon } = dom(context); let evolved = 0;
  const memo = createGateMemo({ get, icon, apply(state, op, wires) { evolved++; applyGate(state, op.gate, op.wires, wires); } });
  const hole = { wires: [2], choices: ['I', 'H', 'X'] };
  memo.update(hole);
  const tabs = get('signal-memo-tabs'), diagrams = get('signal-memo-body').children, count = evolved;
  assert.equal(count, 8, 'Simulate each positive basis once per gate; derive white cases by linearity.');
  assert.deepEqual(tabs.children.map(button => button.dataset.memoChoice), ['I', 'H', 'X', 'Z']);
  assert.equal(get('signal-memo').open, false); assert.equal(get('signal-memo').hidden, false);
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 3');
  assert.equal(tabs.children[1].attrs['aria-selected'], 'true');
  assert.deepEqual(diagrams.map(node => [node.dataset.input, node.dataset.phase]), [['0', '1'], ['0', '-1'], ['1', '1'], ['1', '-1']]);
  assert.ok(diagrams.every(diagram => lanes(diagram).length === 2));
  assert.equal(get('signal-memo-body').handlers.click, undefined, 'No hidden lane-selection interaction');
  assert.equal(all(get('signal-memo-body')).filter(node => node.tag === 'button').length, 0);
  const buttons = tabs.children;
  memo.update({ ...hole, wires: [...hole.wires], choices: ['I', 'Z'] });
  assert.equal(tabs.children, buttons); assert.equal(get('signal-memo-body').children, diagrams); assert.equal(evolved, count);
  let prevented = false;
  tabs.handlers.keydown({ target: buttons[1], key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(buttons[2].focused, true); assert.equal(buttons[2].attrs['aria-selected'], 'true');
  tabs.handlers.keydown({ target: buttons[2], key: 'End', preventDefault() {} });
  assert.equal(buttons[3].focused, true); assert.equal(buttons[3].tabIndex, 0);
  get('signal-memo').open = true; memo.update(null);
  assert.equal(get('signal-memo').hidden, true); assert.equal(get('signal-memo').open, true);
  memo.update(hole); assert.equal(evolved, count);
  memo.update({ ...hole, wires: [0] });
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 1');
  assert.notEqual(tabs.children, buttons); assert.equal(tabs.children[3].attrs['aria-selected'], 'true');
});

test('A paired hole exposes all reference gates and eight static examples without changing its choices', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon });
  const hole = { wires: [0, 2], choices: ['I', 'CX'] }, saved = structuredClone(hole);
  memo.update(hole);
  assert.deepEqual(get('signal-memo-tabs').children.map(button => button.dataset.memoChoice), ['I', 'CX', 'XC', 'CZ']);
  assert.equal(get('signal-memo-body').children.length, 8);
  assert.ok(get('signal-memo-body').children.every(diagram => lanes(diagram).length === 4));
  assert.deepEqual(hole, saved);
});

test('Static controlled maps retain every control bit and show active and inactive cases together', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon, operation: holeOperation, apply: applyOperation });
  const hole = { wires: [3], controls: [0, 2], choices: ['I', 'X'] }, saved = structuredClone(hole);
  memo.update(hole);
  assert.equal(get('signal-memo-body').children.length, 16);
  assert.equal(get('signal-memo-caption').textContent, 'Bits from left to right: wire 1, wire 3, wire 4');
  for (const phase of [1, -1]) {
    assert.equal(dots(example(get, '000', phase), 'output')[0].attrs['data-bits'], '000');
    assert.equal(dots(example(get, '110', phase), 'output')[0].attrs['data-bits'], '111');
  }
  assert.ok(get('signal-memo-body').children.every(diagram => lanes(diagram).length <= 2), 'Unused controlled-basis lanes do not make each example tall');
  assert.deepEqual(hole, saved);
});

test('Hadamard shows all four input cases, including the white 1-to-1 branch turning black', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon });
  memo.update({ wires: [0], choices: ['I', 'H'] });
  for (const input of ['0', '1']) for (const phase of [1, -1]) {
    const diagram = example(get, input, phase), outputs = dots(diagram, 'output');
    assert.deepEqual(outputs.map(dot => dot.attrs['data-bits']), ['0', '1']);
    assert.deepEqual(outputs.map(dot => Number(dot.attrs['data-phase'])), [phase, input === '1' ? -phase : phase]);
    for (const dot of [...dots(diagram, 'input'), ...outputs]) {
      assert.equal(dot.attrs.fill, Number(dot.attrs['data-phase']) < 0 ? '#ffffff' : '#000000');
      assert.equal(dot.attrs.stroke, '#ffffff');
    }
    const gradients = all(diagram).filter(node => node.tag === 'linearGradient');
    assert.equal(gradients.length, input === '1' ? 1 : 0);
    if (gradients.length) assert.deepEqual(gradients[0].children.map(stop => stop.attrs['stop-color']), phase > 0 ?
      ['#000000', '#000000', '#ffffff', '#ffffff'] : ['#ffffff', '#ffffff', '#000000', '#000000']);
    assert.equal(all(diagram).filter(node => node.attrs.class === 'signal-memo-colour-swap' || node.attrs['data-active']).length, 0);
  }
});

test('NOT shows both crossed mappings for each colour without combining the separate input cases', context => {
  const { get, icon } = dom(context), memo = createGateMemo({ get, icon });
  memo.update({ wires: [0], choices: ['I', 'X'] });
  for (const input of ['0', '1']) for (const phase of [1, -1]) {
    const diagram = example(get, input, phase), paths = all(diagram).filter(node => node.attrs.class === 'signal-memo-path');
    assert.equal(paths.length, 1);
    assert.equal(paths[0].attrs['data-from'], input); assert.equal(paths[0].attrs['data-to'], input === '0' ? '1' : '0');
    assert.equal(Number(paths[0].attrs['data-phase']), phase);
    assert.deepEqual(lanes(diagram).map(node => [node.attrs['data-basis'], node.attrs.y1, node.attrs.y2]), [['0', '56', '56'], ['1', '100', '100']]);
  }
});
