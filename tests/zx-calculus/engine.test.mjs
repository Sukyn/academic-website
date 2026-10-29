import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_NODES, MAX_EDGES, MAX_MOVES, RULES, LEVELS as LESSONS, TUTORIAL,
  validateDiagram, targetDiagram, availableMoves, applyMove, isSolved, generatePuzzle, ruleFamily,
} from '../../src/lib/zx-calculus/engine.js';
import solutions from '../../tools/zx-calculus/solutions.json' with { type: 'json' };

const LEVELS = LESSONS.map((level, index) => ({ ...level, solution: solutions[index] }));
const insert = (diagram, edge, kind = 'z') => applyMove(diagram, { rule: 'insert', edge, kind });
const identity = () => targetDiagram();
const solve = puzzle => puzzle.solution.reduce(applyMove, puzzle.diagram);

test('each equation direction shares one canonical rule family', () => {
  for (const rule of RULES) assert.equal(ruleFamily(rule.id), rule.id);
  for (const [inverse, family] of [['split', 'fusion'], ['insert', 'identity'], ['insert-hh', 'hh'], ['add-hopf', 'hopf']]) {
    assert.equal(ruleFamily(inverse), family);
  }
  for (const invalid of [undefined, null, {}, [], 0, true, '__proto__', 'constructor', 'toString', 'unknown']) {
    assert.equal(ruleFamily(invalid), undefined);
  }
});

// Independent tensor contraction of small diagrams, in the computational basis.
// Each internal edge is a binary summation variable; external bits are fixed.
// Z = |0...0> + i^phase |1...1>; X = H⊗degree Z; H is normalized.
function tensor(diagram) {
  assert.ok(diagram.edges.length <= 16, 'Keep this independent exponential oracle small.');
  const phases = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const legs = new Map(diagram.nodes.map(node => [node.id, []]));
  diagram.edges.forEach(([a, b], i) => { legs.get(a).push(i); legs.get(b).push(i); });
  const result = [];
  for (let outside = 0; outside < 16; outside++) {
    const bits = [], free = [];
    let compatible = true;
    diagram.edges.forEach(([a, b], i) => {
      const boundary = a < 4 ? a : b < 4 ? b : null;
      if (boundary === null) free.push(i);
      else {
        bits[i] = outside >> boundary & 1;
        if (a < 4 && b < 4 && bits[i] !== (outside >> b & 1)) compatible = false;
      }
    });
    let sumR = 0, sumI = 0;
    if (compatible) for (let assignment = 0; assignment < 2 ** free.length; assignment++) {
      free.forEach((edge, bit) => { bits[edge] = assignment >> bit & 1; });
      let productR = 1, productI = 0;
      for (const node of diagram.nodes) {
        if (node.kind === 'boundary') continue;
        const values = legs.get(node.id).map(edge => bits[edge]);
        const [angleR, angleI] = phases[node.phase ?? 0];
        let r, i;
        if (node.kind === 'h') {
          r = (values[0] && values[1] ? -1 : 1) / Math.SQRT2;
          i = 0;
        } else if (node.kind === 'z') {
          if (!values.length) { r = 1 + angleR; i = angleI; }
          else if (values.some(bit => bit !== values[0])) { r = 0; i = 0; }
          else { r = values[0] ? angleR : 1; i = values[0] ? angleI : 0; }
        } else {
          const sign = values.reduce((parity, bit) => parity ^ bit, 0) ? -1 : 1;
          const normal = 2 ** (-values.length / 2);
          r = (1 + sign * angleR) * normal;
          i = sign * angleI * normal;
        }
        [productR, productI] = [productR * r - productI * i, productR * i + productI * r];
        if (Math.abs(productR) + Math.abs(productI) < 1e-15) break;
      }
      sumR += productR;
      sumI += productI;
    }
    result.push([sumR, sumI]);
  }
  return result;
}

