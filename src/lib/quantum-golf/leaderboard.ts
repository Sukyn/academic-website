import campaign from "./campaign.json" with { type: "json" };
import { START_STATE, applyGate, traceDistance } from "./quantum.js";
import { DAILY_VERSION, dailyBounds, dailyDate, dailyPuzzle, validDailyDate } from "./daily.js";

export const CAMPAIGN = campaign.version;
export const MAX_SUBMISSION_BYTES = 4_500_000;

export class SubmissionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getLevel(id: unknown) {
  const value = typeof id === "string" ? Number(id) : id;
  const level = campaign.levels.find(item => item.id === value);
  if (!level) throw new SubmissionError(`Choose a campaign level from 1 to ${campaign.levels.length}.`);
  return level;
}

export function getBoard(selector: { level?: unknown; date?: unknown }, now = Date.now()) {
  if (Object.hasOwn(selector, "date")) {
    if (Object.hasOwn(selector, "level")) throw new SubmissionError("Choose a campaign level or a daily puzzle.");
    if (!validDailyDate(selector.date, now)) throw new SubmissionError("Choose an available daily puzzle.");
    const date = selector.date as string;
    return {
      campaign: DAILY_VERSION, level: Number(date.replaceAll("-", "")),
      hole: dailyPuzzle(date), date, ...dailyBounds(date),
    };
  }
  const hole = getLevel(selector.level);
  return { campaign: CAMPAIGN, level: hole.id, hole };
}

export function validateSubmission(input: unknown, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("Expected a score submission.");
  }
  const payload = input as { level?: unknown; date?: unknown; name?: unknown; sequence?: unknown };
  const board = getBoard(payload, now);
  if ("date" in board && board.date !== dailyDate(now)) {
    throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
  }
  const level = board.hole;
  const name = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/gu, " ") : "";
  if (!name || Array.from(name).length > 24 || /\p{C}/u.test(name)) {
    throw new SubmissionError("Use a name of 1 to 24 characters.");
  }
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

export async function readSubmission(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SubmissionError("Expected a JSON submission.");
  let size = 0, body = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SUBMISSION_BYTES) {
      await reader.cancel();
      throw new SubmissionError("Submission is too large.", 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try { return JSON.parse(body); }
  catch { throw new SubmissionError("Expected a JSON submission."); }
}
