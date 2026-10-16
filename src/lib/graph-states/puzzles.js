import { graphsAtDistance } from './engine.js';
import { dateTimestamp } from '../games/daily-calendar.js';
import { seededRandom } from '../games/random.js';

export const DAILY_START = '2026-10-16';
export const DAILY_VERSION = 'graph-states-daily-v1';

/** @type {Array<[string, number, number, number]>} */
const lessonSpecs = [
  ['Open the triangle', 3, 1, 2],
  ['Shift the centre', 3, 1, 0],
  ['Four vertices', 4, 1, 2],
  ['Two neighbourhoods', 4, 2, 4],
  ['Five vertices', 5, 2, 7],
  ['Change the centre', 5, 3, 4],
  ['Six vertices', 6, 3, 23],
  ['Seven vertices', 7, 4, 30],
  ['Crossed paths', 8, 4, 180],
  ['Find the chain', 8, 5, 37],
];

export const LEVELS = lessonSpecs.map(([title, vertices, distance, index]) => {
  const choices = graphsAtDistance(vertices, distance);
  return { title, ...choices[index % choices.length] };
});

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
