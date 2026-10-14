// Offline catalogue construction. Exact search is deliberately outside the
// browser/API hot path; committed boards and witnesses are transformed at runtime.
import { readFile, writeFile } from 'node:fs/promises';
import {
  RULES, applyMove, compactCircuit, getRewriteMoves, isIdentity, isSolved,
  lowerBound, seededRandom, sequenceCost, solveShortest,
} from '../../src/lib/circuit-reduction/engine.js';
import { encodeCircuit, encodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';

const RULE_IDS = RULES.map(rule => rule.id);
const proofUrl = new URL('./catalogue-certificates.json', import.meta.url);
const exactCheck = process.argv.includes('--check');
if (exactCheck || process.argv.includes('--check-data')) {
  const { CERTIFIED_PUZZLES, LEVELS } = await import('./witnesses.js');
  const provenance = JSON.parse(await readFile(proofUrl, 'utf8'));
  if (provenance.nodes.length !== CERTIFIED_PUZZLES.length || JSON.stringify(provenance.ruleIds) !== JSON.stringify(RULE_IDS)) throw new Error('Catalogue provenance does not match the current rules.');
  for (const [index, entry] of CERTIFIED_PUZZLES.entries()) {
    if (sequenceCost(entry.solution) !== entry.optimalMoves) throw new Error(`Precomputed score failed: certified-${index + 1}`);
    if (exactCheck) {
      const result = solveShortest(entry.circuit, { maxDepth: entry.optimalMoves, maxNodes: Math.max(25000, provenance.nodes[index] * 2), allowedRules: RULE_IDS });
      if (result.status !== 'optimal' || result.optimalMoves !== entry.optimalMoves) throw new Error(`Certificate failed: certified-${index + 1}`);
    }
    certificate(entry.circuit, entry.solution);
  }
  for (const level of LEVELS) {
    if (sequenceCost(level.solution) !== (level.optimalMoves ?? level.parMoves)) throw new Error(`Precomputed campaign score failed: ${level.id}`);
    certificate(level.circuit, level.solution);
  }
  console.log(`Verified ${LEVELS.length} campaign witnesses, ${CERTIFIED_PUZZLES.length} identity-to-puzzle derivations and ${exactCheck ? 'exact shortest paths' : 'precomputed scores'} with all ${RULE_IDS.length} rules.`);
  process.exit(0);
}
const targets = new Set((process.env.CATALOGUE_DIFFICULTIES || '3,6,10,11,12,13,14').split(',').map(Number));
const perTarget = Number(process.env.CATALOGUE_PER_TARGET || 6);
const budget = Number(process.env.CATALOGUE_MAX_NODES || 150000);
const catalogue = [];
const seen = new Set();

const join = (a, b) => a.map((row, wire) => [...row, ...b[wire]]);
function core(pair = 0) {
  const rows = Array.from({ length: 3 }, () => Array(5).fill('.'));
  rows[pair] = ['X', 'ZU', 'X', '.', 'ZU'];
  rows[pair + 1] = ['H', 'ZD', 'Z', 'H', 'XD'];
  return rows;
}
function braid(quartets = 2, reverse = false) {
  const rows = Array.from({ length: 3 }, () => Array(4 * quartets).fill('.'));
  for (let column = 0; column < rows[0].length; column++) {
    const row = (column + Number(reverse)) % 2;
    rows[row][column] = 'ZU'; rows[row + 1][column] = 'ZD';
  }
  return rows;
}
function expand(circuit, random, count) {
  for (let i = 0; i < count; i++) {
    const options = getRewriteMoves(circuit, { allowedRules: RULE_IDS }).filter(item => item.move.rule.startsWith('basis') && lowerBound(item.next) > lowerBound(circuit));
    if (!options.length) break;
    circuit = compactCircuit(options[Math.floor(random() * options.length)].next);
  }
  return circuit;
}
function commute(circuit, random) {
  const options = getRewriteMoves(circuit, { allowedRules: RULE_IDS }).filter(item => item.move.rule.startsWith('phase-'));
  return options.length ? compactCircuit(options[Math.floor(random() * options.length)].next) : circuit;
}
function certificate(circuit, solution) {
  // Verify the reverse derivation without storing a duplicate sequence.
  // Arrangement edits are reversed by restoring their prior layout.
  const states = [circuit];
  for (const move of solution) states.push(applyMove(states.at(-1), move));
  if (!isSolved(states.at(-1)) || !isIdentity(circuit)) throw new Error('Invalid solver certificate');
  let grown = states.at(-1);
  for (let i = solution.length - 1; i >= 0; i--) {
    const move = solution[i];
    grown = applyMove(grown, move.rule === 'arrange' ? { rule: 'arrange', row: 0, column: 0, circuit: states[i] } : move);
  }
  if (JSON.stringify(grown) !== JSON.stringify(circuit)) throw new Error('Invalid identity-to-puzzle derivation');
}

async function saveCatalogue() {
  const output = `// Generated offline by tools/circuit-reduction/certify-generated.mjs.
// Entry order is part of the frozen Daily v2 seed. Witnesses live only in tools/.
import { decodeCircuit } from './stored-puzzles.js';
const stored = [\n${catalogue.map(entry => `  { circuit: ${JSON.stringify(encodeCircuit(entry.circuit))}, optimalMoves: ${sequenceCost(entry.solution)} },`).join('\n')}\n];
export const CERTIFIED_PUZZLES = stored.map(({ circuit, optimalMoves }) => ({ circuit: decodeCircuit(circuit), optimalMoves }));
`;
  await writeFile(new URL('../../src/lib/circuit-reduction/generated-catalogue.js', import.meta.url), output);
  const witness = `// Generated offline. Same entry order as src/lib/circuit-reduction/generated-catalogue.js.
import { decodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';
export const CATALOGUE_WITNESSES = [\n${catalogue.map(entry => `  [\n${encodeSequence(entry.solution).map(move => '    ' + JSON.stringify(move) + ',').join('\n')}  ],`).join('\n')}\n].map(decodeSequence);
`;
  await writeFile(new URL('./catalogue-witnesses.js', import.meta.url), witness);
  await writeFile(proofUrl, JSON.stringify({ version: 'circuit-reduction-generator-v2', method: 'complete-iterative-deepening', generation: 'reverse-certified-solution', ruleIds: RULE_IDS, nodes: catalogue.map(entry => entry.nodes) }, null, 2) + '\n');
}

for (let attempt = 0; attempt < 1000; attempt++) {
  const difficulty = [...targets][attempt % targets.size];
  if (catalogue.filter(item => item.optimalMoves === difficulty).length >= perTarget) {
    if ([...targets].every(target => catalogue.filter(item => item.optimalMoves === target).length >= perTarget)) break;
    continue;
  }
  const random = seededRandom(`circuit-reduction-hard-catalogue-v2:${attempt}`);
  let circuit;
  if (difficulty === 3) circuit = braid(1, random() < .5);
  else if (difficulty === 6) circuit = expand(core(random() < .5 ? 0 : 1), random, 2);
  else if (difficulty === 14) {
    const first = core(random() < .5 ? 0 : 1), second = core(random() < .5 ? 0 : 1), crossings = braid(1, random() < .5);
    circuit = random() < .5 ? join(join(first, crossings), second) : join(join(crossings, first), second);
    circuit = expand(compactCircuit(circuit), random, 3);
  } else {
    const motif = core(random() < .5 ? 0 : 1), crossings = braid(2, random() < .5);
    circuit = random() < .5 ? join(motif, crossings) : join(crossings, motif);
    circuit = expand(compactCircuit(circuit), random, Math.min(3, difficulty - 10));
    if (difficulty >= 11 && random() < .35) circuit = commute(circuit, random);
  }
  circuit = compactCircuit(circuit);
  const key = JSON.stringify(circuit);
  if (seen.has(key)) continue;
  seen.add(key);
  const start = performance.now();
  const result = solveShortest(circuit, { maxDepth: difficulty, maxNodes: budget, allowedRules: RULE_IDS });
  console.log(`attempt=${attempt} target=${difficulty} result=${result.status}/${result.optimalMoves ?? '-'} nodes=${result.nodes} ms=${Math.round(performance.now() - start)}`);
  if (result.status !== 'optimal' || result.optimalMoves !== difficulty) continue;
  const rules = result.solution.filter(move => move.rule !== 'arrange').map(move => move.rule);
  if (difficulty >= 10 && (!rules.includes('control-order') || !rules.some(rule => rule.startsWith('basis')) || !rules.some(rule => rule.startsWith('stabilizer')))) continue;
  certificate(circuit, result.solution);
  catalogue.push({ circuit, solution: result.solution, optimalMoves: result.optimalMoves, nodes: result.nodes });
  await saveCatalogue();
}
console.log('Catalogue counts', Object.fromEntries([...targets].map(target => [target, catalogue.filter(item => item.optimalMoves === target).length])));
if (![...targets].every(target => catalogue.some(item => item.optimalMoves === target))) process.exitCode = 1;
