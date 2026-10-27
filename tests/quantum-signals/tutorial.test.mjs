import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, getHoles, goalState, simulate, stateEqual, validatePlayablePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { TUTORIAL_PUZZLE, TUTORIAL_PUZZLES, TUTORIAL_STEPS } from '../../src/lib/quantum-signals/tutorial.js';

const stepsFor = chapter => TUTORIAL_STEPS.filter(step => step.chapter === chapter);
const fillingFor = chapter => Object.fromEntries(stepsFor(chapter).filter(step => step.hole).map(({ hole, gate }) => [hole, gate]));
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, 'Amplitude at basis ' + index));
};

test('the tutorial has at most fifteen steps and solves three circuits without changing official levels', () => {
  const saved = structuredClone(TUTORIAL_PUZZLES), official = structuredClone(LEVELS);
  assert.equal(TUTORIAL_PUZZLE, TUTORIAL_PUZZLES[0]);
  assert.deepEqual(TUTORIAL_PUZZLES.map(puzzle => puzzle.wires), [2, 2, 3]);
  assert.ok(TUTORIAL_STEPS.length <= 15);
  assert.ok(TUTORIAL_STEPS.every(step => Number.isInteger(step.chapter) && step.chapter >= 0 && step.chapter < TUTORIAL_PUZZLES.length));
  for (const [chapter, puzzle] of TUTORIAL_PUZZLES.entries()) {
    assert.deepEqual(validatePlayablePuzzle(puzzle), puzzle, 'Every worked example remains playable');
    assert.deepEqual(puzzle.target, goalState(puzzle.wires));
    const steps = stepsFor(chapter), actions = steps.filter(step => step.hole);
    assert.deepEqual(new Set(actions.map(step => step.hole)), new Set(getHoles(puzzle).map(hole => hole.id)));
    let placements = {};
    assert.equal(simulate(puzzle).solved, false);
    for (const step of steps) {
      assert.ok(step.text.length > 0 && step.text.length < 200);
      assert.ok(['circuit', 'paths'].includes(step.view));
      assert.ok(step.focus.wires.every(wire => Number.isInteger(wire) && wire >= 0 && wire < puzzle.wires));
      assert.ok(Number.isInteger(step.focus.column) && step.focus.column >= 0 && step.focus.column < puzzle.columns.length);
      if (step.hole) placements = applyPlacement(puzzle, placements, step);
    }
    assert.equal(simulate(puzzle, placements).solved, true, 'Chapter ' + chapter);
    assert.equal(stateEqual(simulate(puzzle, placements).state, puzzle.target), true);
  }
  assert.deepEqual(TUTORIAL_PUZZLES, saved);
  assert.deepEqual(LEVELS, official);
});

test('each bubble refers to existing bits, a gate, an amplitude, a wall, the goal or the memo', () => {
  let chapter = -1, placements = {};
  for (const step of TUTORIAL_STEPS) {
    if (step.chapter !== chapter) { chapter = step.chapter; placements = {}; }
    const puzzle = TUTORIAL_PUZZLES[chapter], trace = flowTrace(puzzle, placements);
    for (const anchor of [step.anchor, ...(step.gate ? [step.animationAnchor] : [])]) {
      assert.ok(anchor, step.text);
      assert.ok(['bits', 'gate', 'node', 'wall', 'goal', 'memo'].includes(anchor.kind));
      if (anchor.kind === 'gate') {
        if (anchor.hole) assert.ok(getHoles(puzzle).some(hole => hole.id === anchor.hole));
        else assert.ok(puzzle.columns[anchor.column].some(entry => entry.gate && entry.wires.every((wire, index) => wire === anchor.wires[index])));
      }
      else if (anchor.kind === 'bits') {
        assert.ok(anchor.basis >= 0 && anchor.basis < 2 ** puzzle.wires);
        assert.ok(anchor.wires.length && anchor.wires.every(wire => wire >= 0 && wire < puzzle.wires));
      } else if (anchor.kind === 'node') assert.ok(Math.abs(trace.snapshots[anchor.boundary][anchor.basis]) > 1e-9, step.text);
      else if (anchor.kind === 'wall') assert.ok(trace.cancellations[anchor.boundary - 1].includes(anchor.basis));
    }
    if (step.hole) placements = applyPlacement(puzzle, placements, step);
  }
});

