import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlacement, controlWire, getHoles, puzzleData,
  simulate, solvePuzzle, stateEqual, goalState, validateCustomPuzzle,
  validatePlacements, validatePlayablePuzzle, validatePuzzle,
} from '../../src/lib/quantum-signals/engine.js';
import { LEVELS } from '../../src/lib/quantum-signals/puzzles.js';

const fixed = (gate, ...wires) => ({ gate, wires });
const hole = (id, wires, choices = ['I', 'H', 'X', 'Z']) => ({ id, wires, choices });
function fixture(wires, columns) {
  return { wires, columns: [...columns, [hole('spare', [0], ['I', 'X'])]] };
}
const run = (wires, columns) => simulate(fixture(wires, columns), { spare: 'I' });

// Independent dense operators provide a second evaluator, including arbitrary
// control directions. The game evaluates pairs in place; this multiplies a full
// matrix for each gate, with explicit amplitudes for both Hadamard branches.
function reference(puzzle, placements) {
  const size = 2 ** puzzle.wires;
  let state = [1, ...Array(size - 1).fill(0)];
  for (const entry of puzzle.columns.flat()) {
    const gate = entry.gate ?? placements[entry.id] ?? 'I';
    const a = 2 ** (puzzle.wires - entry.wires[gate === 'XC' ? 1 : 0] - 1);
    const b = 2 ** (puzzle.wires - entry.wires[gate === 'XC' ? 0 : 1] - 1);
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    for (let source = 0; source < size; source++) {
      if (gate === 'H') {
        matrix[source][source] = source & a ? -Math.SQRT1_2 : Math.SQRT1_2;
        matrix[source ^ a][source] = Math.SQRT1_2;
      } else {
        const destination = gate === 'X' ? source ^ a : (gate === 'CX' || gate === 'XC') && (source & a) ? source ^ b : source;
        matrix[destination][source] = (gate === 'Z' && (source & a)) || (gate === 'CZ' && (source & a) && (source & b)) ? -1 : 1;
      }
    }
    state = matrix.map(row => row.reduce((sum, value, index) => sum + value * state[index], 0));
  }
  return state;
}

test('Classical bits, Hadamard interference and local phase have the expected amplitudes', () => {
  assert.deepEqual(run(1, [[fixed('X', 0)]]).state, [0, 1]);
  assert.deepEqual(run(2, [[fixed('X', 0)]]).state, [0, 0, 1, 0]);
  assert.ok(stateEqual(run(1, [[fixed('H', 0)], [fixed('H', 0)]]).state, [1, 0]));
  const minus = run(1, [[fixed('H', 0)], [fixed('Z', 0)]]);
  assert.ok(stateEqual(minus.state, [Math.SQRT1_2, -Math.SQRT1_2]));
  assert.ok(stateEqual(run(1, [[fixed('H', 0)], [fixed('Z', 0)], [fixed('H', 0)]]).state, [0, 1]));
  assert.ok(stateEqual(run(1, [[fixed('H', 0)]]).state, [Math.SQRT1_2, Math.SQRT1_2]));
});

test('Bell correlations and relative phase survive reversible entanglement', () => {
  const bell = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)]]);
  const phased = run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)], [fixed('Z', 1)]]);
  assert.ok(stateEqual(bell.state, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  assert.ok(!stateEqual(bell.state, phased.state));
  assert.ok(stateEqual(bell.state, bell.state.map(value => -value)));
  assert.deepEqual(phased.state.map(amplitude => amplitude ** 2), bell.state.map(amplitude => amplitude ** 2),
    'Relative phase changes interference without changing measurement probabilities.');
  assert.ok(stateEqual(run(2, [[fixed('H', 0)], [fixed('CX', 0, 1)], [fixed('CX', 0, 1)], [fixed('H', 0)]]).state, [1, 0, 0, 0]));
});

