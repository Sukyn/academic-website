import { displayName } from './format.js';

const MAX_LINE_LENGTH = 256 * 1024;
const EVENT_TYPES = new Set(['source', 'status', 'witness', 'complete', 'error']);
const STREAM_TYPES = new Set(['application/x-ndjson', 'application/ndjson']);

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The search was stopped.', 'AbortError');
}

async function* readLines(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: response.ok });
  let pending = '';
  let ended = false;
  let cancellation;
  const cancel = reason => {
    cancellation ??= reader.cancel(reason).catch(() => {});
    return cancellation;
  };
  const checkAbort = () => {
    if (signal?.aborted) throw abortReason(signal);
  };
  const onAbort = () => { void cancel(abortReason(signal)); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (!ended) {
      checkAbort();
      const { value, done } = await reader.read();
      checkAbort();
      ended = done;
      let text;
      try { text = done ? decoder.decode() : decoder.decode(value, { stream: true }); }
      catch { throw new Error('The server returned invalid UTF-8 search data.'); }
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const end = newline === -1 ? text.length : newline;
        if (pending.length + end - start > MAX_LINE_LENGTH) throw new RangeError('A search event exceeded the supported size.');
        pending += text.slice(start, end);
        if (newline === -1) break;
        const line = pending;
        pending = '';
        yield line;
        checkAbort();
        start = newline + 1;
      }
    }
    if (pending) yield pending;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!ended) await cancel();
    reader.releaseLock();
  }
}

function errorMessage(value) {
  const message = value?.error?.message ?? value?.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

async function requestError(response, signal) {
  const fallback = `The search request failed (HTTP ${response.status}).`;
  if (!response.body) return fallback;
  let text = '';
  try {
    for await (const line of readLines(response, signal)) {
      text += `${line}\n`;
      if (text.length > MAX_LINE_LENGTH) return fallback;
      try {
        const message = errorMessage(JSON.parse(line));
        if (message) return message;
      } catch { /* Pretty-printed JSON is parsed after the bounded body ends. */ }
    }
  } catch (error) {
    if (error instanceof RangeError) return fallback;
    throw error;
  }
  try { return errorMessage(JSON.parse(text)) ?? fallback; }
  catch { return fallback; }
}

/** Consume one bounded NDJSON event at a time, without retaining the response. */
export async function consumeSearchStream(response, { onEvent, signal } = {}) {
  if (signal?.aborted) {
    await response.body?.cancel().catch(() => {});
    throw abortReason(signal);
  }
  if (!response.ok) throw new Error(await requestError(response, signal));
  const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (!STREAM_TYPES.has(mime)) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The server did not return a search event stream.');
  }
  if (!response.body) throw new Error('The search response has no event stream.');

  for await (const line of readLines(response, signal)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('The server returned an invalid search event.'); }
    if (!event || typeof event !== 'object' || Array.isArray(event) || !EVENT_TYPES.has(event.type)) {
      throw new Error('The server returned an unknown search event.');
    }
    if (event.type === 'complete'
      && (!event.report || typeof event.report !== 'object' || Array.isArray(event.report))) {
      throw new Error('The server returned a completion event without a report.');
    }
    await onEvent?.(event);
    if (signal?.aborted) throw abortReason(signal);
    if (event.type === 'error') throw new Error(errorMessage(event) ?? 'The search could not be completed.');
    if (event.type === 'complete') return event.report;
  }
  throw new Error('The search stream ended before the search completed.');
}

export function summarizeWitness(witness) {
  const parameters = witness.parameters ?? {};
  if (witness.strategy === 'presence') {
    return { label: 'Presence invariant', detail: Array.isArray(parameters.generators)
      ? `Presence of ${parameters.generators.map(displayName).join(', ')} differs between the two sides.`
      : witness.description ?? 'Tracks whether selected generators occur.' };
  }
  if (witness.strategy === 'counting') {
    const terms = Object.entries(parameters.weights ?? {}).map(([name, weight]) => weight === 1 ? `#${displayName(name)}` : `${weight}·#${displayName(name)}`);
    if (parameters.swap) terms.push(parameters.swap === 1 ? '#Swap' : `${parameters.swap}·#Swap`);
    const label = terms.length === 1 && parameters.swap === 1 && parameters.modulus === 2 ? 'Swap parity' : `Counting modulo ${parameters.modulus ?? '?'}`;
    return { label, detail: `${terms.join(' + ') || 'Gate count'} modulo ${parameters.modulus}: ${formatWitnessValue(witness.lhs_value)} ≠ ${formatWitnessValue(witness.rhs_value)}.` };
  }
  if (witness.strategy === 'finite_model') {
    return { label: 'Finite permutation model', detail: `A finite permutation model distinguishes the two sides${parameters.degree ? ` (degree ${parameters.degree})` : ''}.` };
  }
  return { label: (witness.strategy ?? 'Witness').replaceAll('_', ' '), detail: witness.description || 'The two sides have different invariant values.' };
}

export function formatWitnessValue(value) { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