test('the first two lessons connect qubit positions, basis labels and relative phases', () => {
  assert.ok(TUTORIAL_PUZZLES[0].columns.flat().every(entry => entry.id), 'The first circuit has no imposed gates');
  close(simulate(TUTORIAL_PUZZLES[0]).state, [1, 0, 0, 0]);
  close(simulate(TUTORIAL_PUZZLES[0], { a: 'X' }).state, [0, 0, 1, 0]);
  close(simulate(TUTORIAL_PUZZLES[0], { a: 'X', b: 'X' }).state, [0, 0, 0, 1]);
  const [introduction, observation] = stepsFor(0);
  assert.match(introduction.text, /goal of the game.*start at 00.*reach 11/);
  assert.deepEqual([introduction.hole, introduction.gate], ['a', 'X'], 'Next from the opening places the first NOT');
  assert.equal(introduction.view, 'paths');
  assert.deepEqual(introduction.animationAnchor, introduction.anchor, 'The first animation does not create a transient, relocated bubble');
  assert.match(observation.text, /10 instead of 00/);
  assert.equal(observation.gate, undefined, 'The result is a separate observation step, with no automatic next move');
  assert.equal(observation.view, 'paths');
  assert.deepEqual(observation.anchor, { kind: 'node', basis: 2, boundary: 1 });
  assert.deepEqual(stepsFor(0).at(-1).anchor, { kind: 'memo' }, 'The completed 11 pause introduces the gate memo');
  assert.equal(stepsFor(0).at(-1).gate, undefined);
  const fixedIntroduction = stepsFor(1)[0];
  assert.match(fixedIntroduction.text, /fixed/);
  assert.equal(fixedIntroduction.view, 'circuit');
  assert.deepEqual(fixedIntroduction.anchor, { kind: 'gate', column: 0, wires: [0] });
  const phase = TUTORIAL_PUZZLES[1], a = Math.SQRT1_2;
  close(flowTrace(phase).snapshots[1], [a, 0, a, 0]);
  close(simulate(phase, { a: 'Z' }).state, [a, 0, -a, 0]);
  const recombination = stepsFor(1).find(step => step.gate === 'H');
  assert.equal(recombination.view, 'paths');
  assert.deepEqual(recombination.anchor, { kind: 'node', basis: 2, boundary: 2 });
  close(simulate(phase, { a: 'Z', b: 'H' }).state, [0, 0, 1, 0]);
  close(simulate(phase, fillingFor(1)).state, [0, 0, 0, 1]);
});

test('tutorial gate animations leave time to follow each change, especially interference', () => {
  const actions = TUTORIAL_STEPS.filter(step => step.gate);
  assert.ok(actions.every(step => Number.isFinite(step.duration) && step.duration >= 650 && step.duration <= 1500));
  assert.ok(actions.filter(step => step.gate === 'H').every(step => step.duration > actions.find(step => step.gate === 'X').duration));
  assert.ok(TUTORIAL_STEPS.filter(step => !step.gate).every(step => !Object.hasOwn(step, 'duration')));
});

test('Step 5 explains the H rule once, before its later application', () => {
  const puzzle = TUTORIAL_PUZZLES[1], steps = stepsFor(1);
  assert.equal(steps[0], TUTORIAL_STEPS[4], 'The explanation is in Step 5');
  assert.match(steps[0].text, /input bit 0, both keep its colour/);
  assert.match(steps[0].text, /input bit 1, the lower branch swaps colour/);
  const phase = steps.findIndex(step => step.gate === 'Z');
  const whiteExample = steps[phase + 1];
  assert.equal(whiteExample.gate, 'H', 'The next action uses the newly white input');
  assert.match(whiteExample.text, /apply H again on the upper wire/);
  assert.deepEqual(whiteExample.anchor, { kind: 'node', basis: 2, boundary: 2 });
  const trace = flowTrace(puzzle, { a: 'Z', b: 'H' });
  assert.ok(trace.snapshots[2][2] < 0, 'The bubble points to a white input branch');
  for (const [input, signs] of [[0, [1, 1]], [2, [-1, 1]]]) {
    const branches = trace.columns[2].filter(edge => edge.from === input).sort((a, b) => a.to - b.to);
    assert.deepEqual(branches.map(edge => edge.to), [0, 2]);
    assert.deepEqual(branches.map(edge => Math.sign(edge.amplitude)), signs);
    close(branches.map(edge => Math.abs(edge.amplitude)), [0.5, 0.5]);
  }
});