test('Both CNOT directions and controlled phase respect the declared wire order', () => {
  assert.deepEqual(run(2, [[fixed('X', 1)], [fixed('CX', 1, 0)]]).state, [0, 0, 0, 1]);
  assert.deepEqual(run(2, [[fixed('X', 1)], [fixed('CX', 0, 1)]]).state, [0, 1, 0, 0]);
  const graph = run(2, [[fixed('H', 0), fixed('H', 1)], [fixed('CZ', 0, 1)]]);
  assert.ok(stateEqual(graph.state, [.5, .5, .5, -.5]));
});

test('CX and XC truth tables cover both directions on reversed and nonadjacent wire pairs', () => {
  for (const wires of [[0, 3], [3, 0], [1, 2], [2, 1]]) for (const gate of ['CX', 'XC']) {
    const control = wires[gate === 'XC' ? 1 : 0], target = wires[gate === 'XC' ? 0 : 1];
    assert.equal(controlWire(gate, wires), control);
    for (let basis = 0; basis < 16; basis++) {
      const prepare = Array.from({ length: 4 }, (_, row) => row).filter(row => basis & (1 << (3 - row))).map(row => fixed('X', row));
      const result = run(4, [prepare, [fixed(gate, ...wires)]]);
      const destination = basis & (1 << (3 - control)) ? basis ^ (1 << (3 - target)) : basis;
      assert.deepEqual(result.state, Array.from({ length: 16 }, (_, index) => index === destination ? 1 : 0), `${gate} on ${wires}, input ${basis}`);
    }
  }
});

test('the fixed goal is the all-ones computational basis state for every supported wire count', () => {
  for(let wires=1;wires<=4;wires++) {
    const goal=goalState(wires);
    assert.equal(goal.length,2**wires);
    assert.deepEqual(goal.slice(0,-1),Array(2**wires-1).fill(0));
    assert.equal(goal.at(-1),1);
    goal[0]=99; assert.equal(goalState(wires)[0],0);
  }
  for(const wires of [0,5,1.5,'2',null])assert.throws(()=>goalState(wires),RangeError);
});

test('placements can be changed and erased, while the derived goal never moves', () => {
  const puzzle=validatePuzzle({wires:1,columns:[[hole('a',[0],['I','X'])]]}), saved=structuredClone(puzzle);
  assert.equal(simulate(puzzle).solved,false);
  const chosen=applyPlacement(puzzle,{}, {hole:'a',gate:'X'});
  assert.equal(simulate(puzzle,chosen).solved,true);
  assert.equal(simulate(puzzle,applyPlacement(puzzle,chosen,{hole:'a',gate:'I'})).solved,false);
  assert.deepEqual(applyPlacement(puzzle,chosen,{hole:'a',gate:null}),{});
  assert.deepEqual(puzzle,saved);
  const already={wires:1,columns:[[fixed('X',0)],[hole('bait',[0],['I','Z'])]]};
  assert.equal(simulate(already).solved,true,'An optional hole is the identity by default.');
});

test('paired holes preserve reversed control direction through minimal custom JSON', () => {
  const puzzle={wires:2,columns:[[fixed('X',0)],[hole('a',[1,0],['I','CX','XC','CZ'])]]};
  assert.equal(simulate(puzzle,{a:'XC'}).solved,true);
  assert.equal(simulate(puzzle,{a:'CX'}).solved,false);
  const source=puzzleData(puzzle), saved=structuredClone(source), restored=validateCustomPuzzle(source);
  assert.deepEqual(Object.keys(source),['wires','columns']);
  assert.deepEqual(source.columns[1][0],{wires:[1,0],choices:['I','CX','XC','CZ']});
  assert.equal(simulate(restored,solvePuzzle(restored,{limit:1})[0]).solved,true);
  restored.columns[1][0].choices.push('X');restored.target[0]=99;
  assert.deepEqual(source,saved);
});

