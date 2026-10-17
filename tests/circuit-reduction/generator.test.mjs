import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  LEARNED_RULE_IDS, applyMove, circuitKey, compactCircuit, isIdentity, isSolved,
  lowerBound, moveCost, sequenceCost, solveShortest, validateCircuit,
} from '../../src/lib/circuit-reduction/engine.js';
import { CERTIFIED_PUZZLES, generatePuzzle, LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { createPuzzleGenerator, generatePuzzle as generateBoard, CERTIFIED_PUZZLES as boards } from '../../src/lib/circuit-reduction/generator.js';
import { encodeCircuit, decodeCircuit, encodeSequence, decodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';
import { LEVELS as levelBoards, dailyPuzzle as dailyBoard, DAILY_VERSION, DAILY_START } from '../../src/lib/circuit-reduction/puzzles.js';
import { circuitMetrics, catalogueMetrics } from '../../tools/circuit-reduction/diversity.mjs';
import { generateCandidates } from '../../tools/circuit-reduction/candidates.mjs';
const provenance = JSON.parse(await readFile(new URL('../../tools/circuit-reduction/catalogue-certificates.json', import.meta.url), 'utf8'));
const reflect = circuit => [...circuit].reverse().map(row => row.map(cell => ({ ZU: 'ZD', ZD: 'ZU', XU: 'XD', XD: 'XU' })[cell] || cell));

test('Runtime boards retain only playable data and match offline witnesses', () => {
  for (const [index, { solution, ...board }] of CERTIFIED_PUZZLES.entries()) {
    assert.deepEqual(boards[index], board);
    assert.equal(board.optimalMoves, sequenceCost(solution));
  }
  for (const [index, { solution, ...board }] of LEVELS.entries()) {
    assert.deepEqual(levelBoards[index], board);
    assert.equal(board.optimalMoves ?? board.parMoves, sequenceCost(solution));
  }
  for (const difficulty of [1, 3, 6, 10, 14, 20]) for (const wires of [1, 3, 4]) {
    const { solution, ...board } = generatePuzzle('runtime-preservation', difficulty, { wires, columns: 24 });
    assert.deepEqual(generateBoard('runtime-preservation', difficulty, { wires, columns: 24 }), board);
  }
  const { solution, ...board } = dailyPuzzle(DAILY_START);
  assert.deepEqual(dailyBoard(DAILY_START), board);
});

test('Daily generation starts with the new v3 series', () => {
  assert.equal(DAILY_START, '2026-10-17');
  assert.equal(DAILY_VERSION, 'circuit-reduction-daily-v3');
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16']) {
    assert.throws(() => dailyBoard(date), RangeError);
    assert.throws(() => dailyPuzzle(date), RangeError);
  }
});

test('Released v3 daily seeds remain fixed across deployments', () => {
  for (const [date, expected] of [
    ['2026-10-17', '2fc61d4e4ec52042debb0d65221520abb0c9babd358b3ad4ab138bf2d58832ee'],
    ['2026-10-18', 'cdb231f72ad93c5a26892c83de23936ac5913a3ea446693406539026d7e6b627'],
    ['2026-12-17', '5dcc36d1f3a5edcb358ce60e99bf632884b103ec37503ced97f44cf84301c132'],
  ]) {
    const { circuit, solution, optimalMoves } = dailyPuzzle(date);
    assert.equal(createHash('sha256').update(JSON.stringify({ circuit, solution, optimalMoves })).digest('hex'), expected, date);
  }
});

test('The catalogue contains exact-search certificates using every learned rule', () => {
  for (const difficulty of [3, 6, 10, 11, 12, 13, 14]) assert.ok(CERTIFIED_PUZZLES.some(entry => entry.optimalMoves === difficulty), `difficulty ${difficulty}`);
  assert.deepEqual(provenance.ruleIds, LEARNED_RULE_IDS);
  assert.equal(provenance.method, 'complete-iterative-deepening');
  assert.equal(provenance.generation, 'rule-relators-and-reversible-rewrites');
  assert.equal(provenance.nodes.length, CERTIFIED_PUZZLES.length);
  const keys = new Set();
  for (const [index, entry] of CERTIFIED_PUZZLES.entries()) {
    const label = `certified-${index + 1}`;
    const key = JSON.stringify(compactCircuit(entry.circuit));
    assert.ok(!keys.has(key), `${label} is a distinct circuit`); keys.add(key);
    assert.ok(Number.isInteger(provenance.nodes[index]) && provenance.nodes[index] > 0);
    assert.deepEqual(decodeCircuit(encodeCircuit(entry.circuit)), entry.circuit);
    assert.deepEqual(decodeSequence(encodeSequence(entry.solution)), entry.solution);
    let current = entry.circuit;
    const states = [current];
    for (const move of entry.solution) { current = applyMove(current, move); states.push(current); }
    assert.ok(isSolved(current), `${label} solves`);
    assert.ok(isIdentity(entry.circuit), `${label} is quantum identity`);
    assert.equal(sequenceCost(entry.solution), entry.optimalMoves);
    for (let i = entry.solution.length - 1; i >= 0; i--) {
      const move = entry.solution[i];
      current = applyMove(current, move.rule === 'arrange' ? { rule: 'arrange', row: 0, column: 0, circuit: states[i] } : move);
    }
    assert.deepEqual(current, entry.circuit, `${label} is legally constructed from identity`);
  }
});

test('Hard circuits mix advanced families without repeated CZ padding', () => {
  for (const entry of CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves >= 10)) {
    const rules = entry.solution.map(move => move.rule);
    const metrics = circuitMetrics(entry.circuit);
    assert.ok(rules.some(rule => rule.startsWith('basis')), 'conjugates');
    const advanced = rules.filter(rule => /^(phase-|stabilizer-|corner-|transfer$|control-order$)/.test(rule));
    assert.ok(new Set(advanced.map(rule => rule.split('-')[0])).size >= 2, 'mixes advanced rule families');
    assert.ok(metrics.maxAlternatingCZ <= 4, 'no long alternating CZ braid');
    assert.ok(Object.keys(metrics.gateTypes).length >= 3, 'varied gate alphabet');
    assert.ok(entry.optimalMoves > lowerBound(entry.circuit), 'exceeds weight bound');
    let current = entry.circuit, decision = false;
    for (const move of entry.solution) {
      const next = applyMove(current, move);
      if (moveCost(move) && lowerBound(next) >= lowerBound(current)) decision = true;
      current = next;
    }
    assert.ok(decision, 'needs a rewrite which does not immediately reduce the bound');
  }
});