test('the cancellation wall is explained before a later gate and has no outgoing amplitude', () => {
  const puzzle = TUTORIAL_PUZZLES[1], steps = stepsFor(1), solution = fillingFor(1);
  const wall = steps.findIndex(step => step.anchor.kind === 'wall');
  assert.ok(wall > steps.findIndex(step => step.gate === 'H'));
  assert.ok(wall < steps.findIndex(step => step.hole === 'c'));
  for (const placements of [{ a: 'Z', b: 'H' }, solution]) {
    const { columns, snapshots, cancellations } = flowTrace(puzzle, placements);
    assert.ok(cancellations[2].includes(0));
    const incoming = columns[2].filter(edge => edge.to === 0);
    assert.equal(incoming.length, 2);
    assert.ok(incoming.some(edge => edge.amplitude > 0) && incoming.some(edge => edge.amplitude < 0));
    assert.ok(Math.abs(incoming.reduce((sum, edge) => sum + edge.amplitude, 0)) < 1e-9);
    assert.ok(Math.abs(snapshots[3][0]) < 1e-9);
    assert.ok(!columns[3].some(edge => edge.from === 0));
  }
});

test('the last circuit demonstrates both CNOT directions and anchors CZ on its two bits', () => {
  const puzzle = TUTORIAL_PUZZLES[2], steps = stepsFor(2);
  close(simulate(puzzle).state, [0, 0, 0, 1, 0, 0, 0, 0]);
  close(simulate(puzzle, { a: 'CX' }).state, simulate(puzzle).state);
  assert.deepEqual(getHoles(puzzle)[0].wires, [0, 1]);
  close(simulate(puzzle, { a: 'CX', b: 'CX' }).state, [0, 0, 1, 0, 0, 0, 0, 0]);
  close(simulate(puzzle, { a: 'CX', b: 'CX', c: 'XC' }).state, [0, 0, 0, 0, 0, 0, 1, 0]);
  assert.match(steps.find(step => step.gate === 'XC').text, /NOTC on the first and second wires/);
  const cz = steps.find(step => step.gate === 'CZ');
  assert.deepEqual(cz.focus.wires, getHoles(puzzle).find(entry => entry.id === cz.hole).wires);
  assert.deepEqual(cz.anchor, { kind: 'bits', basis: 7, wires: [1, 2] });
  assert.equal(cz.view, 'paths');
  const before = simulate(puzzle, { a: 'CX', b: 'CX', c: 'XC', d: 'H' }).state;
  const after = simulate(puzzle, { a: 'CX', b: 'CX', c: 'XC', d: 'H', e: 'CZ' }).state;
  assert.ok(before[6] > 0 && before[7] > 0);
  assert.ok(after[6] > 0 && after[7] < 0);
  for (let basis = 0; basis < before.length; basis++) {
    assert.ok(Math.abs(after[basis] - before[basis] * ((basis & 3) === 3 ? -1 : 1)) < 1e-9);
  }
  const all = fillingFor(2);
  assert.equal(simulate(puzzle, all).solved, true);
  assert.equal(steps.at(-1).gate, 'H', 'Final interference reaches the goal without a finishing X');
  assert.ok(steps.every(step => step.gate !== 'X'));
  assert.ok(flowTrace(puzzle, all).cancellations.at(-1).includes(6), 'The final Hadamard cancels 110');
  delete all.f;
  close(simulate(puzzle, all).state, [0, 0, 0, 0, 0, 0, Math.SQRT1_2, -Math.SQRT1_2]);
});

test('the final worked circuit reaches the goal only after its last gate', () => {
  const puzzle = TUTORIAL_PUZZLES[2], steps = stepsFor(2);
  let placements = {};
  assert.equal(simulate(puzzle, placements).solved, false);
  for (const [index, step] of steps.entries()) {
    placements = applyPlacement(puzzle, placements, step);
    assert.equal(simulate(puzzle, placements).solved, index === steps.length - 1,
      `The third example must stay unfinished after action ${index + 1} until the final H`);
  }
});
