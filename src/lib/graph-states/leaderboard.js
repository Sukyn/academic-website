import { applyMove, isSolved, MAX_MOVES, sequenceCost } from './engine.js';
import { DAILY_START, DAILY_VERSION, LEVELS, dailyPuzzle } from './puzzles.js';
import { dailyBounds, dailyDate, validDailyDate } from '../games/daily-calendar.js';
import { scoreName, SubmissionError } from '../games/submission.js';

export const CAMPAIGN = 'graph-states-campaign-v1';
export const DAILY_CAMPAIGN = DAILY_VERSION;
export const MAX_SUBMISSION_BYTES = 16_000;

export function getBoard(selector, now = Date.now()) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new SubmissionError('Choose a campaign level or a daily puzzle.');
  if (Object.hasOwn(selector, 'date')) {
    if (Object.hasOwn(selector, 'level')) throw new SubmissionError('Choose a campaign level or a daily puzzle.');
    if (!validDailyDate(selector.date, now, DAILY_START)) throw new SubmissionError('Choose an available daily puzzle.');
    const date = selector.date;
    return { campaign: DAILY_CAMPAIGN, level: Number(date.replaceAll('-', '')), puzzle: dailyPuzzle(date), date, ...dailyBounds(date) };
  }
  const level = typeof selector.level === 'string' || typeof selector.level === 'number' ? Number(selector.level) : NaN;
  if (!Number.isInteger(level) || level < 1 || level > LEVELS.length) {
    throw new SubmissionError(`Choose a campaign level from 1 to ${LEVELS.length}.`);
  }
  return { campaign: CAMPAIGN, level, puzzle: LEVELS[level - 1] };
}

/** Replay the official graph and count each local complementation as one shot. */
export function validateSubmission(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SubmissionError('Expected a score submission.');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_SUBMISSION_BYTES) {
    throw new SubmissionError('Submission is too large.', 413);
  }
  const board = getBoard(input, now);
  if ('date' in board && board.date !== dailyDate(now)) throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
  const name = scoreName(input.name);
  if (!Array.isArray(input.sequence) || !input.sequence.length || input.sequence.length > MAX_MOVES) {
    throw new SubmissionError(`Use a replay with 1 to ${MAX_MOVES} operations.`);
  }
  let graph = board.puzzle;
  try {
    for (const move of input.sequence) graph = applyMove(graph, move);
  } catch {
    throw new SubmissionError('That replay contains an invalid graph operation.');
  }
  if (!isSolved(graph)) throw new SubmissionError('Match the target chain.');
  return { campaign: board.campaign, level: board.level, name, moves: sequenceCost(input.sequence),
    ...('date' in board ? { date: board.date, opensAt: board.opensAt, closesAt: board.closesAt } : {}) };
}
