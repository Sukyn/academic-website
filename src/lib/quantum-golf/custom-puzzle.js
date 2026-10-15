import { normalize } from './quantum.js';

export function validateCustomPuzzle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !Array.isArray(input.target) || input.target.length !== 3 ||
      !input.target.every(Number.isFinite) || !Number.isFinite(input.epsilon) ||
      input.epsilon < .03 || input.epsilon > .4) {
    throw new RangeError('Use a three-number target and a hole size from 0.03 to 0.4.');
  }
  return { target: normalize(input.target), epsilon: input.epsilon };
}
