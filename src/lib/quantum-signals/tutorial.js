import { simulate } from './engine.js';

export const TUTORIAL_STEPS = [
  { hole: 'a', gate: 'H', text: 'H on the first wire splits each incoming path into two that differ in the first bit.' },
  { hole: 'b', gate: 'CX', text: 'CNOT flips the second bit when the first bit is 1.' },
  { hole: 'c', gate: 'CZ', bits: [0, 1], text: 'CZ acts on the first two wires: look at the highlighted first two bits. It flips the phase on labels starting with 11.' },
  { hole: 'd', gate: 'H', text: 'H on the second wire splits each path. An incoming 1 on that wire gives the two branches opposite phases.' },
  { hole: 'f', gate: 'H', text: 'Use H again on the second wire to recombine paths. Watch where white and dark paths meet.' },
  { target: '.signal-flow-cancellation', text: 'The walls mark where white and dark paths cancel. No signal continues from them to the next gate.' },
  { hole: 'e', gate: 'Z', text: 'Z on the third wire swaps black (+) and white (−) dots when the third bit is 1. Match the target.' },
];

const single = (id, wire) => ({ id, wires: [wire], choices: ['I', 'H', 'X', 'Z'] });
const pair = id => ({ id, wires: [0, 1], choices: ['I', 'CX', 'XC', 'CZ'] });
const circuit = { wires: 3, columns: [
  [{ gate: 'H', wires: [2] }],
  [single('a', 0)], [pair('b')], [pair('c')],
  [single('d', 1)], [single('f', 1)], [single('e', 2)],
], target: [1, 0, 0, 0, 0, 0, 0, 0] };
const solution = Object.fromEntries(TUTORIAL_STEPS.filter(step => step.hole).map(({ hole, gate }) => [hole, gate]));
export const TUTORIAL_PUZZLE = { ...circuit, target: simulate(circuit, solution).state };
