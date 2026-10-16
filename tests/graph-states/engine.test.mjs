import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyMove, correctionColumns, graphsAtDistance, isSolved, optimalShots, pathGraph, puzzleData, sequenceCost, solutionForGraph, validateGraph } from '../../src/lib/graph-states/engine.js';
import { DAILY_START, LEVELS, dailyPuzzle, generatePuzzle } from '../../src/lib/graph-states/puzzles.js';
import { TUTORIAL } from '../../src/lib/graph-states/tutorial.js';
import { seededRandom } from '../../src/lib/games/random.js';

function allEdges(vertices) {
  const edges = [];
  for (let u = 0; u < vertices; u++) for (let v = u + 1; v < vertices; v++) edges.push([u, v]);
  return edges;
}

function graphState(graph) {
  // Independent definition: prepare |+>^n and apply CZ on each edge.
  const scale = 1 / Math.sqrt(2 ** graph.vertices);
  return Array.from({ length: 2 ** graph.vertices }, (_, basis) => {
    const parity = graph.edges.reduce((sum, [u, v]) => sum + ((basis >> u & 1) * (basis >> v & 1)), 0);
    return [(parity % 2 ? -1 : 1) * scale, 0];
  });
}

function applyCorrection(state, columns) {
  const result = state.map(amplitude => [...amplitude]);
  for (const column of columns) for (const { gate, wires: [wire] } of column) {
    const bit = 1 << wire;
    for (let a = 0; a < result.length; a++) {
      if (a & bit) continue;
      const b = a | bit, [ar, ai] = result[a], [br, bi] = result[b];
      if (gate === 'H') {
        result[a] = [(ar + br) / Math.SQRT2, (ai + bi) / Math.SQRT2];
        result[b] = [(ar - br) / Math.SQRT2, (ai - bi) / Math.SQRT2];
      } else if (gate === 'S') result[b] = [-bi, br];
      else if (gate === 'SDG') result[b] = [bi, -br];
      else assert.fail(`Unknown correction gate ${gate}`);
    }
  }
  return result;
}

function sameStateUpToPhase(actual, expected) {
  const [rr, ri] = actual[0].map(value => value / expected[0][0]);
  assert.ok(Math.abs(rr * rr + ri * ri - 1) < 1e-10);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(Math.abs(actual[index][0] - expected[index][0] * rr) < 1e-10);
    assert.ok(Math.abs(actual[index][1] - expected[index][0] * ri) < 1e-10);
  }
}

test('graph imports are canonical, detached and reject malformed or unreachable graphs', () => {
  const source = { vertices: 3, edges: [[2, 1], [1, 0]] }, graph = validateGraph(source);
  assert.deepEqual(graph, pathGraph(3));
  source.edges[0][0] = 0;
  assert.deepEqual(graph.edges, [[0, 1], [1, 2]]);
  for (const value of [null, [], {}, { vertices: 2, edges: [] }, { vertices: 9, edges: [] },
    { vertices: 3.5, edges: [] }, { vertices: 3, edges: null }, { vertices: 3, edges: [null] },
    { vertices: 3, edges: [[0, 0]] }, { vertices: 3, edges: [[0, 3]] }, { vertices: 3, edges: [[0, '1']] },
    { vertices: 3, edges: [[0, 1, 2]] }, { vertices: 3, edges: [[0, 1], [1, 0]] },
    { vertices: 3, edges: [Array(2)] }, { vertices: 3, edges: Array(1) }]) {
    assert.throws(() => validateGraph(value), RangeError);
  }
  assert.throws(() => puzzleData({ vertices: 4, edges: [] }), /cannot be turned/);
  assert.throws(() => puzzleData({ vertices: 4, edges: [[0, 1], [0, 2], [0, 3]] }), /cannot be turned/,
    'A star is not locally equivalent to a four-vertex chain');
  assert.equal(isSolved({ vertices: 3, edges: [[0, 2], [1, 2]] }), false, 'Vertex labels form part of the target');
});