function assertEquivalent(before, after, message = '') {
  const a = tensor(before), b = tensor(after);
  const pivot = a.findIndex(([r, i]) => Math.hypot(r, i) > 1e-8);
  if (pivot < 0) {
    assert.ok(b.every(([r, i]) => Math.hypot(r, i) < 1e-8), message);
    return;
  }
  const [ar, ai] = a[pivot], [br, bi] = b[pivot], norm = ar * ar + ai * ai;
  const scaleR = (br * ar + bi * ai) / norm, scaleI = (bi * ar - br * ai) / norm;
  assert.ok(Math.hypot(scaleR, scaleI) > 1e-8, 'The proportionality scalar must be nonzero.');
  for (let n = 0; n < a.length; n++) {
    const [r, i] = a[n];
    assert.ok(Math.hypot(b[n][0] - (scaleR * r - scaleI * i), b[n][1] - (scaleR * i + scaleI * r)) < 1e-8, `${message}; coefficient ${n}`);
  }
}

test('the fixed goal is two labelled identity wires', () => {
  const target = identity();
  assert.equal(isSolved(target), true);
  assert.deepEqual(tensor(target), Array.from({ length: 16 }, (_, bits) => [
    (bits & 1) === (bits >> 2 & 1) && (bits >> 1 & 1) === (bits >> 3 & 1) ? 1 : 0, 0,
  ]));
  assert.equal(isSolved({ ...target, edges: [[0, 3], [1, 2]] }), false, 'a SWAP is not the target');
  assert.equal(isSolved(insert(target, [0, 2])), false, 'semantic equivalence alone does not complete a simplification');
});

test('validation detaches and normalizes without dropping parallel wires', () => {
  const input = { nodes: [{ id: 5, kind: 'x', phase: 0 }, { id: 4, kind: 'z' }, ...identity().nodes].reverse(), edges: [[4, 0], [2, 4], [5, 1], [3, 5], [5, 4], [4, 5]] };
  const diagram = validateDiagram(input);
  assert.deepEqual(diagram.edges, [[0, 4], [1, 5], [2, 4], [3, 5], [4, 5], [4, 5]]);
  assert.equal('phase' in diagram.nodes.find(node => node.id === 5), false);
  diagram.nodes[4].kind = 'h';
  diagram.edges[0][0] = 100;
  assert.equal(input.nodes.find(node => node.id === 4).kind, 'z');
  assert.ok(input.edges.every(edge => !edge.includes(100)));
});

test('malformed diagrams and oversized inputs are rejected', () => {
  const target = identity();
  const malformed = [
    null, [], {}, { ...target, ignored: 'metadata' },
    { ...target, nodes: [...target.nodes, target.nodes[0]] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'boundary' }] },
    { ...target, nodes: target.nodes.filter(node => node.id !== 0) },
    { ...target, nodes: [...target.nodes, { id: -1, kind: 'z' }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: '<script>' }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'z', phase: 0.5 }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'z', phase: 4 }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'h', phase: 0 }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'h' }] },
    { ...target, nodes: [...target.nodes, { id: 4, kind: 'z', x: 2 }] },
    { ...target, edges: [[0, 0], [1, 3]] },
    { ...target, edges: [[0, 9], [1, 3]] },
    { ...target, edges: [[0, 2], [0, 3], [1, 3]] },
    { ...target, edges: new Array(MAX_EDGES + 1).fill([0, 2]) },
    { ...target, nodes: Array.from({ length: MAX_NODES + 1 }, (_, id) => ({ id, kind: id < 4 ? 'boundary' : 'z' })) },
  ];
  for (const input of malformed) assert.throws(() => validateDiagram(input), RangeError);
});

test('spider fusion adds phases modulo 2π and preserves all external legs', () => {
  let before = insert(identity(), [0, 2]);
  before = applyMove(before, { rule: 'split', nodes: [4], phase: 3 });
  const after = applyMove(before, { rule: 'fusion', nodes: [5, 4] });
  assertEquivalent(before, after);
  assert.equal(after.nodes.find(node => node.id === 4).phase, undefined);
  assert.equal(after.nodes.some(node => node.id === 5), false);
  assert.equal(isSolved(applyMove(after, { rule: 'identity', nodes: [4] })), true);
});