test('custom files omit targets and stable hole identifiers and reject target overrides', () => {
  const source={wires:1,columns:[[{wires:[0],choices:['I','X']}]]};
  const puzzle=validateCustomPuzzle(source);
  assert.deepEqual(puzzle.target,[0,1]);
  assert.equal(getHoles(puzzle)[0].id,'h1');
  assert.deepEqual(puzzleData(puzzle),source);
  for(const target of [{1:1},[0,1],[1,0],[Math.SQRT1_2,Math.SQRT1_2],null]){
    assert.throws(()=>validateCustomPuzzle({...source,target}),RangeError);
  }
  assert.throws(()=>validateCustomPuzzle({wires:1,columns:[[{wires:[0],choices:['I','Z']}]]}),/cannot be reached/);
});

test('playable and custom circuits allow fixed gates around holes and on other wires in the same column', () => {
  const input = { wires: 2, columns: [
    [fixed('H', 0), fixed('X', 1)],
    [hole('phase', [0], ['I', 'Z']), fixed('Z', 1)],
    [fixed('H', 0)],
  ] };
  const saved = structuredClone(input), puzzle = validatePlayablePuzzle(input);
  assert.deepEqual(solvePuzzle(puzzle, { limit: 2 }), [{ phase: 'Z' }]);
  assert.equal(simulate(puzzle).solved, false);
  assert.equal(simulate(puzzle, { phase: 'Z' }).solved, true);
  assert.ok(stateEqual(reference(puzzle, { phase: 'Z' }), puzzle.target));
  const data = puzzleData(puzzle), restored = validateCustomPuzzle(data);
  assert.deepEqual(puzzleData(restored), data);
  assert.equal(simulate(restored, { h1: 'Z' }).solved, true);
  assert.deepEqual(input, saved);
  const unreachable = { wires: 1, columns: [[fixed('H', 0)], [hole('a', [0], ['I', 'X'])], [fixed('H', 0)]] };
  assert.throws(() => validatePlayablePuzzle(unreachable), /cannot be reached/);
  assert.throws(() => validateCustomPuzzle(puzzleData(unreachable)), /cannot be reached/);
});

test('puzzle and placement validation reject malformed, oversized and forged inputs', () => {
  const base={wires:1,columns:[[hole('a',[0])]]};
  for(const input of [null,[],{}, {...base,wires:0},{...base,wires:5},{...base,columns:[]},
    {...base,columns:Array(17).fill([])}, {...base,columns:[[fixed('BAD',0)],[hole('a',[0])]]},
    {...base,columns:[[hole('a',[1])]]}, {...base,columns:[[hole('a',[0]),hole('b',[0])]]},
    {...base,columns:[[hole('a',[0],['I','I'])]]}, {...base,columns:[[hole('a',[0],['I','CX'])]]},
    {...base,columns:Array.from({length:7},(_,i)=>[hole('h'+i,[0])])},
    {...base,target:[1,0]}, {...base,target:[NaN,1]}, {...base,target:Array(2).fill(Math.SQRT1_2)},
  ])assert.throws(()=>validatePuzzle(input),RangeError);
  for(const placements of [null,[],{unknown:'X'},{a:'CZ'},{a:42}])assert.throws(()=>validatePlacements(validatePuzzle(base),placements),RangeError);
  for(const move of [null,{}, {hole:'unknown',gate:'X'},{hole:'a',gate:'CZ'}])assert.throws(()=>applyPlacement(validatePuzzle(base),{},move),RangeError);
  for(const limit of [0,-1,4097,1.5,Infinity])assert.throws(()=>solvePuzzle(base,{limit}),RangeError);
});

test('every named lesson reaches all ones and has no identity bait', () => {
  assert.equal(LEVELS.length,12);
  assert.equal(new Set(LEVELS.map(level=>level.title)).size,12);
  for(const puzzle of LEVELS) {
    assert.deepEqual(puzzle.target,goalState(puzzle.wires));
    assert.equal(simulate(puzzle).solved,false,puzzle.title);
    const solutions=solvePuzzle(puzzle,{limit:4096});
    assert.ok(solutions.length,puzzle.title);
    for(const solution of solutions) {
      assert.ok(Object.values(solution).every(gate=>gate!=='I'),puzzle.title);
      assert.equal(simulate(puzzle,solution).solved,true);
      assert.ok(stateEqual(reference(puzzle,solution),goalState(puzzle.wires)));
    }
  }
});
