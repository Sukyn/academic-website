export const PHASE_COLORS = Object.freeze({ positive: '#000000', negative: '#ffffff' });
export const PHASE_PATH_COLORS = Object.freeze({ positive: '#8e9b93', negative: '#ffffff' });
export const GOAL_COLOR = '#f2d572', GOAL_RADIUS = 9;
export const CANCELLATION_WALL = [[-3, -7], [0, -7], [0, 7], [-3, 7]];
export const phaseColor = amplitude => amplitude < 0 ? PHASE_COLORS.negative : PHASE_COLORS.positive;
export const phasePathColor = amplitude => amplitude < 0 ? PHASE_PATH_COLORS.negative : PHASE_PATH_COLORS.positive;
