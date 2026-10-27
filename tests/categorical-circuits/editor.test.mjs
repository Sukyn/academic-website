import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitEditor } from '../../src/lib/categorical-circuits/editor.js';
import { simulate } from '../../src/lib/categorical-circuits/engine.js';
import { getLevels, signalsSolved, signalsData } from '../../src/lib/categorical-circuits/puzzles.js';
import { goalState } from '../../src/lib/quantum-signals/engine.js';

function editorSurface(mode = 'controlled') {
  const nodes = new Map();
  for (const id of ['editor-tools', 'editor-wires', 'editor-columns', 'editor-summary']) {
    nodes.set(id, { value: '', textContent: '', listeners: {},
      addEventListener(event, listener) { this.listeners[event] = listener; }, querySelectorAll() { return []; } });
  }
  let model;
  const editor = createCircuitEditor({ get: id => nodes.get(id), profile: () => mode, onChange: next => { model = next; } });
  return { editor, nodes, get model() { return model; },
    dimensions(wires, columns) {
      nodes.get('editor-wires').value = String(wires); nodes.get('editor-columns').value = String(columns);
      nodes.get('editor-columns').listeners.change();
    } };
}

test('Advanced Signals editor keeps the fixed goal through edits and exports only puzzle contents', () => {
  const surface = editorSurface(), { editor } = surface;
  const puzzle = getLevels('controlled', 'signals').find(level => level.title === 'Unequal branches');
  const original = structuredClone(puzzle);
  editor.open(puzzle);
  assert.equal(editor.active, true);
  assert.deepEqual(puzzle, original);
  const goal = surface.model.target;
  assert.equal(surface.model.holes.length, puzzle.holes.length);
  editor.setTool('X'); editor.handleCell(1, puzzle.columns.length);
  assert.strictEqual(surface.model.target, goal, 'Editing gates does not change the goal');
  const result = editor.puzzle();
  assert.deepEqual(result.target, puzzle.target);
  const independent = editor.puzzle(), frozen = structuredClone(independent);
  independent.columns[0][0].gate = 'X';
  independent.holes[0].wires[0] = 0;
  independent.target[0] = 99;
  assert.deepEqual(editor.puzzle(), frozen, 'Normalization isolates every returned circuit, hole, reference and target from the editor');
  const exported = signalsData(result);
  assert.deepEqual(Object.keys(exported), ['wires', 'columns', 'holes']);
  assert.equal(Object.hasOwn(exported, 'target'), false);
  assert.equal(Object.hasOwn(exported, 'solution'), false);
  editor.close(); assert.equal(editor.active, false);
});