test('Exact search independently recertifies every hard difficulty under free identity spacing', () => {
  for (const difficulty of [10, 11, 12, 13, 14]) {
    const entry = CERTIFIED_PUZZLES.find(entry => entry.optimalMoves === difficulty);
    const result = solveShortest(entry.circuit, { maxDepth: difficulty, maxNodes: 25000, allowedRules: LEARNED_RULE_IDS });
    assert.equal(result.status, 'optimal', `difficulty ${difficulty}`);
    assert.equal(result.optimalMoves, difficulty);
    assert.equal(sequenceCost(result.solution), difficulty);
  }
});

test('Seeds vary circuit structure, and reflection preserves certified rewrite difficulty', () => {
  for (const difficulty of [10, 11, 12, 13, 14]) {
    const puzzles = Array.from({ length: 100 }, (_, seed) => generatePuzzle(`variation:${seed}`, difficulty));
    assert.ok(new Set(puzzles.map(puzzle => circuitKey(compactCircuit(puzzle.circuit)))).size >= 8, `${difficulty} has distinct gate orders`);
    const originals = new Set(CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves === difficulty).map(entry => circuitKey(compactCircuit(entry.circuit))));
    const reflections = new Set(CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves === difficulty).map(entry => circuitKey(compactCircuit(reflect(entry.circuit)))).filter(key => !originals.has(key)));
    const reflected = puzzles.find(puzzle => reflections.has(circuitKey(compactCircuit(puzzle.circuit))));
    assert.ok(reflected);
    const result = solveShortest(reflected.circuit, { maxDepth: difficulty, maxNodes: 25000, allowedRules: LEARNED_RULE_IDS });
    assert.equal(result.status, 'optimal');
    assert.equal(result.optimalMoves, difficulty);
  }
});

test('Diversity ignores superficial layouts and certified solutions cover every scored rule', () => {
  const metrics = catalogueMetrics(CERTIFIED_PUZZLES);
  assert.equal(metrics.structuralUnique, CERTIFIED_PUZZLES.length);
  assert.ok(metrics.minimumNearestNeighborDistance >= .2 - 1e-9);
  assert.ok(metrics.medianNearestNeighborDistance >= .2);
  for (const rule of LEARNED_RULE_IDS.filter(rule => moveCost({ rule }))) assert.ok(metrics.ruleUse[rule], rule);
  for (const difficulty of [10, 11, 12, 13, 14]) {
    const entries = CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves === difficulty), counts = new Map();
    for (const entry of entries) {
      const families = new Set(entry.solution.map(move => move.rule).filter(rule => /^(phase-|stabilizer-|corner-|transfer$|control-order$)/.test(rule)).map(rule => rule.split('-')[0]));
      for (const name of families) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    assert.ok([...counts.values()].every(count => count <= Math.floor(entries.length * 2 / 3)), 'no single advanced recipe dominates a difficulty');
  }
});

