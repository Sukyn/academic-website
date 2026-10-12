import campaign from "./campaign.json" with { type: "json" };
import { ZERO_STATE, applyGate, traceDistance } from "./quantum.js";

export const CAMPAIGN = campaign.version;
export const MAX_SEQUENCE = 512;

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
  if (!level) throw new SubmissionError("Choose a campaign level from 1 to 10.");
  return level;
}

export function validateSubmission(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SubmissionError("Expected a score submission.");
  }
  const payload = input as { level?: unknown; name?: unknown; sequence?: unknown };
  const level = getLevel(payload.level);
  const name = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/gu, " ") : "";
  if (!name || Array.from(name).length > 24 || /\p{C}/u.test(name)) {
    throw new SubmissionError("Use a name of 1 to 24 characters.");
  }
  const sequence = payload.sequence;
  if (typeof sequence !== "string" || !sequence.length || /[^HT]/.test(sequence) || sequence.length > MAX_SEQUENCE) {
    throw new SubmissionError("Use a circuit of 1 to 512 H/T gates.");
  }
  let state = ZERO_STATE;
  for (const gate of sequence) state = applyGate(state, gate);
  if (traceDistance(state, level.target) > level.epsilon + 1e-12) {
    throw new SubmissionError("That circuit does not reach this level's hole.");
  }
  if (sequence.length < level.optimalMoves) {
    throw new SubmissionError("That score is below the verified minimum.");
  }
  return { campaign: CAMPAIGN, level: level.id, name, sequence, moves: sequence.length };
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
    if (size > 2048) {
      await reader.cancel();
      throw new SubmissionError("Submission is too large.", 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try { return JSON.parse(body); }
  catch { throw new SubmissionError("Expected a JSON submission."); }
}
