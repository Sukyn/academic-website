import campaign from "./campaign.json" with { type: "json" };
import { START_STATE, applyGate, traceDistance } from "./quantum.js";
import { DAILY_VERSION, dailyBounds, dailyDate, dailyPuzzle, validDailyDate } from "./daily.js";
import { SubmissionError, scoreName } from "../games/submission.js";
export { MAX_SUBMISSION_BYTES, SubmissionError, readSubmission } from "../games/submission.js";

export const CAMPAIGN = campaign.version;
export function getLevel(id) {
  const value = typeof id === "string" ? Number(id) : id;
  const level = campaign.levels.find(item => item.id === value);
  if (!level) throw new SubmissionError(`Choose a campaign level from 1 to ${campaign.levels.length}.`);
  return level;
}

export function getBoard(selector, now = Date.now()) {
  if (Object.hasOwn(selector, "date")) {
    if (Object.hasOwn(selector, "level")) throw new SubmissionError("Choose a campaign level or a daily puzzle.");
    if (!validDailyDate(selector.date, now)) throw new SubmissionError("Choose an available daily puzzle.");
    const date = selector.date;
    return {
      campaign: DAILY_VERSION, level: Number(date.replaceAll("-", "")),
      hole: dailyPuzzle(date), date, ...dailyBounds(date),
    };
  }
  const hole = getLevel(selector.level);
  return { campaign: CAMPAIGN, level: hole.id, hole };
}

export function validateSubmission(input, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("Expected a score submission.");
  }
  const payload = input;
  const board = getBoard(payload, now);
  if ("date" in board && board.date !== dailyDate(now)) {
    throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
  }
  const level = board.hole;
  const name = scoreName(payload.name);
  const sequence = payload.sequence;
  if (typeof sequence !== "string" || !sequence.length || /[^HT]/.test(sequence)) {
    throw new SubmissionError("Use one or more H/T gates.");
  }
  let state = START_STATE;
  for (const gate of sequence) state = applyGate(state, gate);
  if (traceDistance(state, level.target) > level.epsilon + 1e-12) {
    throw new SubmissionError("That circuit does not reach this level's hole.");
  }
  if (sequence.length < level.optimalMoves) {
    throw new SubmissionError("That score is below the verified minimum.");
  }
  return {
    campaign: board.campaign, level: board.level, name, moves: sequence.length,
    ...("date" in board ? { date: board.date, opensAt: board.opensAt, closesAt: board.closesAt } : {}),
  };
}
