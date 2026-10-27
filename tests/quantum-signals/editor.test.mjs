import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDraftEntry, draftFromPuzzle, puzzleFromDraft, resizeDraft, setDraftEntry } from '../../src/lib/quantum-signals/editor.js';
import { goalState, simulate, stateEqual, validatePlayablePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, generatePuzzle } from '../../src/lib/quantum-signals/puzzles.js';

const single = (gate, wire) => ({ gate, wires: [wire] });
const end = (endpoint, wire) => ({ endpoint, wires: [wire] });
const pairChoices = ['I', 'CX', 'XC', 'CZ'];
const fixture = () => ({ wires: 3, columns: [
  [{ id: 'old', wires: [0, 2], choices: pairChoices }, single('X', 1)],
  [single('H', 0)],
] });

test('visual drafts round-trip the fixed goal without mutating source puzzles', () => {
  for (const puzzle of [...LEVELS, generatePuzzle('editor', 3)]) {
    const saved = structuredClone(puzzle), draft = draftFromPuzzle(puzzle), result = puzzleFromDraft(draft);
    assert.deepEqual(Object.keys(result), ['wires', 'columns', 'target']);
    assert.deepEqual(Object.keys(draft), ['wires', 'columns']);
    assert.ok(stateEqual(result.target, puzzle.target));
    draft.columns[0].push(single('I', 0));
    assert.deepEqual(puzzle, saved);
  }
  assert.throws(() => draftFromPuzzle({ wires: 1,
    columns: [[{ id: 'a', wires: [0], choices: ['I', 'H'] }]], target: [.6, .8] }), /goal is fixed/);
});

test('imported reversed pairs become upper/lower controls without changing circuit physics', () => {
  const original = { wires: 3, columns: [
    [single('H', 0)], [{ gate: 'CX', wires: [2, 0] }],
    [{ id: 'a', wires: [2, 0], choices: pairChoices }],
  ], target: goalState(3) };
  const saved = structuredClone(original), draft = draftFromPuzzle(original), canonical = puzzleFromDraft(draft);
  assert.deepEqual(draft.columns[1], [{ gate: 'XC', wires: [0, 2] }]);
  assert.deepEqual(draft.columns[2], [{ id: 'a', wires: [0, 2], choices: ['I', 'XC', 'CX', 'CZ'] }]);
  for (const gate of pairChoices) {
    const flipped = gate === 'CX' ? 'XC' : gate === 'XC' ? 'CX' : gate;
    assert.ok(stateEqual(simulate(original, { a: gate }).state, simulate(canonical, { a: flipped }).state));
  }
  assert.deepEqual(original, saved);
});

test('resizing removes out-of-range paired entries without storing target data', () => {
  const draft = fixture(), saved = structuredClone(draft);
  const wider = resizeDraft(draft, { columns: 4 });
  assert.deepEqual(Object.keys(wider), ['wires', 'columns']);
  assert.deepEqual(wider.columns.slice(2), [[], []]);
  assert.notEqual(wider.columns[2], wider.columns[3]);
  const shorter = resizeDraft(draft, { wires: 2, columns: 3 });
  assert.deepEqual(shorter.columns, [[single('X', 1)], [single('H', 0)], []]);
  assert.deepEqual(Object.keys(shorter), ['wires', 'columns']);
  assert.deepEqual(resizeDraft(draft, { columns: 1 }).columns, [draft.columns[0]]);
  assert.deepEqual(draft, saved);
});

test('cell edits replace complete paired entries and overlapping endpoints atomically', () => {
  const draft = fixture(), saved = structuredClone(draft);
  assert.deepEqual(setDraftEntry(draft, 0, single('H', 2), 0).columns[0], [single('X', 1), single('H', 2)]);
  const paired = setDraftEntry(draft, 0, { wires: [0, 1], choices: pairChoices }, 2);
  assert.deepEqual(paired.columns[0], [{ id: 'old', wires: [0, 1], choices: pairChoices }]);
  const middle = setDraftEntry(draft, 0, single('H', 1), 1);
  assert.deepEqual(middle.columns[0], [draft.columns[0][0], single('H', 1)],
    'A link crossing an unconnected intermediate wire does not occupy that endpoint');
  assert.deepEqual(setDraftEntry(draft, 0, null, 2).columns[0], [single('X', 1)]);
  assert.deepEqual(draft, saved);
});