test('Editor creates suffix holes that can reach the fixed goal without losing later gates', () => {
  const surface = editorSurface(), { editor } = surface;
  editor.open();
  editor.setTool('X'); editor.handleCell(0, 0); editor.handleCell(1, 1); editor.handleCell(2, 2);
  const before = editor.circuit();
  editor.setTool('hole');
  assert.throws(() => editor.handleCell(0, 0), /fixed gate before the holes/);
  assert.deepEqual(editor.circuit(), before);
  editor.handleCell(2, 2);
  assert.equal(surface.model.fixedColumns, 2);
  assert.deepEqual(surface.model.holes[0].wires, [2]);
  const puzzle = editor.puzzle();
  assert.equal(signalsSolved(puzzle, ['X']), true);
  assert.equal(signalsSolved(puzzle, ['I']), false);
  assert.deepEqual(puzzle.target, goalState(3));
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
  editor.setTool('SWAP'); editor.handleCell(0, 1);
  const before = editor.circuit();
  assert.throws(() => editor.handleCell(2, 1), /consecutive/);
  assert.deepEqual(editor.circuit(), before, 'An invalid link preserves the draft and pending first endpoint');
  editor.handleCell(1, 1);
  assert.deepEqual(editor.circuit().columns[1][0], { gate: 'SWAP', wires: [0, 1] });
  editor.setTool('hole'); editor.handleCell(0, 1);
  assert.deepEqual(surface.model.holes[0].choices, ['I', 'SWAP']);
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

test('Controlled holes can acquire controls without floating-point target data and stay limited to six', () => {
  const surface = editorSurface(), { editor } = surface;
  editor.open();
  editor.setTool('X'); editor.handleCell(1, 3);
  editor.setTool('hole'); editor.handleCell(1, 3);
  editor.setTool('control'); editor.handleCell(1, 3); editor.handleCell(0, 3);
  assert.deepEqual(surface.model.holes[0].choices, ['I', 'H', 'X', 'Z']);
  assert.deepEqual(surface.model.holes[0].controls, [0]);
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

test('PROP fixed controlled gates become whole paired holes with exact witness operations', () => {
  for (const [gate, target, control, witness] of [['X', 1, 0, 'CX'], ['X', 0, 2, 'XC'], ['Z', 0, 2, 'CZ']]) {
    const surface = editorSurface('prop'), { editor } = surface;
    editor.open();
    editor.setTool(gate); editor.handleCell(target, 3);
    editor.setTool('control'); editor.handleCell(target, 3); editor.handleCell(control, 3);
    const original = editor.circuit();
    editor.setTool('hole'); editor.handleCell(control, 3);
    const hole = surface.model.holes[0];
    assert.deepEqual(hole, { wires: [target, control].sort((a, b) => a - b), choices: ['I', 'CX', 'XC', 'CZ'] });
    assert.equal(Object.hasOwn(hole, 'controls'), false);
    for (let basis = 0; basis < 8; basis++) {
      const initial = Array.from({ length: 8 }, (_, index) => Number(index === basis));
      assert.deepEqual(simulate(editor.circuit(), initial, 'prop'), simulate(original, initial, 'prop'),
        `${witness} preserves every basis amplitude and its sign`);
    }
    assert.throws(() => editor.puzzle(), /goal cannot be reached/);
    assert.deepEqual(editor.circuit().columns[3][0], gate === 'Z' ?
      { gate: 'Z', wires: [2], controls: [0] } : { gate, wires: [target], controls: [control] });
  }
});

test('PROP holes reject control constructors and paired witnesses remain whole gates when edited', () => {
  const surface = editorSurface('prop'), { editor } = surface;
  editor.open();
  editor.setTool('X'); editor.handleCell(1, 3);
  editor.setTool('control'); editor.handleCell(1, 3); editor.handleCell(0, 3);
  editor.setTool('hole'); editor.handleCell(1, 3);
  const before = editor.circuit(), hole = structuredClone(surface.model.holes[0]);
  editor.setTool('control');
  assert.throws(() => editor.handleCell(1, 3), /complete gate/);
  assert.deepEqual(editor.circuit(), before);
  assert.deepEqual(surface.model.holes[0], hole);
  editor.setTool('X'); editor.handleCell(0, 3);
  assert.deepEqual(editor.circuit().columns[3][0], { gate: 'X', wires: [0], controls: [1] });
  editor.setTool('Z'); editor.handleCell(0, 3);
  assert.deepEqual(editor.circuit().columns[3][0], { gate: 'Z', wires: [1], controls: [0] });
  editor.setTool('H');
  assert.throws(() => editor.handleCell(1, 3), /gate offered by this hole/);
  assert.deepEqual(surface.model.holes[0], hole);
  editor.setTool('erase'); editor.handleCell(0, 3);
  assert.equal(surface.model.holes.length, 0, 'Either endpoint erases the complete paired hole');
});

test('selecting editor cells does not copy the editable draft or expose it to callers', context => {
  const originalClone = globalThis.structuredClone;
  let draftCopies = 0;
  context.mock.method(globalThis, 'structuredClone', value => {
    if (Array.isArray(value?.columns) && Array.isArray(value?.holes)) draftCopies++;
    return originalClone(value);
  });
  const surface = editorSurface(), { editor } = surface;
  editor.open(); editor.setTool('H'); editor.handleCell(0, 0);
  editor.setTool('select');
  const before = draftCopies;
  editor.handleCell(0, 0); editor.handleCell(1, 1);
  assert.equal(draftCopies, before, 'Read-only selections need no editable-draft clone');
  assert.deepEqual([...surface.model.selectedCells], ['1:1']);
  surface.model.circuit.columns[0][0].gate = 'X';
  assert.equal(editor.circuit().columns[0][0].gate, 'H', 'Returned render data remains isolated');
});