test('colour change adds Hadamards, then absorbs them when every leg has one', () => {
  let diagram = insert(identity(), [0, 2], 'z');
  diagram = insert(diagram, [1, 3], 'x');
  diagram = applyMove(diagram, { rule: 'add-hopf', nodes: [4, 5] });
  const changed = applyMove(diagram, { rule: 'color', nodes: [4] });
  assert.equal(changed.nodes.filter(node => node.kind === 'h').length, 4);
  assertEquivalent(diagram, changed);
  assert.deepEqual(applyMove(changed, { rule: 'color', nodes: [4] }), diagram);
  assert.equal(availableMoves(changed).filter(move => move.rule === 'color' && move.nodes[0] === 4).length, 1,
    'The absorbing and expanding directions never compete');
  const withPair = applyMove(changed, { rule: 'insert-hh', edge: changed.edges[0] });
  const ids = withPair.nodes.filter(node => !changed.nodes.some(old => old.id === node.id)).map(node => node.id);
  assertEquivalent(changed, withPair);
  assert.deepEqual(applyMove(withPair, { rule: 'hh', nodes: ids }), changed);
});

test('expansion matches have sound inverse rewrites and restore canonical diagrams', () => {
  for (const kind of ['z', 'x']) for (let phase = 0; phase < 4; phase++) {
    const before = validateDiagram({
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: kind === 'z' ? 'x' : 'z' }],
      edges: [[0, 4], [4, 2], [1, 5], [5, 3]],
    });
    const matches = availableMoves(before, { expand: true });
    assert.ok(availableMoves(before).every(move => RULES.some(rule => rule.id === move.rule)), 'The default match list remains the simplifying directions.');
    for (const move of matches.filter(move => ['insert', 'insert-hh', 'split', 'add-hopf'].includes(move.rule))) {
      const after = applyMove(before, move), added = after.nodes.filter(node => !before.nodes.some(old => old.id === node.id)).map(node => node.id);
      const inverse = move.rule === 'insert' ? { rule: 'identity', nodes: added } :
        move.rule === 'insert-hh' ? { rule: 'hh', nodes: added } :
        move.rule === 'split' ? { rule: 'fusion', nodes: [...move.nodes, ...added] } : { rule: 'hopf', nodes: move.nodes };
      assert.equal(ruleFamily(inverse.rule), ruleFamily(move.rule));
      assertEquivalent(before, after, `Expansion ${JSON.stringify(move)}`);
      assert.deepEqual(applyMove(after, inverse), before, `Undo ${JSON.stringify(move)}`);
    }
  }
});

test('splitting and fusing remain sound when a free lower node ID is reused', () => {
  const before = {
    nodes: [...identity().nodes, { id: 19, kind: 'x', phase: 3 }],
    edges: [[0, 19], [2, 19], [1, 3]],
  };
  const split = applyMove(before, { rule: 'split', nodes: [19], phase: 2 });
  assert.ok(split.nodes.some(node => node.id === 4));
  const merged = applyMove(split, { rule: 'fusion', nodes: [19, 4] });
  assertEquivalent(before, split);
  assertEquivalent(before, merged);
  assert.deepEqual(merged, validateDiagram({
    nodes: [...identity().nodes, { id: 4, kind: 'x', phase: 3 }],
    edges: [[0, 4], [2, 4], [1, 3]],
  }));
});

function colourSurroundings(kind, phase) {
  return [
    {
      nodes: [...identity().nodes, { id: 4, kind, phase }],
      edges: [[0, 4], [2, 4], [1, 3]],
    },
    {
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: 'h' }, { id: 6, kind: kind === 'z' ? 'x' : 'z', phase: 2 }],
      edges: [[0, 4], [2, 5], [4, 5], [1, 6], [3, 6], [4, 6], [4, 6]],
    },
    {
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' }],
      edges: [[0, 4], [2, 4], [1, 3], [4, 5], [5, 6], [4, 6]],
    },
    {
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: 'h' }],
      edges: [[0, 4], [2, 4], [1, 3], [4, 5], [4, 5]],
    },
    {
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: kind === 'z' ? 'x' : 'z' }],
      edges: [[0, 4], [2, 4], [1, 5], [3, 5], [4, 5], [4, 5]],
    },
  ];
}

