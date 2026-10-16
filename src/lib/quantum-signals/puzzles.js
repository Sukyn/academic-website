import { simulate, stateEqual, validatePuzzle } from './engine.js';
import { dateTimestamp } from '../games/daily-calendar.js';
import { seededRandom } from '../games/random.js';

export const DAILY_START = '2026-10-15';
export const DAILY_VERSION = 'quantum-signals-daily-v4';
const single = (id, wire, choices = ['I', 'H', 'X', 'Z']) => ({ id, wires: [wire], choices });
const pair = (id, first, second) => ({ id, wires: [first, second], choices: ['I', 'CX', 'XC', 'CZ'] });
const fixed = (gate, ...wires) => ({ gate, wires });

function puzzleFromSolution(wires, columns, solution) {
  const initial = { wires, columns, target: Array(2 ** wires).fill(0) };
  initial.target[0] = 1;
  const target = simulate(initial, solution).state;
  return validatePuzzle({ wires, columns, target });
}

/** @type {[string, number, object[][], Record<string, string>][]} */
const lessons = [
  ['Flip the bit', 1,
    [[single('a', 0, ['I', 'X'])]], { a: 'X' }],
  ['Split the beam', 1,
    [[single('a', 0, ['I', 'H', 'X'])]], { a: 'H' }],
  ['Relative phase', 1,
    [[fixed('H', 0)], [single('a', 0, ['I', 'X', 'Z'])]], { a: 'Z' }],
  ['Recombine the beam', 1,
    [[fixed('H', 0)], [single('a', 0)]], { a: 'H' }],
  ['Interference', 1,
    [[fixed('H', 0)], [single('a', 0, ['I', 'X', 'Z'])], [fixed('H', 0)]], { a: 'Z' }],
  ['Flip both bits', 2,
    [[single('a', 0, ['I', 'X']), single('b', 1, ['I', 'X'])]], { a: 'X', b: 'X' }],
  ['Bell pair', 2,
    [[fixed('H', 0)], [pair('a', 0, 1)]], { a: 'CX' }],
  ['Entangled phase', 2,
    [[fixed('H', 0)], [fixed('CX', 0, 1)], [single('a', 0, ['I', 'X', 'Z'])]], { a: 'Z' }],
  ['Undo entanglement', 2,
    [[fixed('H', 0)], [fixed('CX', 0, 1)], [pair('a', 0, 1)], [single('b', 0)]], { a: 'CX', b: 'H' }],
  ['Controlled phase', 2,
    [[fixed('H', 0), fixed('H', 1)], [pair('a', 0, 1)], [single('b', 1)]], { a: 'CZ', b: 'H' }],
  ['Three-qubit correlation', 3,
    [[single('a', 0)], [pair('b', 0, 1)], [pair('c', 1, 2)]], { a: 'H', b: 'CX', c: 'CX' }],
  ['Interference network', 3,
    [[single('a', 0)], [pair('b', 0, 1)], [fixed('H', 2)], [pair('c', 1, 2)],
      [single('d', 1)], [single('e', 2)], [fixed('CX', 0, 2)]],
    { a: 'H', b: 'CX', c: 'CZ', d: 'H', e: 'Z' }],
];

export const LEVELS = lessons.map(([title, wires, columns, solution]) => ({ title, ...puzzleFromSolution(wires, columns, solution) }));

export function generatePuzzle(seed, difficulty = 2) {
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 ||
      !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new RangeError('Choose a seed and a difficulty from 1 to 3.');
  const random = seededRandom(seed), wires = difficulty;
  const columns = difficulty === 1 ? [
    [single('a', 0)], [fixed('H', 0)], [single('b', 0)], [fixed('Z', 0)], [single('c', 0)], [fixed('H', 0)],
  ] : difficulty === 2 ? [
    [fixed('H', 0)], [single('a', 0)], [pair('b', 0, 1)], [single('c', 1)],
    [fixed('H', 0)], [pair('d', 1, 0)], [fixed('H', 1)],
  ] : [
    [fixed('H', 0)], [single('a', 1)], [pair('b', 0, 1)], [single('c', 2)],
    [pair('d', 1, 2)], [fixed('H', 1)], [single('e', 0)], [pair('f', 2, 0)], [fixed('H', 2)],
  ];
  const holes = columns.flat().filter(entry => entry.id);
  const singles = holes.filter(hole => hole.wires.length === 1);
  const identity = random() < .5 ? singles[Math.floor(random() * singles.length)] : null;
  // In real Clifford circuits, an extra H flips the parity of log2(populated
  // basis states). Other hole choices only permute or change signs, so cannot compensate.
  if (identity) for (const hole of singles) {
    hole.choices = hole === identity ? ['I', 'H'] : hole.choices.filter(gate => gate !== 'H');
  }
  const puzzle = puzzleFromSolution(wires, columns, {});
  for (let attempt = 0; attempt < 32; attempt++) {
    const solution = Object.fromEntries(holes.map(hole => [hole.id, hole === identity ? 'I' : hole.choices[Math.floor(random() * hole.choices.length)]]));
    const target = simulate(puzzle, solution).state;
    if (!stateEqual(target, puzzle.target)) return { ...puzzle, target };
  }
  // X and Z cannot both leave the baseline unchanged on this wire. Try one
  // gate if the random fillings all happened to reproduce the untouched state.
  const active = singles.find(hole => hole !== identity);
  for (const gate of active.choices.filter(gate => gate !== 'I')) {
    const target = simulate(puzzle, { [active.id]: gate }).state;
    if (!stateEqual(target, puzzle.target)) return { ...puzzle, target };
  }
  throw new Error('Could not generate a nontrivial circuit.');
}

const dailyCache = new Map();
export function dailyPuzzle(date) {
  dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Choose an available daily puzzle.');
  if (!dailyCache.has(date)) {
    if (dailyCache.size >= 128) dailyCache.delete(dailyCache.keys().next().value);
    const puzzle = { ...generatePuzzle(`${DAILY_VERSION}:${date}`, 3), date };
    dailyCache.set(date, puzzle);
  }
  return structuredClone(dailyCache.get(date));
}
