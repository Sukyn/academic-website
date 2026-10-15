export const TUTORIAL_STEPS = [
  { hole: 'a', gate: 'H', text: 'Use H to split 000 into 000 and 100 with equal probabilities.' },
  { hole: 'b', gate: 'CX', text: 'CNOT flips the middle bit when the first bit is 1: 100 becomes 110.' },
  { hole: 'c', gate: 'CZ', text: 'CZ swaps black (+) and white (−) dots where both linked bits are 1.' },
  { hole: 'd', gate: 'H', text: 'Use H to split the four lit paths into eight.' },
  { hole: 'e', gate: 'Z', text: 'Z swaps black (+) and white (−) dots where the last bit is 1. Apply it to match the target.' },
];