test('a partial Hadamard surround expands every leg across phases, parallel wires and loops', () => {
  for (const kind of ['z', 'x']) for (let phase = 0; phase < 4; phase++) for (const diagram of colourSurroundings(kind, phase)) {
    const before = validateDiagram(diagram), changed = applyMove(before, { rule: 'color', nodes: [4] });
    const existing = before.nodes.filter(node => node.kind === 'h');
    const degree = before.edges.filter(edge => edge.includes(4)).length;
    assert.equal(changed.nodes.filter(node => node.kind === 'h').length, existing.length + degree);
    assert.equal(changed.edges.length, before.edges.length + degree, 'Each incident edge is subdivided once');
    for (const node of before.nodes) if (node.id !== 4) assert.deepEqual(changed.nodes.find(other => other.id === node.id), node);
    assert.equal(changed.nodes.find(node => node.id === 4).kind, kind === 'z' ? 'x' : 'z');
    assert.equal(changed.nodes.find(node => node.id === 4).phase ?? 0, phase);
    assertEquivalent(before, changed, `${kind} phase ${phase}: adding H preserves the tensor`);
    assert.deepEqual(applyMove(changed, { rule: 'color', nodes: [4] }), before);
  }
});

test('a complete Hadamard surround absorbs exactly one layer and preserves phases', () => {
  for (const kind of ['z', 'x']) for (let phase = 0; phase < 4; phase++) {
    const before = validateDiagram({
      nodes: [...identity().nodes, { id: 4, kind, phase }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' },
        { id: 7, kind: 'h' }, { id: 8, kind: 'h' }],
      edges: [[0, 5], [4, 5], [4, 6], [6, 2], [1, 3], [4, 7], [7, 8], [4, 8]],
    });
    const changed = applyMove(before, { rule: 'color', nodes: [4] });
    assert.equal(changed.nodes.filter(node => node.kind === 'h').length, 0);
    assert.equal(changed.nodes.find(node => node.id === 4).kind, kind === 'z' ? 'x' : 'z');
    assert.equal(changed.nodes.find(node => node.id === 4).phase ?? 0, phase);
    assertEquivalent(before, changed, `${kind} phase ${phase}: full-surround absorption`);
  }
});

test('a Hadamard joined to the same spider twice remains an odd-H loop during absorption', () => {
  for (const phase of [0, 1, 2, 3]) {
    const before = validateDiagram({
      nodes: [...identity().nodes, { id: 4, kind: 'z', phase }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' }, { id: 7, kind: 'h' }],
      edges: [[0, 5], [4, 5], [4, 6], [6, 2], [1, 3], [4, 7], [4, 7]],
    });
    const changed = applyMove(before, { rule: 'color', nodes: [4] });
    assert.deepEqual(changed.nodes.filter(node => node.kind === 'h').map(node => node.id), [7]);
    assert.equal(changed.edges.filter(edge => edge[0] === 4 && edge[1] === 7).length, 2);
    assertEquivalent(before, changed, `Odd-H loop phase ${phase}`);
  }
});

test('absorption remains available at the node limit and consumes only the adjacent H layer', () => {
  const before = validateDiagram({
    nodes: Array.from({ length: MAX_NODES }, (_, id) => ({ id, kind: id < 4 ? 'boundary' : [5, 6, 7, 8].includes(id) ? 'h' : 'z' })),
    edges: [[0, 7], [7, 5], [5, 4], [4, 6], [6, 8], [8, 2], [1, 3]],
  });
  const changed = applyMove(before, { rule: 'color', nodes: [4] });
  assert.equal(changed.nodes.length, MAX_NODES - 2);
  assert.deepEqual(changed.nodes.filter(node => node.kind === 'h').map(node => node.id), [7, 8]);
  assert.equal(availableMoves(before).filter(move => move.rule === 'color' && move.nodes[0] === 4).length, 1);
  assertEquivalent(before, changed);
});

test('colour growth respects node and edge limits without consuming existing Hadamards', () => {
  const fullNodes = {
    nodes: Array.from({ length: MAX_NODES }, (_, id) => ({ id, kind: id < 4 ? 'boundary' : id === 5 ? 'h' : 'z' })),
    edges: [[0, 4], [4, 5], [2, 5], [1, 3]],
  };
  const fullEdges = {
    nodes: [...identity().nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'z' }, { id: 6, kind: 'x' }],
    edges: [[0, 4], [2, 4], [1, 5], [3, 6], ...Array.from({ length: MAX_EDGES - 4 }, () => [5, 6])],
  };
  for (const input of [fullNodes, fullEdges]) {
    const saved = structuredClone(input);
    assert.throws(() => applyMove(input, { rule: 'color', nodes: [4] }), RangeError);
    assert.equal(availableMoves(input).some(move => move.rule === 'color' && move.nodes[0] === 4), false);
    assert.deepEqual(input, saved);
  }
});

