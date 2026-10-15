import {
  EMPTY, MAX_WIRES, LEARNED_RULE_IDS, RULES, circuitKey, compactCircuit,
  getRewriteMoves, lowerBound, seededRandom,
} from './engine.js';
import { CERTIFIED_PUZZLES } from './generated-catalogue.js';

const reflectedRules = { 'basis-up': 'basis-down', 'basis-down': 'basis-up', 'cancel-cnot-up': 'cancel-cnot-down', 'cancel-cnot-down': 'cancel-cnot-up', 'phase-up': 'phase-down', 'phase-down': 'phase-up', 'stabilizer-up': 'stabilizer-down', 'stabilizer-down': 'stabilizer-up', 'corner-up': 'corner-down', 'corner-down': 'corner-up' };
const reflectedCells = { ZU: 'ZD', ZD: 'ZU', XU: 'XD', XD: 'XU' };
const reflectCircuit = circuit => [...circuit].reverse().map(row => row.map(cell => reflectedCells[cell] || cell));
const offsetCircuit = (circuit, offset, wires) => Array.from({ length: wires }, (_, row) =>
  row >= offset && row < offset + circuit.length ? [...circuit[row - offset]] : Array(circuit[0].length).fill(EMPTY));
function reflectMove(move, wires) {
  const rule = RULES.find(rule => rule.id === move.rule);
  const next = { ...move, rule: reflectedRules[move.rule] || move.rule, row: rule ? wires - move.row - rule.left.length : 0 };
  if (move.circuit) next.circuit = reflectCircuit(move.circuit);
  return next;
}
const offsetMove = (move, offset, wires) => {
  const next = { ...move, row: move.rule === 'arrange' ? 0 : move.row + offset };
  if (move.circuit) next.circuit = offsetCircuit(move.circuit, offset, wires);
  return next;
};

// A catalogue entry is an exact-search certificate, not a guessed difficulty.
// Its reverse derivation from identity is verified offline. Runtime generation
// transforms the precomputed board and witness together, without replaying that
// derivation or storing a second set of every intermediate circuit.
function fromCertificate(entry, random, { wires, columns }, includeSolution) {
  const reflected = random() < .5;
  const offset = wires > entry.circuit.length ? Math.floor(random() * (wires - entry.circuit.length + 1)) : 0;
  let circuit = offsetCircuit(reflected ? reflectCircuit(entry.circuit) : entry.circuit, offset, wires);
  const beforeLayout = circuit;
  circuit = compactCircuit(circuit);
  if (columns && circuit[0].length < columns) circuit = circuit.map(row => [...row, ...Array(columns - row.length).fill(EMPTY)]);
  if (!includeSolution) return { circuit, optimalMoves: entry.optimalMoves };
  const transform = move => offsetMove(reflected ? reflectMove(move, entry.circuit.length) : move, offset, wires);
  let solution = entry.solution.map(transform);
  if (circuitKey(circuit) !== circuitKey(beforeLayout)) solution = [{ rule: 'arrange', row: 0, column: 0, circuit: beforeLayout }, ...solution];
  return { circuit, solution, optimalMoves: entry.optimalMoves };
}

// Small/custom wire-count requests also start at identity. In this branch each
// reversible step increases an admissible bound by exactly one, certifying the
// reverse solution. Main hard/daily difficulties use the tangled catalogue.
function growIdentity(seed, difficulty, wires, columns, includeSolution) {
  const random = seededRandom(seed);
  let circuit = Array.from({ length: wires }, () => Array(2).fill(EMPTY));
  const solution = includeSolution ? [] : null;
  for (let step = 0; step < difficulty; step++) {
    const before = circuit;
    const options = getRewriteMoves(circuit, { allowedRules: LEARNED_RULE_IDS }).filter(option => lowerBound(option.next) === step + 1);
    const interesting = options.filter(option => option.move.rule.startsWith('basis') || option.move.rule.startsWith('stabilizer'));
    const pool = interesting.length && random() < .8 ? interesting : options;
    if (!pool.length) throw new Error('Could not grow an identity circuit.');
    const { move, next } = pool[Math.floor(random() * pool.length)];
    // Undo this rewrite, then restore the previous free layout before following
    // the older inverse steps, whose windows use those previous coordinates.
    solution?.unshift(move, { rule: 'arrange', row: 0, column: 0, circuit: before });
    circuit = next;
  }
  if (columns && circuit[0].length < columns) {
    const compact = circuit;
    circuit = circuit.map(row => [...row, ...Array(columns - row.length).fill(EMPTY)]);
    solution?.unshift({ rule: 'arrange', row: 0, column: 0, circuit: compact });
  }
  return { circuit, optimalMoves: difficulty, ...(solution ? { solution } : {}) };
}

// Tools inject the same boards with their witnesses to verify transformations.
// Production generation never loads or retains solution data.
export function createPuzzleGenerator(catalogue, { includeSolution = false } = {}) {
  return function generatePuzzle(seed, difficulty = 12, { wires = 3, columns } = {}) {
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 20) throw new RangeError('Choose a difficulty from 1 to 20.');
    if (!Number.isInteger(wires) || wires < 1 || wires > MAX_WIRES || (columns !== undefined && (!Number.isSafeInteger(columns) || columns < 4 || columns > 256))) throw new RangeError('Choose valid whole-number wire and column counts.');
    const random = seededRandom(`${seed}:catalogue-v2`);
    const entries = catalogue.filter(entry => entry.optimalMoves === difficulty && entry.circuit.length <= wires);
    if (entries.length) return fromCertificate(entries[Math.floor(random() * entries.length)], random, { wires, columns }, includeSolution);
    return growIdentity(seed, difficulty, wires, columns, includeSolution);
  };
}

export const generatePuzzle = createPuzzleGenerator(CERTIFIED_PUZZLES);
export { CERTIFIED_PUZZLES };