test('local complementation toggles neighbour pairs; edge pivot is three LCs without relabelling', () => {
  const chain = pathGraph(4), complemented = applyMove(chain, { vertex: 1 });
  assert.deepEqual(complemented.edges, [[0, 1], [0, 2], [1, 2], [2, 3]]);
  assert.deepEqual(applyMove(complemented, { vertex: 1 }), chain);
  const pivot = applyMove(chain, { edge: [1, 2] });
  assert.deepEqual(pivot.edges, [[0, 2], [0, 3], [1, 2], [1, 3]]);
  assert.deepEqual(applyMove(pivot, { edge: [2, 1] }), chain);
  assert.deepEqual(applyMove(chain, { vertex: 0 }), chain, 'A leaf LC is a legal topological no-op');
  for (const move of [null, [], {}, { vertex: 1, edge: [0, 1] }, { vertex: 1, extra: true },
    { vertex: '1' }, { vertex: -1 }, { vertex: 4 }, { edge: [0, 3] }, { edge: [1, 1] },
    { edge: ['0', 1] }, { edge: [0, 1, 2] }, { edge: Array(2) }]) {
    assert.throws(() => applyMove(chain, move), RangeError);
    assert.throws(() => correctionColumns(chain, move), RangeError);
  }
});

test('shots count local complementations, including all three within a pivot', () => {
  const moves = [{ vertex: 1 }, { edge: [1, 2] }, { edge: [2, 1] }, { vertex: 0 }];
  assert.equal(sequenceCost([]), 0);
  assert.equal(sequenceCost(moves.slice(0, 1)), 1);
  assert.equal(sequenceCost(moves.slice(1, 2)), 3);
  assert.equal(sequenceCost(moves), 8);
  assert.deepEqual(moves, [{ vertex: 1 }, { edge: [1, 2] }, { edge: [2, 1] }, { vertex: 0 }]);
});

test('complex statevectors verify every Clifford correction on exhaustive small and sampled larger graphs', () => {
  const random = seededRandom('graph-state-correction-proof');
  for (let vertices = 3; vertices <= 8; vertices++) {
    const possible = allEdges(vertices), count = vertices <= 4 ? 2 ** possible.length : 20;
    for (let sample = 0; sample < count; sample++) {
      const graph = { vertices, edges: possible.filter((_, bit) => vertices <= 4 ? sample & (1 << bit) : random() < .5) };
      const moves = [...Array.from({ length: vertices }, (_, vertex) => ({ vertex })), ...graph.edges.map(edge => ({ edge }))];
      for (const move of moves) {
        const next = applyMove(graph, move), columns = correctionColumns(graph, move);
        for (const column of columns) assert.equal(new Set(column.map(entry => entry.wires[0])).size, column.length);
        sameStateUpToPhase(applyCorrection(graphState(graph), columns), graphState(next));
        assert.deepEqual(applyMove(next, move), graph, 'Both operations are involutions');
      }
    }
  }
});

test('exact chain orbits are bounded and every shortest witness reaches its labelled target', () => {
  const expected = new Map([[3, 4], [4, 11], [5, 30], [6, 82], [7, 224], [8, 612]]);
  for (const [vertices, total] of expected) {
    let found = 0;
    for (let distance = 0; distance <= 5; distance++) for (const graph of graphsAtDistance(vertices, distance)) {
      found++;
      const sequence = solutionForGraph(graph);
      assert.equal(sequence.length, distance);
      assert.equal(isSolved(sequence.reduce(applyMove, graph)), true);
    }
    assert.equal(found, total);
  }
});

test('optimal shots satisfy exact LC distances and weighted pivot bounds throughout every chain orbit', () => {
  for (let vertices = 3; vertices <= 8; vertices++) {
    for (let distance = 0; distance <= 5; distance++) for (const graph of graphsAtDistance(vertices, distance)) {
      const shots = optimalShots(graph);
      assert.equal(Number.isInteger(shots) && shots >= 0, true);
      assert.equal(shots === 0, isSolved(graph), 'Only the labelled target has zero distance');
      const neighbours = Array.from({ length: vertices }, (_, vertex) => optimalShots(applyMove(graph, { vertex })));
      for (const next of neighbours) assert.ok(Math.abs(shots - next) <= 1, 'An LC costs one shot');
      if (shots > 0) assert.equal(shots, 1 + Math.min(...neighbours), 'Every non-target has a shortest first LC');
      for (const edge of graph.edges) {
        const next = optimalShots(applyMove(graph, { edge }));
        assert.ok(Math.abs(shots - next) <= 3, 'A pivot cannot improve on its three LCs');
      }
      assert.equal(sequenceCost(solutionForGraph(graph)) >= shots, true);
    }
  }
});