test('partial Hadamard surrounds and contracting spider loops remain sound', () => {
  const diagrams = colourSurroundings('z', 1);
  for (const diagram of diagrams) for (const move of availableMoves(diagram)) {
    assertEquivalent(diagram, applyMove(diagram, move), JSON.stringify(move));
  }
});

test('closed Hadamard pairs represent removable nonzero scalars', () => {
  const diagram = {
    nodes: [...identity().nodes, { id: 4, kind: 'h' }, { id: 5, kind: 'h' }],
    edges: [...identity().edges, [4, 5], [4, 5]],
  };
  const after = applyMove(diagram, { rule: 'hh', nodes: [4, 5] });
  assertEquivalent(diagram, after);
  assert.equal(isSolved(after), true);
});

test('fusion and identity contraction can close an ordinary spider loop', () => {
  const diagrams = [
    {
      nodes: [...identity().nodes, { id: 4, kind: 'z', phase: 1 }, { id: 5, kind: 'x' }],
      edges: [[0, 4], [2, 4], [1, 3], [4, 5], [4, 5]],
    },
    {
      nodes: [...identity().nodes, { id: 4, kind: 'x', phase: 1 }, { id: 5, kind: 'x', phase: 3 }],
      edges: [[0, 4], [2, 4], [1, 3], [4, 5], [4, 5]],
    },
  ];
  for (const diagram of diagrams) for (const move of availableMoves(diagram)) {
    assertEquivalent(diagram, applyMove(diagram, move), JSON.stringify(move));
  }
});

test('Hopf removes exactly two opposite-colour links, including phased spiders', () => {
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    const before = {
      nodes: [...identity().nodes, { id: 4, kind: 'z', phase: a }, { id: 5, kind: 'x', phase: b }],
      edges: [[0, 4], [2, 4], [1, 5], [3, 5], [4, 5], [4, 5]],
    };
    const after = applyMove(before, { rule: 'hopf', nodes: [4, 5] });
    assert.equal(after.edges.length, 4);
    assertEquivalent(before, after, `Hopf phases ${a}, ${b}`);
  }
});

test('all offered local rewrites agree with independent tensor contraction', () => {
  for (let seed = 0; seed < 12; seed++) {
    let diagram = identity();
    for (let step = 0; step < 5; step++) {
      const choices = availableMoves(diagram, { expand: true }).filter(move => {
        const result = applyMove(diagram, move);
        return result.edges.length <= 11 && result.nodes.length <= 11;
      });
      const move = choices[(seed * 7 + step * 13) % choices.length];
      const after = applyMove(diagram, move);
      assertEquivalent(diagram, after, `seed ${seed} step ${step} ${JSON.stringify(move)}`);
      diagram = after;
      for (const local of availableMoves(diagram)) assertEquivalent(diagram, applyMove(diagram, local), JSON.stringify(local));
    }
  }
});

test('moves and match discovery do not mutate their input', () => {
  const diagram = structuredClone(TUTORIAL.diagram), before = JSON.stringify(diagram);
  const moves = availableMoves(diagram, { expand: true });
  for (const move of moves) applyMove(diagram, move);
  assert.equal(JSON.stringify(diagram), before);
  const splits = availableMoves(diagram, { expand: true }).filter(move => move.rule === 'split' && move.nodes[0] === 4);
  assert.deepEqual(splits.map(move => move.phase), [0, 1, 2, 3]);
});

