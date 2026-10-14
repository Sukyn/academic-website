import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  LEARNED_RULE_IDS, applyMove, circuitKey, compactCircuit, isIdentity, isSolved,
  lowerBound, moveCost, sequenceCost, solveShortest, validateCircuit,
} from '../../src/lib/circuit-reduction/engine.js';
import { CERTIFIED_PUZZLES, generatePuzzle, LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { generatePuzzle as generateBoard, CERTIFIED_PUZZLES as boards } from '../../src/lib/circuit-reduction/generator.js';
import { encodeCircuit, decodeCircuit, encodeSequence, decodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';
import { LEVELS as levelBoards, dailyPuzzle as dailyBoard, DAILY_VERSION } from '../../src/lib/circuit-reduction/puzzles.js';
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
  const { solution, ...board } = dailyPuzzle('2026-10-14');
  assert.deepEqual(dailyBoard('2026-10-14'), board);
});

test('Daily v2 retains its published boards, witnesses and certified scores', () => {
  assert.equal(DAILY_VERSION, 'circuit-reduction-daily-v2');
  for (const [date, expected] of [
    ['2026-10-14', '3d9696a5e767eaec2a085d8ae91422c1ea9090deb2fbb95375108d1b9c988658'],
    ['2026-10-15', 'e82c0d72fd407c65b4264b7f87ad7a6b79bf56718bed6d08de0c6ac92ad4ce76'],
    ['2026-11-03', 'b50c68f0a842e27adc636c4cb280c2830754f3d0f5c0c415ebbe560ed6d63d99'],
    ['2027-04-12', 'b7075d6c3a532958ff3233bbba9915e3eb4b0a6ab13b89a08e4419b89d822cce'],
  ]) {
    const { circuit, solution, optimalMoves } = dailyPuzzle(date);
    assert.equal(createHash('sha256').update(JSON.stringify({ circuit, solution, optimalMoves })).digest('hex'), expected, date);
  }
});

test('The catalogue contains exact-search certificates using every learned rule', () => {
  for (const difficulty of [3, 6, 10, 11, 12, 13, 14]) assert.ok(CERTIFIED_PUZZLES.some(entry => entry.optimalMoves === difficulty), `difficulty ${difficulty}`);
  assert.deepEqual(provenance.ruleIds, LEARNED_RULE_IDS);
  assert.equal(provenance.method, 'complete-iterative-deepening');
  assert.equal(provenance.generation, 'reverse-certified-solution');
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

test('Hard circuits combine H conjugation, control commutation, and phase propagation', () => {
  for (const entry of CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves >= 10)) {
    const rules = entry.solution.map(move => move.rule);
    assert.ok(rules.some(rule => rule.startsWith('basis')), 'conjugates');
    assert.ok(rules.some(rule => ['control-order', 'phase-up', 'phase-down'].includes(rule)), 'commutes');
    assert.ok(rules.some(rule => rule.startsWith('stabilizer')), 'propagates');
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

test('The hard circuit cannot be solved at its optimum after removing either commutation or H conjugation', () => {
  const entry = CERTIFIED_PUZZLES.find(entry => entry.optimalMoves === 10);
  for (const excluded of [['control-order'], ['basis-x', 'basis-z', 'basis-up', 'basis-down']]) {
    const maxNodes = 20000;
    const result = solveShortest(entry.circuit, { maxDepth: entry.optimalMoves, maxNodes, allowedRules: LEARNED_RULE_IDS.filter(id => !excluded.includes(id)) });
    assert.equal(result.status, 'limit');
    // Below the node cap means every path up to the certified optimum was
    // exhausted, rather than merely timing out while looking for a shortcut.
    assert.ok(result.nodes < maxNodes, `${excluded.join(',')} search completed`);
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
