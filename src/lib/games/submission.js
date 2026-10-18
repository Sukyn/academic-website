export const MAX_SUBMISSION_BYTES = 4_500_000;

export class SubmissionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** JSON may parse successfully yet be too deeply nested to serialize again. */
export function checkSubmissionSize(input, maxBytes, invalidMessage) {
  let source;
  try { source = JSON.stringify(input); }
  catch { throw new SubmissionError(invalidMessage); }
  if (typeof source !== "string") throw new SubmissionError(invalidMessage);
  if (source.length > maxBytes || new TextEncoder().encode(source).byteLength > maxBytes) {
    throw new SubmissionError("Submission is too large.", 413);
  }
}

export function scoreName(value) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
  // At most two UTF-16 units per code point: bound the array allocation even
  // when a malicious request fills its entire body budget with a nickname.
  if (!name || name.length > 48 || Array.from(name).length > 24 || /\p{C}/u.test(name)) {
    throw new SubmissionError("Use a name of 1 to 24 characters.");
  }
  return name;
}

export async function readSubmission(request, maxBytes = MAX_SUBMISSION_BYTES, onBytes = (_bytes) => {}) {
  const reader = request.body?.getReader();
  if (!reader) throw new SubmissionError("Expected a JSON submission.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let size = 0, body = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new SubmissionError("Submission is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    onBytes(size);
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    throw new SubmissionError(signal.aborted ? "Submission timed out or cancelled. Try again." : "Expected valid UTF-8 JSON.",
      signal.aborted ? 408 : 400);
  } finally {
    signal.removeEventListener("abort", cancel);
    // A broken upstream cancellation hook must not delay an error response or
    // replace its status. Cancelling closes pending reads before its hook settles.
    cancel();
    reader.releaseLock();
  }
}
