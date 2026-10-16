import { simulate } from './engine.js';
import { LEVELS } from './puzzles.js';

export const TUTORIAL_STEPS = [
  { hole: 'a', gate: 'H', text: 'Use H to split 000 into 000 and 100 with equal probabilities.' },
  { hole: 'b', gate: 'CX', text: 'CNOT flips its target bit when its control bit is 1. Here, 100 becomes 110.' },
  { hole: 'c', gate: 'CZ', text: 'CZ swaps black (+) and white (−) dots where both linked bits are 1.' },
  { hole: 'd', gate: 'H', text: 'Here H splits each incoming path in two. A 1 on its wire gives the branches opposite phases.' },
  { hole: 'f', gate: 'H', text: 'Use H here to recombine paths that differ on its wire’s bit. Watch where white and dark paths meet.' },
  { target: '.signal-flow-cancellation', text: 'The walls mark where white and dark paths cancel. No signal continues from them to the next gate.' },
  { hole: 'e', gate: 'Z', text: 'Z swaps black (+) and white (−) dots when its wire’s bit is 1. Use it to match the target.' },
];

const lesson = LEVELS.at(-1);
const phaseColumn = lesson.columns.find(column => column.some(entry => entry.id === 'e'));
const circuit = { wires: lesson.wires,
  columns: [...lesson.columns.filter(column => column !== phaseColumn), [{ id: 'f', wires: [2], choices: ['I', 'H'] }], phaseColumn],
  target: lesson.target };
const solution = Object.fromEntries(TUTORIAL_STEPS.filter(step => step.hole).map(({ hole, gate }) => [hole, gate]));
export const TUTORIAL_PUZZLE = { ...circuit, target: simulate(circuit, solution).state };
