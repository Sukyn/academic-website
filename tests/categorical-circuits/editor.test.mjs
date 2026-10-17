import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitEditor } from '../../src/lib/categorical-circuits/editor.js';
import { getLevels, signalsSolved, signalsData } from '../../src/lib/categorical-circuits/puzzles.js';

function editorSurface(mode = 'controlled') {
  const nodes = new Map();
  for (const id of ['editor-tools', 'editor-wires', 'editor-columns', 'capture-target', 'editor-summary']) {
    nodes.set(id, { value: '', textContent: '', listeners: {},
      addEventListener(event, listener) { this.listeners[event] = listener; }, querySelectorAll() { return []; } });
  }
  let model;
  const editor = createCircuitEditor({ get: id => nodes.get(id), profile: () => mode, onChange: next => { model = next; } });
  return { editor, nodes, get model() { return model; },
    capture: () => nodes.get('capture-target').listeners.click(),
    dimensions(wires, columns) {
      nodes.get('editor-wires').value = String(wires); nodes.get('editor-columns').value = String(columns);
      nodes.get('editor-columns').listeners.change();
    } };
}

test('Advanced Signals editor preserves unequal targets through opening, edits and reference-only export', () => {
  const surface = editorSurface(), { editor } = surface;
  const puzzle = getLevels('controlled', 'signals').find(level => level.title === 'Unequal branches');
  const original = structuredClone(puzzle);
  editor.open(puzzle);
  assert.equal(editor.active, true);
  assert.deepEqual(puzzle, original);
  const goal = surface.model.target;
  assert.equal(surface.model.holes.length, 1);
  editor.setTool('X'); editor.handleCell(1, puzzle.columns.length);
  assert.strictEqual(surface.model.target, goal, 'The target is fixed until explicitly captured');
  const result = editor.puzzle();
  assert.deepEqual(result.target, puzzle.target);
  const exported = signalsData(result);
  assert.ok(exported.targetCircuit);
  assert.equal(Object.hasOwn(exported, 'target'), false);
  assert.equal(Object.hasOwn(exported, 'solution'), false);
  editor.close(); assert.equal(editor.active, false);
});

test('Editor creates suffix holes from real gates and captures their output without losing later fixed gates', () => {
  const surface = editorSurface(), { editor } = surface;
  editor.open();
  editor.setTool('H'); editor.handleCell(0, 0);
  editor.setTool('X'); editor.handleCell(1, 2);
  const before = editor.circuit();
  editor.setTool('hole');
  assert.throws(() => editor.handleCell(0, 0), /fixed gate before the holes/);
  assert.deepEqual(editor.circuit(), before);
  editor.handleCell(1, 2);
  assert.equal(surface.model.fixedColumns, 2);
  assert.deepEqual(surface.model.holes[0].wires, [1]);
  surface.capture();
  const puzzle = editor.puzzle();
  assert.equal(signalsSolved(puzzle, ['X']), true);
  assert.equal(signalsSolved(puzzle, ['I']), false);
  assert.deepEqual(puzzle.targetCircuit, editor.circuit());
});

test('Controlled H and SWAP are linked in a second step and unfinished links cannot be saved', () => {
  const surface = editorSurface(), { editor } = surface;
  editor.open();
  editor.setTool('H'); editor.handleCell(1, 0);
  editor.setTool('control'); editor.handleCell(1, 0);
  assert.throws(() => editor.puzzle(), /Connect every gate/);
  assert.throws(() => editor.handleCell(2, 1), /same column/);
  editor.handleCell(0, 0);
  assert.deepEqual(editor.circuit().columns[0][0], { gate: 'H', wires: [1], controls: [0] });
  editor.setTool('SWAP'); editor.handleCell(0, 1); editor.handleCell(2, 1);
  assert.deepEqual(editor.circuit().columns[1][0], { gate: 'SWAP', wires: [0, 2] });
  editor.setTool('hole'); editor.handleCell(0, 1); surface.capture();
  assert.deepEqual(editor.puzzle().holes[0].choices, ['I', 'SWAP']);
  editor.setTool('erase'); editor.handleCell(0, 1);
  assert.equal(surface.model.holes.length, 0);
  assert.throws(() => editor.puzzle(), /1–6 holes/);
});

test('PROP editor rejects controlled H, occupied links and destructive dimension changes atomically', () => {
  const surface = editorSurface('prop'), { editor } = surface;
  editor.open();
  editor.setTool('H'); editor.handleCell(1, 0);
  editor.setTool('control'); editor.handleCell(1, 0);
  const before = editor.circuit();
  assert.throws(() => editor.handleCell(0, 0), /controlled X or Z/);
  assert.deepEqual(editor.circuit(), before);
  editor.setTool('X'); editor.handleCell(2, 3);
  const resizeBefore = editor.circuit();
  surface.dimensions(3, 2);
  assert.match(surface.nodes.get('editor-summary').textContent, /Erase gates/);
  assert.deepEqual(editor.circuit(), resizeBefore);
  assert.throws(() => editor.setTool('unknown'), /editor tool/);
  assert.throws(() => editor.handleCell(-1, 0), /circuit cell/);
});

test('Holes can acquire controls without floating-point target data and stay limited to six', () => {
  const surface = editorSurface('prop'), { editor } = surface;
  editor.open();
  editor.setTool('X'); editor.handleCell(1, 3);
  editor.setTool('hole'); editor.handleCell(1, 3);
  editor.setTool('control'); editor.handleCell(1, 3); editor.handleCell(0, 3);
  assert.deepEqual(surface.model.holes[0].choices, ['I', 'X', 'Z']);
  surface.capture();
  assert.deepEqual(editor.puzzle().holes[0].controls, [0]);
  for (let index = 0; index < 5; index++) {
    surface.dimensions(3, editor.circuit().columns.length + 1);
    const lastFixed = surface.model.fixedColumns - 1;
    editor.setTool('hole'); editor.handleCell(2, lastFixed);
  }
  assert.equal(surface.model.holes.length, 6);
  surface.dimensions(3, editor.circuit().columns.length + 1);
  editor.setTool('hole');
  assert.throws(() => editor.handleCell(2, surface.model.fixedColumns - 1), /six holes/);
});
