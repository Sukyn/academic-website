export const PHASE_COLORS = Object.freeze({ positive: '#000000', negative: '#ffffff' });
export const PHASE_PATH_COLORS = Object.freeze({ positive: '#6d7b71', negative: '#f5f5f2' });
export const CANCELLATION_WALL = [[-3, -7], [0, -7], [0, 7], [-3, 7]];
export const phaseColor = amplitude => amplitude < 0 ? PHASE_COLORS.negative : PHASE_COLORS.positive;
export const phasePathColor = amplitude => amplitude < 0 ? PHASE_PATH_COLORS.negative : PHASE_PATH_COLORS.positive;
export const targetRadius = amplitude => Math.min(6, 16 * Math.abs(amplitude));

// Compare relative phase in the output's reference frame. One global sign may
// change; flipping individual outcomes would hide a physically different state.
export function alignTarget(target, output) {
  const populated = amplitude => Math.abs(amplitude) > 1e-9;
  const common = target.findIndex((amplitude, index) => populated(amplitude) && populated(output[index]));
  const reference = common < 0 ? target.find(populated) : target[common] * output[common];
  const sign = reference < 0 ? -1 : 1;
  return target.map(amplitude => amplitude === 0 ? 0 : amplitude * sign);
}
