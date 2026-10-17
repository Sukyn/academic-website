// Test/offline adapter. Never import this module from production src/ or api/.
import { createPuzzleGenerator, createDailyPuzzleGenerator, CERTIFIED_PUZZLES as boards } from '../../src/lib/circuit-reduction/generator.js';
import { LEVELS as levels, dailyPuzzle as dailyBoard, DAILY_VERSION, DAILY_START } from '../../src/lib/circuit-reduction/puzzles.js';
import { PAPER_MISSIONS, PAPER_MISSION_FOUR_ALTERNATIVE, PAPER_RULE_INTRODUCTIONS } from '../../src/lib/circuit-reduction/paper-missions.js';
import { CATALOGUE_WITNESSES } from './catalogue-witnesses.js';
import { PAPER_WITNESSES } from './paper-witnesses.js';

export const CERTIFIED_PUZZLES = boards.map((board, index) => ({ ...board, solution: CATALOGUE_WITNESSES[index] }));
export const generatePuzzle = createPuzzleGenerator(CERTIFIED_PUZZLES, { includeSolution: true });
const generateDaily = createDailyPuzzleGenerator(CERTIFIED_PUZZLES, { startDate: DAILY_START, version: DAILY_VERSION, includeSolution: true });
const missions = [...PAPER_MISSIONS, PAPER_MISSION_FOUR_ALTERNATIVE, ...PAPER_RULE_INTRODUCTIONS];
export const LEVELS = levels.map(level => {
  const mission = missions.find(mission => mission.circuit === level.circuit);
  const key = mission === PAPER_MISSION_FOUR_ALTERNATIVE ? '4-upper' : mission?.introKey ? `intro-${mission.introKey}` : mission?.sourceMission;
  const solution = mission ? PAPER_WITNESSES[key] : [{ rule: level.id === 1 ? 'cancel-x' : 'cancel-h', row: 0, column: 1 }];
  return { ...level, solution };
});
export function dailyPuzzle(date) {
  const board = dailyBoard(date);
  return { ...board, ...generateDaily(date) };
}
