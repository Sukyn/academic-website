import { generatePuzzle } from './generator.js';
import { seededRandom } from './engine.js';
import { dateTimestamp } from '../games/daily-calendar.js';
import { PAPER_MISSIONS, PAPER_MISSION_FOUR_ALTERNATIVE, PAPER_RULE_INTRODUCTIONS } from './paper-missions.js';
export const DAILY_START = '2026-10-14';
export const DAILY_VERSION = 'circuit-reduction-daily-v2';
export const CAMPAIGN_VERSION = 'circuit-reduction-v2';
const paper = id => PAPER_MISSIONS.find(mission => mission.sourceMission === id);
const introduction = key => PAPER_RULE_INTRODUCTIONS.find(mission => mission.introKey === key);
const lessons = [
  { title: 'Cancel two flips', circuit: [['.', 'X', 'X', '.']], allowedRules: ['cancel-x'], optimalMoves: 1 },
  { title: 'Cancel two Hadamards', circuit: [['.', 'H', 'H', '.']], allowedRules: ['cancel-x', 'cancel-h'], optimalMoves: 1 },
  paper(1), paper(2), paper(3), paper(4), PAPER_MISSION_FOUR_ALTERNATIVE,
  paper(5), paper(6), paper(7), paper(8),
  introduction('phase'), paper(11), introduction('order'), paper(9), paper(10),
  paper(12), paper(13), introduction('stabilizer'), paper(14), paper(15), paper(16),
];
export const LEVELS = lessons.map(({ sourceMission, introKey, ...lesson }, index) => ({ ...lesson, id: index + 1 }));
const cache = new Map();
export function dailyPuzzle(date) {
  dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Choose an available daily puzzle.');
  if (cache.has(date)) return structuredClone(cache.get(date));
  const difficulty = 10 + Math.floor(seededRandom(DAILY_VERSION + ':' + date + ':difficulty')() * 5);
  const puzzle = { date, ...generatePuzzle(DAILY_VERSION + ':' + date, difficulty) };
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(date, puzzle);
  return structuredClone(puzzle);
}