test('optimal shots are cached independently of operation counts and detached puzzle metadata', () => {
  const chain = pathGraph(4), oneLC = applyMove(chain, { vertex: 1 }), endpointPivot = applyMove(chain, { edge: [0, 1] });
  assert.equal(optimalShots(chain), 0);
  assert.equal(optimalShots(oneLC), 1);
  assert.equal(sequenceCost(solutionForGraph(endpointPivot)), 3, 'The frozen operation witness uses one pivot');
  assert.equal(optimalShots(endpointPivot), 2, 'Two LCs beat a three-shot pivot');
  const saved = structuredClone(endpointPivot), witness = solutionForGraph(endpointPivot);
  endpointPivot.shotDistance = -1;
  endpointPivot.optimalShots = -1;
  assert.equal(optimalShots(endpointPivot), 2, 'Imported metadata cannot override the computed optimum');
  assert.deepEqual(puzzleData(endpointPivot), saved);
  witness[0].edge[0] = 99;
  endpointPivot.edges.pop();
  assert.equal(optimalShots(saved), 2);
  assert.equal(sequenceCost(solutionForGraph(saved)), 3, 'Cached witnesses remain detached and unchanged');
  assert.deepEqual(graphsAtDistance(4, 1).find(graph => JSON.stringify(graph) === JSON.stringify(saved)), saved);
  for (const graph of [null, [], {}, { vertices: 2, edges: [] }, { vertices: 4, edges: [[0, 0]] },
    { vertices: 4, edges: [] }, { vertices: 4, edges: [[0, 1], [0, 2], [0, 3]] }]) {
    assert.throws(() => optimalShots(graph), RangeError);
  }
});

test('tutorial finishes with an actual three-shot pivot after teaching local complementation', () => {
  const prefix = TUTORIAL.steps.slice(0, -1), last = TUTORIAL.steps.at(-1);
  assert.ok(prefix.length >= 2 && prefix.every(step => Object.hasOwn(step.move, 'vertex')));
  assert.ok(Array.isArray(last.move.edge));
  assert.match(last.text, /three local complementations/);
  assert.match(last.text, /3 shots/);
  let graph = TUTORIAL.graph;
  for (const { move } of prefix) {
    const next = applyMove(graph, move);
    assert.notDeepEqual(next, graph, 'Every introductory click visibly changes the graph');
    assert.equal(isSolved(next), false, 'The chain is reached only after the final pivot');
    graph = next;
  }
  const [u, v] = last.move.edge;
  const final = applyMove(graph, last.move);
  assert.deepEqual(final, [u, v, u].reduce((state, vertex) => applyMove(state, { vertex }), graph));
  assert.equal(isSolved(final), true);
  assert.equal(sequenceCost(TUTORIAL.steps.map(step => step.move)), prefix.length + 3);
});

test('campaign witnesses solve all named lessons; generated puzzles remain deterministic and editable', () => {
  for (const lesson of LEVELS) {
    assert.ok(lesson.title.length > 0);
    assert.equal(isSolved(lesson), false);
    assert.equal(isSolved(solutionForGraph(lesson).reduce(applyMove, lesson)), true);
  }
  for (let difficulty = 1; difficulty <= 3; difficulty++) for (let seed = 0; seed < 50; seed++) {
    const graph = generatePuzzle(seed, difficulty);
    assert.deepEqual(graph, generatePuzzle(seed, difficulty));
    assert.equal(graph.vertices, 2 * difficulty + 2);
    assert.ok(solutionForGraph(graph).length >= difficulty + 1);
    graph.edges.pop();
    assert.notDeepEqual(graph, generatePuzzle(seed, difficulty), 'Callers cannot poison later puzzles');
  }
  for (const seed of [null, {}, [], Infinity, NaN, 'x'.repeat(101)]) assert.throws(() => generatePuzzle(seed), RangeError);
  for (const difficulty of [0, 4, 1.5, '1']) assert.throws(() => generatePuzzle(1, difficulty), RangeError);
});

test('daily graph identity is frozen, date checked and detached from other calls', () => {
  const graph = dailyPuzzle(DAILY_START), digest = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  assert.equal(digest, '4ceac1e6e9bc3d35626f3e42f0a83fdb056dcbb8a7e1ab06fdffab5909203a6c');
  for (let day = 0; day < 100; day++) {
    const date = new Date(Date.parse(`${DAILY_START}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
    const daily = dailyPuzzle(date), sequence = solutionForGraph(daily);
    assert.ok(sequence.length >= 4 && sequence.length <= 5);
    assert.equal(isSolved(sequence.reduce(applyMove, daily)), true);
  }
  graph.edges.pop();
  assert.notDeepEqual(graph, dailyPuzzle(DAILY_START));
  for (const date of ['2026-10-15', '2026-02-30', '2026-1-17', null, 20261016]) assert.throws(() => dailyPuzzle(date), RangeError);
});
