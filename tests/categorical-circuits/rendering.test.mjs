import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCircuit, renderAdvancedFlow, operationIcon, operationLabel } from '../../src/lib/categorical-circuits/rendering.js';
import { simulate } from '../../src/lib/categorical-circuits/engine.js';

function surface(context) {
  class Node {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.dataset = {}; this.style = {}; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    }
    get className() { return this.attrs.class ?? ''; }
    set className(value) { this.attrs.class = value; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text ?? ''; }
    set textContent(value) { this.text = value; this.children = []; }
    appendChild(child) { this.children.push(...(child.tag === 'fragment' ? child.children : [child])); return child; }
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); }
    querySelectorAll(selector) {
      const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
      return walk(this).filter(node => node.attrs.class?.split(' ').includes(selector.slice(1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    get classList() { return { add: (...names) => {
      this.attrs.class = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ');
    } }; }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElementNS: (_, tag) => new Node(tag), createElement: tag => new Node(tag),
    createDocumentFragment: () => new Node('fragment'),
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  return { board: new Node('div'), svg: new Node('svg'), target: new Node('svg') };
}

test('Advanced circuit targets, controls and empty cells retain separate selectable roles', context => {
  const { board } = surface(context);
  const circuit = { wires: 3, columns: [[{ gate: 'Z', wires: [2], controls: [0, 1] }],
    [{ gate: 'SWAP', wires: [1, 2] }], []] };
  renderCircuit(board, circuit, { selectedCells: new Set(['2:0']),
    fixedColumns: 2, holes: [{ wires: [1], choices: ['I', 'H'] }] });
  const cells = board.querySelectorAll('.categorical-cell');
  assert.equal(cells.length, 9);
  assert.ok(cells.every(cell => cell.tag === 'button' && cell.style.width === '88px' && cell.style.height === '88px'));
  const target = cells.find(cell => cell.dataset.cell === '2:0');
  assert.equal(target.dataset.target, '0:2');
  assert.equal(target.attrs['aria-pressed'], 'true');
  assert.equal(target.dataset.role, 'target');
  assert.match(target.attrs['aria-label'], /Z on wire 3, controlled by wires 1, 2/);
  const control = cells.find(cell => cell.dataset.cell === '0:0');
  assert.equal(control.dataset.role, 'control');
  assert.match(control.attrs['aria-label'], /control for Z/);
  const swaps = cells.filter(cell => cell.dataset.column === '1' && cell.dataset.role === 'target');
  assert.equal(swaps.length, 2);
  assert.ok(swaps.every(cell => cell.children.length === 0), 'A swap has crossed wires instead of endpoint glyphs');
  assert.equal(board.querySelectorAll('.categorical-swap-path').length, 2);
  const hole = cells.find(cell => cell.dataset.cell === '1:2');
  assert.equal(hole.dataset.hole, '0'); assert.equal(hole.dataset.filled, 'false');
  assert.ok(hole.children.some(child => child.className === 'categorical-hole'));
  assert.ok(cells.every(cell => !Object.hasOwn(cell.attrs, 'title')));
});

test('Advanced palette icons keep controlled targets and swap crosses inside their view box', context => {
  surface(context);
  for (const operation of [{ gate: 'H', wires: [0], controls: [1, 2, 3] },
    { gate: 'SWAP', wires: [1, 2], controls: [0] }]) {
    const icon = operationIcon(operation);
    for (const child of icon.children.filter(child => child.tag === 'svg')) {
      assert.ok(Number(child.attrs.y) >= 0);
      assert.ok(Number(child.attrs.y) + Number(child.attrs.height) <= 44);
    }
    assert.match(operationLabel(operation), /controlled by wire/);
  }
  assert.equal(operationLabel({ gate: 'I' }), 'Identity');
});

test('Adjacent swaps replace the straight wire spans and keep cell hit areas unchanged', context => {
  const { board } = surface(context);
  renderCircuit(board, { wires: 2, columns: [
    [{ gate: 'SWAP', wires: [0, 1] }], [{ gate: 'SWAP', wires: [0, 1] }],
  ] }, { selectedCells: ['0:0', '1:0'] });
  const wires = board.querySelectorAll('.categorical-wire');
  assert.deepEqual(wires.map(wire => wire.attrs.d), [
    'M16 52H48M224 52H232', 'M16 140H48M224 140H232',
  ], 'Neither swapped row has a horizontal segment beneath either crossing');
  const paths = board.querySelectorAll('.categorical-swap-path');
  assert.equal(paths.length, 4);
  assert.ok(paths[0].attrs.d.startsWith('M48 52 ')); assert.ok(paths[0].attrs.d.endsWith('136 140'));
  assert.ok(paths[1].attrs.d.startsWith('M48 140 ')); assert.ok(paths[1].attrs.d.endsWith('136 52'));
  assert.equal(board.querySelectorAll('.categorical-link').length, 0, 'An ordinary swap has no vertical gate connector');
  const cells = board.querySelectorAll('.categorical-cell');
  assert.equal(cells.length, 4);
  assert.ok(cells.every(cell => cell.style.width === '88px' && cell.style.height === '88px'));
  assert.equal(cells.filter(cell => cell.attrs['aria-pressed'] === 'true').length, 2);
});

test('Adjacent controlled swaps preserve the straight control row and link to the crossing midpoint', context => {
  const { board } = surface(context);
  const circuit = { wires: 3, columns: [[{ gate: 'SWAP', wires: [1, 2], controls: [0] }]] };
  renderCircuit(board, circuit);
  const wires = board.querySelectorAll('.categorical-wire');
  assert.deepEqual(wires.map(wire => wire.attrs.d), [
    'M16 52H144', 'M16 140H48M136 140H144', 'M16 228H48M136 228H144',
  ]);
  const paths = board.querySelectorAll('.categorical-swap-path');
  assert.equal(paths.length, 2);
  assert.ok(paths[0].attrs.d.startsWith('M48 140 ')); assert.ok(paths[0].attrs.d.endsWith('136 228'));
  assert.ok(paths[1].attrs.d.startsWith('M48 228 ')); assert.ok(paths[1].attrs.d.endsWith('136 140'));
  const link = board.querySelectorAll('.categorical-link')[0];
  assert.equal(link.attrs.y1, '52'); assert.equal(link.attrs.y2, '184');
  assert.ok(paths.every(path => path.attrs.d.includes('92 184')), 'The wires cross midway between adjacent targets');
  const control = board.querySelectorAll('.categorical-cell').find(cell => cell.dataset.role === 'control');
  assert.equal(control.dataset.cell, '0:0'); assert.equal(control.children.length, 1);
  assert.match(control.attrs['aria-label'], /SWAP on wires 2, 3, controlled by wire 1/);
  const original = structuredClone(circuit);
  renderCircuit(board, circuit, { interactive: false });
  assert.deepEqual(circuit, original, 'Rule miniatures do not alter the circuit');
  assert.ok(board.querySelectorAll('.categorical-cell').every(cell => cell.tag === 'div'));
  assert.equal(board.querySelectorAll('.categorical-swap-path').length, 2);
});

test('Palette and editor SWAP icons show crossing wires without paired cross symbols', context => {
  surface(context);
  for (const controls of [[], [0], [0, 3]]) {
    const operation = { gate: 'SWAP', wires: controls.length ? [1, 2] : [0, 1], controls };
    const icon = operationIcon(operation);
    assert.equal(icon.querySelectorAll('.categorical-swap-path').length, 2);
    assert.equal(icon.children.filter(child => child.tag === 'svg').length, 0, 'No endpoint cross glyph is nested in the icon');
    assert.equal(icon.children.filter(child => child.tag === 'circle').length, controls.length);
    assert.equal(icon.querySelectorAll('.categorical-link').length, Number(Boolean(controls.length)));
  }
});

test('Empty controlled holes show their known context without counting as filled gates', context => {
  const { board } = surface(context);
  const holes = [{ wires: [1], controls: [0], choices: ['I', 'H', 'X', 'Z'] }];
  renderCircuit(board, { wires: 2, columns: [[]] }, { holes, fixedColumns: 0 });
  const cells = board.querySelectorAll('.categorical-cell');
  const control = cells.find(cell => cell.dataset.cell === '0:0');
  const target = cells.find(cell => cell.dataset.cell === '1:0');
  assert.equal(control.dataset.role, 'control'); assert.equal(control.dataset.placeholder, 'true');
  assert.equal(control.children[0].style.opacity, '.45');
  assert.match(control.attrs['aria-label'], /Control for hole 1, target wire 2/);
  assert.equal(target.dataset.filled, 'false');
  assert.ok(target.children.some(child => child.className === 'categorical-hole'));
  const link = board.querySelectorAll('.categorical-link')[0];
  assert.equal(link.attrs['stroke-opacity'], '0.45');
  renderCircuit(board, { wires: 2, columns: [[{ gate: 'H', wires: [1], controls: [0] }]] }, { holes, fixedColumns: 0 });
  const filled = board.querySelectorAll('.categorical-cell');
  assert.equal(filled.find(cell => cell.dataset.cell === '1:0').dataset.filled, 'true');
  assert.equal(filled.find(cell => cell.dataset.cell === '0:0').dataset.placeholder, undefined);
  assert.equal(board.querySelectorAll('.categorical-link')[0].attrs['stroke-opacity'], undefined);
});

test('Advanced expanded paths support unequal controlled-H amplitudes and a fixed separate target', context => {
  const { svg, target } = surface(context);
  const circuit = { wires: 2, columns: [[{ gate: 'H', wires: [0] }], [{ gate: 'H', wires: [1], controls: [0] }]] };
  const goal = simulate(circuit), original = structuredClone(circuit);
  renderAdvancedFlow(svg, target, circuit, goal, { selectedColumn: 1 });
  assert.deepEqual(circuit, original);
  assert.equal(target.dataset.match, 'true');
  assert.equal(svg.querySelectorAll('.signal-flow-target').length, 0);
  assert.deepEqual(svg.querySelectorAll('.signal-flow-label').map(node => node.textContent), ['00', '01', '11', '10']);
  const output = svg.querySelectorAll('.signal-flow-node').filter(node => node.dataset.boundary === '2');
  assert.equal(output.length, 3);
  assert.ok(output.some(node => Math.abs(Number(node.dataset.amplitude) - .5) < 1e-9));
  assert.ok(output.some(node => Math.abs(Number(node.dataset.amplitude) - Math.SQRT1_2) < 1e-9));
  const targets = target.querySelectorAll('.signal-flow-target');
  renderAdvancedFlow(svg, target, { ...circuit, columns: [...circuit.columns, [{ gate: 'X', wires: [0] }]] }, goal);
  assert.ok(target.querySelectorAll('.signal-flow-target').every((node, index) => node === targets[index]));
  assert.equal(target.dataset.match, 'false');
});
