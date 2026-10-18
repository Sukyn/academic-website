import { applyMove, isSolved, moveCost, sequenceCost, LEARNED_RULE_IDS } from "./engine.js";
import { CAMPAIGN_VERSION, DAILY_START, DAILY_VERSION, LEVELS, dailyPuzzle } from "./puzzles.js";
import { dailyBounds, dailyDate, validDailyDate } from "../games/daily-calendar.js";
import { checkSubmissionSize, scoreName, SubmissionError } from "../games/submission.js";

export const CAMPAIGN = CAMPAIGN_VERSION;
export const MAX_SUBMISSION_BYTES = 256_000;
export const MAX_REPLAY_MOVES = 2_000;
export { SubmissionError } from "../games/submission.js";

export function getLevel(id) {
  const value = typeof id === "string" ? Number(id) : id;
  const level = LEVELS.find(item => item.id === value);
  if (!level) throw new SubmissionError(`Choose a campaign level from 1 to ${LEVELS.length}.`);
  return level;
}

export function getBoard(selector, now = Date.now()) {
  if (Object.hasOwn(selector, "date")) {
    if (Object.hasOwn(selector, "level")) throw new SubmissionError("Choose a campaign level or a daily puzzle.");
    if (!validDailyDate(selector.date, now, DAILY_START)) throw new SubmissionError("Choose an available daily puzzle.");
    const date = selector.date;
    return {
      campaign: DAILY_VERSION, level: Number(date.replaceAll("-", "")),
      puzzle: dailyPuzzle(date), date, ...dailyBounds(date),
    };
  }
  const puzzle = getLevel(selector.level);
  return { campaign: CAMPAIGN, level: puzzle.id, puzzle };
}

export function validateSubmission(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("Expected a score submission.");
  }
  // A body game selector remains supported when the URL has no selector. Keep
  // its replay resource budget identical to explicitly selected requests.
  checkSubmissionSize(input, MAX_SUBMISSION_BYTES, "Expected a score submission.");
  const board = getBoard(input, now);
  if ("date" in board && board.date !== dailyDate(now)) {
    throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
  }
  const name = scoreName(input.name);
  const sequence = input.sequence;
  if (!Array.isArray(sequence) || !sequence.length || sequence.length > MAX_REPLAY_MOVES) {
    throw new SubmissionError(`Use a replay with 1 to ${MAX_REPLAY_MOVES.toLocaleString("en")} moves.`);
  }
  let circuit = board.puzzle.circuit;
  const allowedRules = board.puzzle.allowedRules ?? LEARNED_RULE_IDS;
  let work = 0;
  try {
    for (const move of sequence) {
      if (!move || typeof move !== "object" || Array.isArray(move)) {
        throw new Error("Invalid replay move.");
      }
      if (moveCost(move) && !allowedRules.includes(move.rule)) throw new Error("That rule is not unlocked in this lesson.");
      const resultingWidth = move.rule === "arrange" ? move.circuit?.[0]?.length
        : ["insert-space", "insert-column"].includes(move.rule) ? circuit[0].length + (move.count ?? 1) : circuit[0].length;
      // This is a server replay-work budget, independent of the game's unlimited
      // horizontal layout. In particular, one hostile count cannot allocate a huge array.
      if (!Number.isSafeInteger(resultingWidth) || resultingWidth < 1 || (work += resultingWidth * circuit.length) > 4_000_000) throw new Error("Replay processing budget exceeded.");
      circuit = applyMove(circuit, move);
    }
  } catch {
    throw new SubmissionError("That replay contains an illegal circuit rule.");
  }
  if (!isSolved(circuit)) throw new SubmissionError("That replay does not reduce this circuit to the identity.");
  const moves = sequenceCost(sequence);
  if (moves < board.puzzle.optimalMoves) {
    throw new SubmissionError("That score is below the verified minimum.");
  }
  return {
    campaign: board.campaign, level: board.level, name, moves,
    ...("date" in board ? { date: board.date, opensAt: board.opensAt, closesAt: board.closesAt } : {}),
  };
}