test('Every certified witness survives reflection, padding and an extra wire', () => {
  for (const entry of CERTIFIED_PUZZLES) {
    const generate = createPuzzleGenerator([entry], { includeSolution: true }), orientations = new Set();
    for (let seed = 0; seed < 8; seed++) for (const wires of [3, 4]) {
      const puzzle = generate(`transform:${seed}`, entry.optimalMoves, { wires, columns: 24 });
      assert.ok(isSolved(puzzle.solution.reduce(applyMove, puzzle.circuit)));
      assert.equal(sequenceCost(puzzle.solution), entry.optimalMoves);
      if (wires === 3) orientations.add(circuitKey(compactCircuit(puzzle.circuit)));
    }
    assert.ok(orientations.has(circuitKey(compactCircuit(entry.circuit))));
    assert.ok(orientations.has(circuitKey(compactCircuit(reflect(entry.circuit)))));
  }
});

test('Rule-guided candidates are bounded, reproducible identity constructions', () => {
  for (const difficulty of [3, 6, 10, 14]) {
    const options = { difficulty, count: 8 };
    const candidates = [...generateCandidates('candidate-regression', options)];
    assert.deepEqual([...generateCandidates('candidate-regression', options)], candidates);
    for (const circuit of candidates) {
      validateCircuit(circuit);
      assert.ok(isIdentity(circuit));
      assert.ok(circuit[0].length <= 32);
    }
  }
  for (const options of [{ count: 1001 }, { difficulty: 0 }, { maxColumns: 129 }]) {
    assert.throws(() => [...generateCandidates('invalid', options)], RangeError);
  }
});

test('Daily shuffled cycles have balanced difficulty and no disguised repetitions', () => {
  const count = CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves >= 10).length;
  let previous;
  for (let cycle = 0; cycle < 3; cycle++) {
    const keys = new Set(), difficulties = new Map();
    for (let day = 0; day < count; day++) {
      const date = new Date(Date.parse(DAILY_START) + (cycle * count + day) * 86400000).toISOString().slice(0, 10);
      const { solution, ...board } = dailyPuzzle(date);
      assert.deepEqual(dailyBoard(date), board);
      assert.equal(sequenceCost(solution), board.optimalMoves);
      const key = circuitMetrics(board.circuit).structuralKey;
      assert.notEqual(key, previous, 'no duplicate across cycle boundaries');
      assert.ok(!keys.has(key), 'reflection/reversal is not a new daily structure'); keys.add(key); previous = key;
      difficulties.set(board.optimalMoves, (difficulties.get(board.optimalMoves) ?? 0) + 1);
      assert.ok(board.optimalMoves >= 10 && board.optimalMoves <= 14);
    }
    assert.equal(new Set(difficulties.values()).size, 1, 'each difficulty appears equally often');
  }
});

test('Identity growth, catalogue layouts, and returned arrays remain isolated', () => {
  for (const difficulty of [1, 2, 3, 4, 6, 10, 11, 12, 13, 14, 20]) for (const wires of [1, 3, 4]) {
    const puzzle = generatePuzzle(`regression:${difficulty}:${wires}`, difficulty, { wires });
    validateCircuit(puzzle.circuit);
    assert.equal(puzzle.circuit.length, wires);
    let current = puzzle.circuit;
    for (const move of puzzle.solution) current = applyMove(current, move);
    assert.ok(isSolved(current), `${difficulty} moves / ${wires} wires`);
    assert.equal(sequenceCost(puzzle.solution), difficulty);
    const reproduced = generatePuzzle(`regression:${difficulty}:${wires}`, difficulty, { wires });
    assert.deepEqual(puzzle, reproduced);
    puzzle.circuit[0][0] = 'invalid';
    assert.notEqual(reproduced.circuit[0][0], 'invalid');
  }
  for (const options of [{ wires: 0 }, { wires: 5 }, { wires: 1.5 }, { columns: 3 }, { columns: 4.5 }, { columns: 257 }]) assert.throws(() => generatePuzzle('invalid', 10, options), RangeError);
});
