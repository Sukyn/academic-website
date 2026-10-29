import { applyMove, generatePuzzle, isSolved, LEVELS, MAX_MOVES, ruleFamily } from './engine.js';
import { dailyBounds, dailyDate, dateTimestamp, validDailyDate } from '../games/daily-calendar.js';
import { checkSubmissionSize, scoreName, SubmissionError } from '../games/submission.js';

export const CAMPAIGN = 'zx-calculus-campaign-v3';
export const DAILY_START = '2026-10-22';
export const DAILY_VERSION = 'zx-calculus-daily-v3';
export const MAX_SUBMISSION_BYTES = 24_000;

export function dailyPuzzle(date) {
  dateTimestamp(date);
  if (date < DAILY_START) throw new RangeError('Choose an available daily puzzle.');
  return generatePuzzle(`${DAILY_VERSION}:${date}`, 3);
}

export function getBoard(selector, now = Date.now()) {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    throw new SubmissionError('Choose a campaign level or a daily puzzle.');
  }
  if (Object.hasOwn(selector, 'date')) {
    if (Object.hasOwn(selector, 'level')) throw new SubmissionError('Choose a campaign level or a daily puzzle.');
    if (!validDailyDate(selector.date, now, DAILY_START)) throw new SubmissionError('Choose an available daily puzzle.');
    const date = selector.date;
    return { campaign: DAILY_VERSION, level: Number(date.replaceAll('-', '')), puzzle: dailyPuzzle(date), date, ...dailyBounds(date) };
  }
  const level = typeof selector.level === 'number' || typeof selector.level === 'string' ? Number(selector.level) : NaN;
  if (!Number.isInteger(level) || level < 1 || level > LEVELS.length) {
    throw new SubmissionError(`Choose a campaign level from 1 to ${LEVELS.length}.`);
  }
  return { campaign: CAMPAIGN, level, puzzle: LEVELS[level - 1] };
}

/** Scores come from replaying the official diagram, never a client-supplied graph. */
export function validateSubmission(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SubmissionError('Expected a score submission.');
  checkSubmissionSize(input, MAX_SUBMISSION_BYTES, 'Expected a score submission.');
  const board = getBoard(input, now);
  if ('date' in board && board.date !== dailyDate(now)) throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
  const name = scoreName(input.name), sequence = input.sequence;
  if (!Array.isArray(sequence) || !sequence.length || sequence.length > MAX_MOVES) {
    throw new SubmissionError(`Use a replay with 1 to ${MAX_MOVES} moves.`);
  }
  const rules = board.puzzle.rules;
  let diagram = board.puzzle.diagram;
  try {
    for (const move of sequence) {
      if (!rules.includes(ruleFamily(move?.rule))) {
        throw new Error('That rule is not available in this puzzle.');
      }
      diagram = applyMove(diagram, move);
    }
  } catch {
    throw new SubmissionError('That replay contains an invalid ZX rule.');
  }
  if (!isSolved(diagram)) throw new SubmissionError('That replay does not reach the target diagram.');
  return {
    campaign: board.campaign, level: board.level, name, moves: sequence.length,
    ...('date' in board ? { date: board.date, opensAt: board.opensAt, closesAt: board.closesAt } : {}),
  };
}
