export const PHASE_COLORS = Object.freeze({ positive: '#000000', negative: '#ffffff' });
export const PHASE_PATH_COLORS = Object.freeze({ positive: '#6d7b71', negative: '#f5f5f2' });
export const CANCELLATION_WALL = [[-3, -7], [0, -7], [0, 7], [-3, 7]];
export const phaseColor = amplitude => amplitude < 0 ? PHASE_COLORS.negative : PHASE_COLORS.positive;
export const phasePathColor = amplitude => amplitude < 0 ? PHASE_PATH_COLORS.negative : PHASE_PATH_COLORS.positive;
export const targetRadius = amplitude => Math.min(6, 16 * Math.abs(amplitude));

// Layout only: amplitudes keep their binary basis index in the simulator and JSON.
export const grayBasis = row => row ^ (row >>> 1);
export function basisRow(basis) {
  let row = basis;
  for (let shifted = basis >>> 1; shifted; shifted >>>= 1) row ^= shifted;
  return row;
}

// Pick the goal's global phase once, independently of the player's circuit.
export function canonicalTarget(target) {
  const sign = target.find(amplitude => Math.abs(amplitude) > 1e-9) < 0 ? -1 : 1;
  return target.map(amplitude => amplitude === 0 ? 0 : amplitude * sign);
}
