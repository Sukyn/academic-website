import { normalize } from './quantum.js';
import { solveShortest } from './solver.js';
import { DAY, dateTimestamp, validDailyDate as validCalendarDate } from '../games/daily-calendar.js';
export { DAILY_TIME_ZONE, dailyDate, dailyBounds } from '../games/daily-calendar.js';

export const DAILY_VERSION = 'quantum-golf-daily-v1-plus';
export const DAILY_START = '2026-10-13';
const EPSILON = 0.09;
const cache = new Map();

export function validDailyDate(date, now = Date.now()) {
  return validCalendarDate(date, now, DAILY_START);
}

// Freeze the seed, geometry and hole size under DAILY_VERSION. Campaign edits
// must never change an existing daily puzzle or invalidate its scores.
export function dailyPuzzle(date) {
  const timestamp = dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Daily puzzles have not started on this date.');
  const cached = cache.get(date);
  if (cached) return cached;
  let seed = (Math.trunc(timestamp / DAY) ^ 0x9e3779b9) >>> 0;
  // Scramble adjacent day numbers before the xorshift sequence.
  seed = Math.imul(seed ^ (seed >>> 16), 0x21f0aaad);
  seed = Math.imul(seed ^ (seed >>> 15), 0x735a2d97);
  seed = (seed ^ (seed >>> 15)) >>> 0;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4_294_967_296;
  };
  const certify = target => {
    const solution = solveShortest(target, EPSILON, { maxDepth: 12, maxNodes: 5_000 });
    if (solution.status !== 'optimal' || solution.optimalMoves < 8) return null;
    return Object.freeze({ date, target: Object.freeze(target), epsilon: EPSILON,
      optimalMoves: solution.optimalMoves });
  };
  let puzzle;
  for (let attempt = 0; attempt < 32 && !puzzle; attempt++) {
    const z = 2 * random() - 1, angle = 2 * Math.PI * random();
    const radius = Math.sqrt(1 - z * z);
    puzzle = certify([radius * Math.cos(angle), radius * Math.sin(angle), z]);
  }
  if (!puzzle) {
    // This eight-move point stays safely inside its hole under this small jitter;
    // every state with seven or fewer moves stays well outside. Recheck anyway.
    const anchor = [0.8646978923202396, 0.48290953952413723, 0.13818803006599753];
    puzzle = certify(normalize(anchor.map(value => value + 0.01 * (random() - 0.5))));
  }
  if (!puzzle) throw new Error('Could not certify the daily puzzle.');
  // Limit server memory when visitors explore many archived days.
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(date, puzzle);
  return puzzle;
}