test('the visual editor preserves constrained holes between imposed gates', () => {
  let draft = { wires: 2, columns: [[], [], []] };
  draft = setDraftEntry(draft, 0, single('H', 0), 0);
  draft = setDraftEntry(draft, 0, single('X', 1), 1);
  draft = setDraftEntry(draft, 1, { wires: [0], choices: ['I', 'Z'] }, 0);
  draft = setDraftEntry(draft, 1, single('Z', 1), 1);
  draft = setDraftEntry(draft, 2, single('H', 0), 0);
  const saved = structuredClone(draft), puzzle = validatePlayablePuzzle(puzzleFromDraft(draft));
  assert.equal(simulate(puzzle).solved, false);
  assert.equal(simulate(puzzle, { h1: 'Z' }).solved, true);
  assert.deepEqual(draftFromPuzzle(puzzle), draft);
  assert.deepEqual(draft, saved);
});

test('hole edits preserve or generate unique IDs and enforce the six-hole limit', () => {
  let draft = { wires: 1, columns: Array.from({ length: 7 }, () => []) };
  for (let column = 0; column < 6; column++) draft = setDraftEntry(draft, column, { wires: [0], choices: ['I', 'X'] }, 0);
  assert.deepEqual(draft.columns.slice(0, 6).map(column => column[0].id), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  assert.throws(() => setDraftEntry(draft, 6, { wires: [0], choices: [] }, 0), /six holes/);
  assert.throws(() => setDraftEntry(draft, 0, { id: 'h2', wires: [0], choices: [] }, 0), /Invalid circuit hole/);
  assert.equal(setDraftEntry(draft, 2, { wires: [0], choices: [] }, 0).columns[2][0].id, 'h3');
  const named = setDraftEntry(draft, 0, { id: 'constructor', wires: [0], choices: ['I', 'X'] }, 0);
  assert.equal(puzzleFromDraft(named).columns[0][0].id, 'constructor');
  assert.equal(draft.columns[0][0].id, 'h1');
  let pending = resizeDraft(draft, { wires: 2 });
  pending = setDraftEntry(pending, 6, end('hole', 0), 0);
  pending = setDraftEntry(pending, 6, end('hole', 1), 1);
  assert.throws(() => connectDraftEntry(pending, 6, 0, 1), /six holes/);
  assert.deepEqual(pending.columns[6], [end('hole', 0), end('hole', 1)]);
});

test('unfinished drafts remain editable while final conversion enforces puzzle rules', () => {
  const base = { wires: 1, columns: [[]] };
  const empty = setDraftEntry(base, 0, { wires: [0], choices: [] }, 0);
  const one = setDraftEntry(empty, 0, { wires: [0], choices: ['H'] }, 0);
  assert.equal(one.columns[0][0].id, empty.columns[0][0].id);
  assert.throws(() => puzzleFromDraft(one), RangeError);
  assert.throws(() => puzzleFromDraft(one), /Invalid circuit hole or gate choices/);
  const ready = setDraftEntry(one, 0, { wires: [0], choices: ['H', 'Z'] }, 0);
  assert.deepEqual(puzzleFromDraft(ready).target, [0, 1]);
  assert.throws(() => puzzleFromDraft(setDraftEntry(ready, 0, single('H', 0), 0)), /1–6 holes/);
});

test('unconnected endpoints remain editable and survive resizing until final conversion', () => {
  const draft = { wires: 4, columns: [[end('control', 0), end('hole', 3)], []] };
  const saved = structuredClone(draft), edited = setDraftEntry(draft, 1, single('H', 2), 2);
  assert.deepEqual(edited.columns[0], draft.columns[0]);
  assert.deepEqual(resizeDraft(edited, { columns: 3 }).columns, [...edited.columns, []]);
  const smaller = resizeDraft(edited, { wires: 3 });
  assert.deepEqual(smaller.columns, [[end('control', 0)], [single('H', 2)]]);
  assert.deepEqual(Object.keys(smaller), ['wires', 'columns']);
  assert.throws(() => puzzleFromDraft(edited), /unconnected endpoint/);
  const removed = setDraftEntry(edited, 0, null, 3);
  assert.deepEqual(removed.columns[0], [end('control', 0)]);
  assert.deepEqual(draft, saved);
});

test('connecting endpoints preserves physical control direction and unrelated intermediate wires', () => {
  for (const [fromWire, toWire] of [[0, 2], [2, 0]]) for (const [first, second] of [
    ['control', 'target'], ['target', 'control'], ['control', 'control'], ['phase', 'phase'],
    ['phase', 'control'], ['control', 'phase'], ['phase', 'target'], ['target', 'phase'],
  ]) {
    const draft = { wires: 3, columns: [[end(first, fromWire), single('X', 1), end(second, toWire)],
      [{ id: 'spare', wires: [0], choices: ['I', 'X'] }]] };
    const saved = structuredClone(draft), connected = connectDraftEntry(draft, 0, fromWire, toWire);
    const firstControl = first === 'control' || first === 'phase', secondControl = second === 'control' || second === 'phase';
    const control = firstControl ? fromWire : toWire;
    const gate = firstControl && secondControl ? 'CZ' : control === 0 ? 'CX' : 'XC';
    assert.deepEqual(connected.columns[0], [single('X', 1), { gate, wires: [0, 2] }]);
    const puzzle = puzzleFromDraft(connected);
    assert.deepEqual(simulate(puzzle, { spare: 'I' }).state,
      simulate({ ...puzzle, columns: [[single('X', 1), { gate: gate === 'CZ' ? 'CZ' : 'CX', wires: [control, control === 0 ? 2 : 0] }],
        puzzle.columns[1]] }, { spare: 'I' }).state);
    assert.deepEqual(draft, saved);
  }
});

test('a second wire click completes each gate type without requiring another endpoint', () => {
  for (const fromWire of [0, 2]) for (const [role, gate] of [
    ['control', fromWire === 0 ? 'CX' : 'XC'], ['target', fromWire === 0 ? 'XC' : 'CX'], ['phase', 'CZ'], ['hole', null],
  ]) {
    const draft = { wires: 3, columns: [[end(role, fromWire)]] };
    const connected = connectDraftEntry(draft, 0, fromWire, fromWire === 0 ? 2 : 0);
    assert.deepEqual(connected.columns[0], [gate ? { gate, wires: [0, 2] } : { id: 'h1', wires: [0, 2], choices: pairChoices }]);
  }
});

test('hole endpoints gain an ID only when connected and replace complete overlapping pairs', () => {
  const draft = { wires: 4, columns: [[end('hole', 0), single('H', 1), { gate: 'CZ', wires: [2, 3] }]] };
  const saved = structuredClone(draft), connected = connectDraftEntry(draft, 0, 0, 2, 'hole');
  assert.equal(Object.hasOwn(draft.columns[0][0], 'id'), false);
  assert.deepEqual(connected.columns[0], [single('H', 1), { id: 'h1', wires: [0, 2], choices: pairChoices }]);
  assert.deepEqual(puzzleFromDraft(connected).columns, connected.columns);
  const twoEnds = setDraftEntry(draft, 0, end('hole', 2), 2);
  assert.deepEqual(connectDraftEntry(twoEnds, 0, 2, 0).columns, connected.columns);
  assert.deepEqual(draft, saved);
});

test('endpoint connections reject invalid wires and incompatible roles without changing the draft', () => {
  const draft = { wires: 3, columns: [[end('target', 0), single('H', 1), end('hole', 2)]] }, saved = structuredClone(draft);
  for (const args of [[0, 0, 0], [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 0, 3], [0, 0, NaN],
    [0, 1, 2, 'control'], [0, 0, 2], [0, 0, 2, 'target'], [0, 0, 2, 'bad'], [0, 2, 0, 'control']]) {
    assert.throws(() => connectDraftEntry(draft, ...args), RangeError);
  }
  for (const entry of [end('bad', 0), { endpoint: 'control', wires: [0, 2] }]) {
    assert.throws(() => setDraftEntry(draft, 0, entry, 0), RangeError);
  }
  assert.deepEqual(draft, saved);
});

test('draft operations reject malformed dimensions, cells and gates', () => {
  const draft = fixture();
  for (const options of [{ wires: 0 }, { wires: 5 }, { wires: 1.5 }, { columns: 0 }, { columns: 17 }, { columns: Infinity }]) {
    assert.throws(() => resizeDraft(draft, options), RangeError);
  }
  for (const [column, entry, wire] of [[-1, null, 0], [2, null, 0], [0, null, 3], [0, null, NaN],
    [0, { gate: 'CX', wires: [0] }, 0], [0, { gate: 'H', wires: [0, 1] }, 0],
    [0, { wires: [0, 0], choices: [] }, 0], [0, { wires: [0], choices: ['H', 'H'] }, 0]]) {
    assert.throws(() => setDraftEntry(draft, column, entry, wire), RangeError);
  }
  assert.throws(() => resizeDraft({ ...draft, columns: Array(2) }, {}), RangeError);
});