test('illegal rule matches and unexpected move data are rejected', () => {
  const diagram = insert(identity(), [0, 2]);
  for (const move of [
    null, {}, { rule: 'unknown' }, { rule: 'fusion', nodes: [4, 4] },
    { rule: 'identity', nodes: [0] }, { rule: 'identity', nodes: [4], ignored: true },
    { rule: 'identity', nodes: [] }, { rule: 'color', nodes: [100] },
    { rule: 'hh', nodes: [0, 4] }, { rule: 'hopf', nodes: [0, 4] },
    { rule: 'split', nodes: [4], phase: -1 }, { rule: 'split', nodes: [4], phase: 1.5 },
    { rule: 'insert', edge: [0, 3], kind: 'x' }, { rule: 'insert', edge: [0, 4], kind: 'h' },
    { rule: 'insert-hh', edge: [0, 4], kind: 'z' },
  ]) assert.throws(() => applyMove(diagram, move), RangeError);
});

test('official lessons have progressively introduced rules and valid witnesses', () => {
  assert.ok(LEVELS.length >= 8);
  assert.equal(solutions.length, LESSONS.length);
  assert.ok(LESSONS.every(level => !Object.hasOwn(level, 'solution')), 'Official solutions stay out of client puzzle data.');
  let introduced = new Set();
  for (const level of LEVELS) {
    assert.ok(level.title.length > 0 && level.title.length < 60);
    assert.ok(!isSolved(level.diagram));
    assert.equal(isSolved(solve(level)), true, level.title);
    assert.ok(level.solution.length <= MAX_MOVES);
    assert.ok([...introduced].every(rule => level.rules.includes(rule)));
    assert.ok(level.solution.every(move => level.rules.includes(move.rule)));
    introduced = new Set(level.rules);
  }
  assert.deepEqual([...introduced].sort(), RULES.map(rule => rule.id).sort());
  assert.deepEqual(TUTORIAL.solution.slice(0, 2).map(move => move.rule), ['fusion', 'identity']);
  assert.deepEqual([...new Set(TUTORIAL.solution.map(move => move.rule))].sort(), RULES.map(rule => rule.id).sort());
  assert.equal(isSolved(solve(TUTORIAL)), true);
});

test('deterministic random puzzles stay bounded, varied and reachable', () => {
  const fingerprints = new Set(), usedRules = new Set(), complexity = [0, 0, 0];
  for (let seed = 0; seed < 60; seed++) for (let difficulty = 1; difficulty <= 3; difficulty++) {
    const puzzle = generatePuzzle(`zx-${seed}`, difficulty);
    assert.deepEqual(puzzle, generatePuzzle(`zx-${seed}`, difficulty));
    assert.ok(puzzle.diagram.nodes.length <= MAX_NODES);
    assert.ok(puzzle.diagram.edges.length <= MAX_EDGES);
    assert.ok(puzzle.solution.length <= MAX_MOVES);
    assert.equal(isSolved(puzzle.diagram), false);
    assert.equal(isSolved(solve(puzzle)), true, `seed ${seed}, difficulty ${difficulty}`);
    puzzle.solution.forEach(move => usedRules.add(move.rule));
    fingerprints.add(JSON.stringify(puzzle.diagram));
    complexity[difficulty - 1] += puzzle.diagram.nodes.length + puzzle.diagram.edges.length;
  }
  assert.ok(fingerprints.size >= 150, `${fingerprints.size}/180 different diagrams`);
  assert.deepEqual([...usedRules].sort(), RULES.map(rule => rule.id).sort());
  assert.ok(complexity[0] < complexity[1] && complexity[1] < complexity[2]);
});

test('random generator rejects invalid seeds and difficulties', () => {
  for (const seed of [null, {}, [], NaN, Infinity, 1.5, 'x'.repeat(101)]) assert.throws(() => generatePuzzle(seed), RangeError);
  for (const difficulty of [null, 0, 4, 1.5, '2']) assert.throws(() => generatePuzzle('seed', difficulty), RangeError);
});
