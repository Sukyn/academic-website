// Build and certify a varied catalogue offline. Browsers load only boards/scores.
import { readFile, writeFile } from 'node:fs/promises';
import {
  LEARNED_RULE_IDS, applyMove, isIdentity, isSolved, moveCost,
  sequenceCost, solveShortest,
} from '../../src/lib/circuit-reduction/engine.js';
import { encodeCircuit, encodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';
import { generateCandidates } from './candidates.mjs';
import { circuitMetrics, structuralDistance, catalogueMetrics } from './diversity.mjs';

const version = 'circuit-reduction-generator-v3';
const proofUrl = new URL('./catalogue-certificates.json', import.meta.url);
const advanced = rule => /^(phase-|stabilizer-|corner-|transfer$|control-order$)/.test(rule);
const family = rule => rule.split('-')[0];
const advancedFamilies = solution => new Set(solution.map(move => move.rule).filter(advanced).map(family));
const minimumDistance = .2;

function certificate(circuit, solution) {
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

function varied(entry) {
  const metrics = circuitMetrics(entry.circuit);
  if (metrics.maxAlternatingCZ > 4) return false;
  if (entry.optimalMoves < 10) return true;
  const rules = entry.solution.map(move => move.rule);
  return Object.keys(metrics.gateTypes).length >= 3 && metrics.entropy >= 1.3 &&
    rules.some(rule => rule.startsWith('basis-')) && advancedFamilies(entry.solution).size >= 2;
}

if (process.argv.includes('--audit')) {
  const { CERTIFIED_PUZZLES, generatePuzzle, dailyPuzzle } = await import('./witnesses.js');
  const { DAILY_START } = await import('../../src/lib/circuit-reduction/puzzles.js');
  const summary = entries => ({ count: entries.length, ...catalogueMetrics(entries),
    maxAlternatingCZ: Math.max(...entries.map(entry => circuitMetrics(entry.circuit).maxAlternatingCZ)) });
  const random = Array.from({ length: 1000 }, (_, seed) => generatePuzzle(`diversity:${seed}`, 10 + seed % 5));
  const daily = Array.from({ length: 365 }, (_, day) => dailyPuzzle(new Date(Date.parse(DAILY_START) + day * 86400000).toISOString().slice(0, 10)));
  console.log(JSON.stringify({ catalogue: summary(CERTIFIED_PUZZLES), hard: summary(CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves >= 10)),
    random: summary(random), daily: summary(daily) }, null, 2));
} else if (process.argv.includes('--check') || process.argv.includes('--check-data')) {
  const { CERTIFIED_PUZZLES, LEVELS, dailyPuzzle } = await import('./witnesses.js');
  const { DAILY_START } = await import('../../src/lib/circuit-reduction/puzzles.js');
  const provenance = JSON.parse(await readFile(proofUrl, 'utf8'));
  if (provenance.version !== version || provenance.nodes.length !== CERTIFIED_PUZZLES.length ||
      JSON.stringify(provenance.ruleIds) !== JSON.stringify(LEARNED_RULE_IDS)) throw new Error('Catalogue provenance does not match the current generator/rules.');
  for (const [index, entry] of CERTIFIED_PUZZLES.entries()) {
    if (sequenceCost(entry.solution) !== entry.optimalMoves || !varied(entry)) throw new Error(`Catalogue quality failed: ${index + 1}`);
    if (process.argv.includes('--check')) {
      const result = solveShortest(entry.circuit, { maxDepth: entry.optimalMoves, maxNodes: Math.max(25000, provenance.nodes[index] * 2), allowedRules: LEARNED_RULE_IDS });
      if (result.status !== 'optimal' || result.optimalMoves !== entry.optimalMoves) throw new Error(`Certificate failed: ${index + 1}`);
    }
    certificate(entry.circuit, entry.solution);
  }
  for (const level of [...LEVELS, dailyPuzzle(DAILY_START)]) {
    if (sequenceCost(level.solution) !== (level.optimalMoves ?? level.parMoves)) throw new Error('Precomputed score failed');
    certificate(level.circuit, level.solution);
  }
  const metrics = catalogueMetrics(CERTIFIED_PUZZLES);
  if (metrics.minimumNearestNeighborDistance < minimumDistance - 1e-9 ||
      LEARNED_RULE_IDS.some(rule => moveCost({ rule }) && !metrics.ruleUse[rule])) throw new Error('Catalogue diversity or rule coverage failed');
  for (const difficulty of [10, 11, 12, 13, 14]) {
    const entries = CERTIFIED_PUZZLES.filter(entry => entry.optimalMoves === difficulty), counts = new Map();
    for (const entry of entries) for (const name of advancedFamilies(entry.solution)) counts.set(name, (counts.get(name) ?? 0) + 1);
    if ([...counts.values()].some(count => count > Math.max(1, Math.floor(entries.length * 2 / 3)))) throw new Error('One advanced rule family dominates a difficulty');
  }
  console.log(`Verified ${CERTIFIED_PUZZLES.length} catalogue boards, ${LEVELS.length} lessons and the first daily puzzle; all 18 scored rules occur in certified solutions.`);
} else if (process.argv.includes('--generate')) {
  const targets = [3, 6, 10, 11, 12, 13, 14];
  const perTarget = Number(process.env.CATALOGUE_PER_TARGET || 12), budget = Number(process.env.CATALOGUE_MAX_NODES || 25000);
  if (!Number.isInteger(perTarget) || perTarget < 1 || perTarget > 1000 || !Number.isSafeInteger(budget) || budget < 1) throw new RangeError('Choose valid catalogue size and search budgets');
  const catalogue = [], seen = new Set();
  const sources = targets.map(difficulty => ({ difficulty,
    source: generateCandidates(version, { difficulty, count: 1000 }), count: 0, families: new Map() }));
  for (let round = 0; round < 1000 && sources.some(source => source.count < perTarget); round++) {
    for (const source of sources) {
      if (source.count >= perTarget) continue;
      const candidate = source.source.next();
      if (candidate.done) continue;
      const circuit = candidate.value, metrics = circuitMetrics(circuit);
      if (metrics.maxAlternatingCZ > 4 || seen.has(metrics.structuralKey)) continue;
      seen.add(metrics.structuralKey);
      if (catalogue.some(entry => structuralDistance(circuit, entry.circuit) < minimumDistance)) continue;
      const result = solveShortest(circuit, { maxDepth: source.difficulty, maxNodes: budget, allowedRules: LEARNED_RULE_IDS });
      if (result.status !== 'optimal' || result.optimalMoves !== source.difficulty || !varied({ circuit, ...result })) continue;
      const families = advancedFamilies(result.solution);
      if (source.difficulty >= 10 && [...families].some(name => (source.families.get(name) ?? 0) >= Math.max(1, Math.floor(perTarget * 2 / 3)))) continue;
      certificate(circuit, result.solution);
      catalogue.push({ circuit, ...result }); source.count++;
      for (const name of families) source.families.set(name, (source.families.get(name) ?? 0) + 1);
      console.log(`Accepted ${source.difficulty} moves: ${source.count}/${perTarget}, nodes=${result.nodes}, CZ run=${metrics.maxAlternatingCZ}`);
    }
  }
  if (sources.some(source => source.count !== perTarget)) throw new Error('Candidate budget exhausted before filling every difficulty');
  const metrics = catalogueMetrics(catalogue);
  if (LEARNED_RULE_IDS.some(rule => moveCost({ rule }) && !metrics.ruleUse[rule])) throw new Error('The selected catalogue must exercise every scored rule');
  const output = `// Generated offline by tools/circuit-reduction/certify-generated.mjs --generate.
// Entry order is frozen for Daily v3; witnesses remain in tools/.
import { decodeCircuit } from './stored-puzzles.js';
const stored = [\n${catalogue.map(entry => `  { circuit: ${JSON.stringify(encodeCircuit(entry.circuit))}, optimalMoves: ${entry.optimalMoves} },`).join('\n')}\n];
export const CERTIFIED_PUZZLES = stored.map(({ circuit, optimalMoves }) => ({ circuit: decodeCircuit(circuit), optimalMoves }));
`;
  const witnesses = `// Generated offline. Same order as src/lib/circuit-reduction/generated-catalogue.js.
import { decodeSequence } from '../../src/lib/circuit-reduction/stored-puzzles.js';
export const CATALOGUE_WITNESSES = [\n${catalogue.map(entry => `  [\n${encodeSequence(entry.solution).map(move => '    ' + JSON.stringify(move) + ',').join('\n')}  ],`).join('\n')}\n].map(decodeSequence);
`;
  await writeFile(new URL('../../src/lib/circuit-reduction/generated-catalogue.js', import.meta.url), output);
  await writeFile(new URL('./catalogue-witnesses.js', import.meta.url), witnesses);
  await writeFile(proofUrl, JSON.stringify({ version, method: 'complete-iterative-deepening', generation: 'rule-relators-and-reversible-rewrites',
    ruleIds: LEARNED_RULE_IDS, minimumDistance, nodes: catalogue.map(entry => entry.nodes) }, null, 2) + '\n');
  console.log(JSON.stringify(metrics, null, 2));
} else {
  console.log('Use --generate, --check-data, --check (exact search), or --audit (1,000 random / 365 daily puzzles).');
}
