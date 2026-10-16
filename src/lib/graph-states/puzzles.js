import { graphsAtDistance } from './engine.js';
import { dateTimestamp } from '../games/daily-calendar.js';
import { seededRandom } from '../games/random.js';

export const DAILY_START = '2026-10-16';
export const DAILY_VERSION = 'graph-states-daily-v1';

// Store fixed lessons without building unrelated graph orbits at startup.
export { default as LEVELS } from './levels.json' with { type: 'json' };

/** Pick from the exact orbit: every puzzle is reachable and needs real moves. */
export function generatePuzzle(seed, difficulty = 2) {
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 ||
      !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
    throw new RangeError('Choose a seed and a difficulty from 1 to 3.');
  }
  const random = seededRandom(seed), vertices = 2 * difficulty + 2;
  const choices = graphsAtDistance(vertices, difficulty + 1);
  if (difficulty === 3) choices.push(...graphsAtDistance(vertices, 5));
  return choices[Math.floor(random() * choices.length)];
}

export function dailyPuzzle(date) {
  dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Choose an available daily puzzle.');
  const choices = [...graphsAtDistance(8, 4), ...graphsAtDistance(8, 5)];
  const random = seededRandom(`${DAILY_VERSION}:${date}`);
  return { ...choices[Math.floor(random() * choices.length)], date };
}
