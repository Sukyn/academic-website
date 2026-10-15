import { applyPlacement, simulate } from './engine.js';
import { DAILY_START, DAILY_VERSION, LEVELS, dailyPuzzle } from './puzzles.js';
import { validDailyDate } from '../games/daily-calendar.js';
import { scoreName, SubmissionError } from '../games/submission.js';

export const CAMPAIGN = 'signals-completions-v1';
export const DAILY_CAMPAIGN = DAILY_VERSION;
export const MAX_SUBMISSION_BYTES = 64_000;
export const MAX_REPLAY_MOVES = 1_000;

export function getBoard(selector, now = Date.now()) {
  if (Object.hasOwn(selector, 'date')) {
    if (Object.hasOwn(selector, 'level')) throw new SubmissionError('Choose a campaign level or a daily puzzle.');
    if (!validDailyDate(selector.date, now, DAILY_START)) throw new SubmissionError('Choose an available daily puzzle.');
    return { campaign: DAILY_CAMPAIGN, level: Number(selector.date.replaceAll('-', '')),
      puzzle: dailyPuzzle(selector.date) };
  }
  const level = typeof selector.level === 'string' || typeof selector.level === 'number' ? Number(selector.level) : NaN;
  if (!Number.isInteger(level) || level < 1 || level > LEVELS.length) {
    throw new SubmissionError(`Choose a campaign level from 1 to ${LEVELS.length}.`);
  }
  return { campaign: CAMPAIGN, level, puzzle: LEVELS[level - 1] };
}

/** Verify a completed circuit; gate counts and editing detours have no bearing. */
export function validateSubmission(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SubmissionError('Expected a completion submission.');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_SUBMISSION_BYTES) {
    throw new SubmissionError('Submission is too large.', 413);
  }
  const board = getBoard(input, now), name = scoreName(input.name);
  if (!Array.isArray(input.sequence) || !input.sequence.length || input.sequence.length > MAX_REPLAY_MOVES) {
    throw new SubmissionError(`Use a replay with 1 to ${MAX_REPLAY_MOVES.toLocaleString('en')} placements.`);
  }
  let placements = {};
  try {
    for (const move of input.sequence) placements = applyPlacement(board.puzzle, placements, move);
  } catch {
    throw new SubmissionError('That replay contains an invalid gate placement.');
  }
  if (!simulate(board.puzzle, placements).solved) throw new SubmissionError('Fill every hole and match the target state.');
  return { campaign: board.campaign, level: board.level, name };
}
