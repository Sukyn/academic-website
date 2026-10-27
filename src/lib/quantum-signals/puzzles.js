import { simulate, solvePuzzle, validatePuzzle } from './engine.js';
import { dateTimestamp } from '../games/daily-calendar.js';
import { seededRandom } from '../games/random.js';

export const DAILY_START = '2026-10-25';
export const DAILY_VERSION = 'quantum-signals-daily-v7';
const single = (id, wire, choices = ['I', 'H', 'X', 'Z']) => ({ id, wires: [wire], choices });
const fixed = (gate, ...wires) => ({ gate, wires });

// The introductory lessons retain their small, independent worked examples.
function fromFilling(wires, holes, filling, preparation) {
  if (!preparation) {
    const operations = [...Array.from({ length: wires }, (_, wire) => fixed('X', wire)),
      ...holes.flat().map(hole => fixed(filling[hole.id] ?? 'I', ...hole.wires)).reverse()];
    const stack = [];
    for (const operation of operations) {
      if (operation.gate === 'I') continue;
      if (JSON.stringify(stack.at(-1)) === JSON.stringify(operation)) stack.pop();
      else stack.push(operation);
    }
    preparation = stack.map(operation => [operation]);
  }
  return validatePuzzle({ wires, columns: [...preparation, ...holes] });
}

/** @type {[title: string, wires: number, holes: object[][], filling: Record<string, string>, preparation?: object[][]][]} */
const lessons = [
  ['Flip the bit', 1, [[single('a', 0, ['I', 'X'])]], { a: 'X' }],
  ['Recombine two paths', 1, [[single('a', 0, ['I', 'H'])], [single('b', 0, ['I', 'X'])]], { a: 'H', b: 'X' }],
  ['Relative phase', 1, [[single('a', 0, ['I', 'X', 'Z'])], [single('b', 0, ['I', 'H'])]], { a: 'Z', b: 'H' }],
  ['Recombine the beam', 1, [[single('a', 0, ['I', 'H'])]], { a: 'H' }, [[fixed('H', 0)], [fixed('Z', 0)]]],
  ['Interference', 1, [[single('a', 0, ['I', 'H'])], [single('b', 0, ['I', 'Z'])], [single('c', 0, ['I', 'H'])]], { a: 'H', b: 'Z', c: 'H' }],
  ['Flip both bits', 2, [[single('a', 0, ['I', 'X']), single('b', 1, ['I', 'X'])]], { a: 'X', b: 'X' }],
];

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

// A tree graph state is peeled one leaf at a time with H and CNOT. Z phases
// before peeling select the all-ones result. The final root H is always imposed.
function graphPuzzle(random, wires, { bait = false, strict = false, phaseHoles = Math.max(1, wires - 1), hHoles = 1 } = {}) {
  let nextId = 0;
  const hole = (gate, gateWires) => {
    const id = String.fromCharCode(97 + nextId++);
    const alternatives = gateWires.length === 1 ? ['H', 'X', 'Z'] : ['CX', 'XC', 'CZ'];
    const decoys = strict ? [] : shuffle(alternatives.filter(other => other !== gate), random).slice(0, Math.floor(random() * 3));
    return { id, wires: gateWires, choices: ['I', gate, ...decoys] };
  };
  if (wires === 1) {
    const phase = [hole('Z', [0])];
    if (bait) phase.splice(Math.floor(random() * 2), 0, { ...hole('Z', [0]), choices: strict ? ['I', 'Z'] : ['I', ...shuffle(['H', 'X', 'Z'], random)] });
    return validatePuzzle({ wires, columns: [[hole('H', [0])], ...phase.map(entry => [entry]), [fixed('H', 0)]] });
  }
  const order = shuffle(Array.from({ length: wires }, (_, wire) => wire), random), root = order[0];
  const tree = order.slice(1).map((wire, index) => [order[Math.floor(random() * (index + 1))], wire]);
  const phases = new Set(shuffle(order, random).slice(0, phaseHoles));
  const middle = [...tree.map(edge => fixed('CZ', ...edge)),
    ...order.map(wire => phases.has(wire) ? hole('Z', [wire]) : fixed('Z', wire))];
  if (bait) {
    const wire = [...phases][Math.floor(random() * phases.size)];
    const entry = hole('Z', [wire]);
    middle.push({ ...entry, choices: strict ? ['I', 'Z'] : entry.choices });
  }
  const columns = random() < .5 ? [order.map(wire => fixed('H', wire))] : order.map(wire => [fixed('H', wire)]);
  for (const entry of shuffle(middle, random)) {
    const previous = columns.at(-1);
    if (random() < .5 && previous.every(other => other.gate !== 'H' && !other.wires.some(wire => entry.wires.includes(wire)))) previous.push(entry);
    else columns.push([entry]);
  }
  const remaining = [...tree], leaves = [];
  while (remaining.length) {
    const available = remaining.filter(([, wire]) => !remaining.some(([parent]) => parent === wire));
    const edge = available[Math.floor(random() * available.length)];
    leaves.push(edge); remaining.splice(remaining.indexOf(edge), 1);
  }
  const editableH = new Set(shuffle(leaves.map(([, wire]) => wire), random).slice(0, hHoles));
  for (const [parent, wire] of leaves) {
    columns.push([editableH.has(wire) ? hole('H', [wire]) : fixed('H', wire)]);
    const reversed = random() < .5;
    columns.push([hole(reversed ? 'XC' : 'CX', reversed ? [wire, parent] : [parent, wire])]);
  }
  columns.push([fixed('H', root)]);
  return validatePuzzle({ wires, columns });
}

/** @type {[title: string, wires: number, seed: string, phaseHoles: number, hHoles: number][]} */
const advancedLessons = [
  ['Bell pair', 2, 'bell-pair', 1, 1],
  ['Entangled phase', 2, 'entangled-phase', 2, 1],
  ['Undo entanglement', 2, 'undo-entanglement', 1, 1],
  ['Controlled phase', 2, 'controlled-phase', 2, 1],
  ['Three-qubit correlation', 3, 'three-qubit', 2, 1],
  ['Interference network', 3, 'interference-network', 2, 2],
];

export const LEVELS = [
  ...lessons.map(([title, wires, holes, filling, preparation]) => ({ title, ...fromFilling(wires, holes, filling, preparation) })),
  ...advancedLessons.map(([title, wires, seed, phaseHoles, hHoles]) => ({ title,
    ...graphPuzzle(seededRandom(seed), wires, { strict: true, phaseHoles, hHoles }) })),
];

function needsInterference(puzzle) {
  if (simulate(puzzle).state.filter(amplitude => Math.abs(amplitude) > 1e-9).length < 2) return false;
  const solutions = solvePuzzle(puzzle, { limit: 4096 });
  return solutions.length > 0 && solutions.every(solution => {
    const gates = Object.values(solution);
    return gates.includes('H') && gates.includes('Z') &&
      (puzzle.wires === 1 || gates.some(gate => gate === 'CX' || gate === 'XC' || gate === 'CZ'));
  });
}

export function generatePuzzle(seed, difficulty = 2) {
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 ||
      !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new RangeError('Choose a seed and a difficulty from 1 to 3.');
  const random = seededRandom(seed), bait = random() < .5;
  for (let attempt = 0; attempt < 8; attempt++) {
    const puzzle = graphPuzzle(random, difficulty, { bait,
      phaseHoles: difficulty === 2 ? 1 + Number(random() < .5) : Math.max(1, difficulty - 1),
      hHoles: difficulty === 3 && !bait ? 1 + Number(random() < .5) : 1 });
    if (needsInterference(puzzle)) return puzzle;
  }
  // Binary choices preserve the known graph-peeling solution without decoy routes.
  return graphPuzzle(random, difficulty, { bait, strict: true });
}

const dailyCache = new Map();
export function dailyPuzzle(date) {
  dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Choose an available daily puzzle.');
  if (!dailyCache.has(date)) {
    if (dailyCache.size >= 128) dailyCache.delete(dailyCache.keys().next().value);
    dailyCache.set(date, { ...generatePuzzle(`${DAILY_VERSION}:${date}`, 3), date });
  }
  return structuredClone(dailyCache.get(date));
}
