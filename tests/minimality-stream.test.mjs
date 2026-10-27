import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeSearchStream, summarizeWitness } from '../src/lib/minimality/stream.js';

const encoder = new TextEncoder();
const report = { witnesses: { drop: { certified: true } }, unresolved: [] };
const complete = { type: 'complete', report };
const line = event => `${JSON.stringify(event)}\n`;

function responseFrom(chunks, { close = true, onCancel, ...options } = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      if (close) controller.close();
    },
    cancel: onCancel,
  }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }, ...options });
}

test('parses event and UTF-8 boundaries, CRLF, blank lines, and a final unterminated event', async () => {
  const events = [{ type: 'source', commit: 'abc' }, { type: 'status', message: 'Clément → search' },
    { type: 'witness', witness: { equation: 'drop' } }, complete];
  const bytes = encoder.encode(`\r\n${events.map(event => JSON.stringify(event)).join('\r\n')}`);
  const seen = [];
  const result = await consumeSearchStream(responseFrom([...bytes].map(byte => new Uint8Array([byte]))),
    { onEvent: event => seen.push(event) });
  assert.deepEqual(result, report);
  assert.deepEqual(seen, events);
});

test('returns immediately on completion and cancels the remaining response', async () => {
  let cancellations = 0;
  const response = responseFrom([line(complete)], { close: false, onCancel: () => { cancellations++; } });
  assert.deepEqual(await consumeSearchStream(response), report);
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});

test('bounds individual lines, while allowing a chunk containing many bounded lines', async () => {
  const status = line({ type: 'status', message: 'x'.repeat(150_000) });
  assert.deepEqual(await consumeSearchStream(responseFrom([status + status + line(complete)])), report);
  await assert.rejects(consumeSearchStream(responseFrom(['x'.repeat(256 * 1024 + 1)])), /exceeded.*size/);
});

test('accepts the alternative NDJSON MIME type', async () => {
  const response = responseFrom([line(complete)], { headers: { 'content-type': 'Application/NDJSON' } });
  assert.deepEqual(await consumeSearchStream(response), report);
});

test('rejects wrong MIME and missing response bodies', async () => {
  await assert.rejects(consumeSearchStream(new Response('{}', { headers: { 'content-type': 'application/json' } })), /did not return.*stream/);
  await assert.rejects(consumeSearchStream(new Response(null, { headers: { 'content-type': 'application/x-ndjson' } })), /no event stream/);
});

test('uses HTTP error details from JSON and NDJSON, and a readable fallback', async () => {
  await assert.rejects(consumeSearchStream(new Response(JSON.stringify({ error: { message: 'Invalid theory.' } }),
    { status: 422, headers: { 'content-type': 'application/json' } })), /Invalid theory\./);
  let cancellations = 0;
  await assert.rejects(consumeSearchStream(responseFrom([line({ type: 'error', message: 'Source unavailable.' })],
    { status: 503, close: false, onCancel: () => { cancellations++; } })), /Source unavailable\./);
  assert.equal(cancellations, 1);
  await assert.rejects(consumeSearchStream(new Response('bad gateway', { status: 502 })), /HTTP 502/);
  await assert.rejects(consumeSearchStream(new Response(null, { status: 503 })), /HTTP 503/);
});

test('reads pretty-printed HTTP JSON errors across chunks and bounds error bodies', async () => {
  const source = JSON.stringify({ error: { message: 'Clément’s source is unavailable.' } }, null, 2);
  const bytes = encoder.encode(source);
  await assert.rejects(consumeSearchStream(responseFrom([...bytes].map(byte => new Uint8Array([byte])),
    { status: 503, headers: { 'content-type': 'application/json' } })), /Clément’s source is unavailable/);
  let cancellations = 0;
  await assert.rejects(consumeSearchStream(responseFrom(['x'.repeat(256 * 1024 + 1)],
    { status: 502, close: false, onCancel: () => { cancellations++; } })), /HTTP 502/);
  assert.equal(cancellations, 1);
});

test('forwards streamed errors before throwing and cleans up', async () => {
  const error = { type: 'error', message: 'Search worker failed.' };
  const seen = [];
  let cancellations = 0;
  const response = responseFrom([line(error)], { close: false, onCancel: () => { cancellations++; } });
  await assert.rejects(consumeSearchStream(response, { onEvent: event => seen.push(event) }), /Search worker failed\./);
  assert.deepEqual(seen, [error]);
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});

test('rejects malformed, unknown, incomplete, and invalid UTF-8 events', async () => {
  for (const [text, expected] of [
    ['{broken}\n', /invalid search event/],
    [line({ type: 'surprise' }), /unknown search event/],
    ['[]\n', /unknown search event/],
    [line({ type: 'complete' }), /without a report/],
    [line({ type: 'status', message: 'working' }), /ended before.*completed/],
    ['', /ended before.*completed/],
  ]) await assert.rejects(consumeSearchStream(responseFrom([text])), expected);
  await assert.rejects(consumeSearchStream(responseFrom([new Uint8Array([0xff])])), /invalid UTF-8/);
});

test('aborting a pending read cancels the reader and releases its lock', async () => {
  const controller = new AbortController();
  let cancellations = 0;
  const response = responseFrom([], { close: false, onCancel: () => { cancellations++; } });
  const reading = consumeSearchStream(response, { signal: controller.signal });
  controller.abort(new DOMException('Stopped.', 'AbortError'));
  await assert.rejects(reading, { name: 'AbortError' });
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});

test('an already aborted search releases the response without forwarding events', async () => {
  const controller = new AbortController();
  controller.abort();
  const seen = [];
  await assert.rejects(consumeSearchStream(responseFrom([line(complete)]),
    { signal: controller.signal, onEvent: event => seen.push(event) }), { name: 'AbortError' });
  assert.deepEqual(seen, []);
});

test('a failing event handler cancels the stream', async () => {
  let cancellations = 0;
  const response = responseFrom([line({ type: 'status' })], { close: false, onCancel: () => { cancellations++; } });
  await assert.rejects(consumeSearchStream(response, { onEvent: () => { throw new Error('Rendering failed.'); } }), /Rendering failed/);
  assert.equal(cancellations, 1);
});

test('witness summaries describe common exact strategies without raw JSON', () => {
  assert.equal(summarizeWitness({ strategy: 'presence' }).label, 'Presence invariant');
  assert.equal(summarizeWitness({ strategy: 'presence', parameters: { generators: ['H', 'X'] } }).detail,
    'Presence of H, X differs between the two sides.');
  assert.equal(summarizeWitness({ strategy: 'presence', parameters: { generators: ['omega', '\\theta'] } }).detail,
    'Presence of ω, θ differs between the two sides.');
  assert.equal(summarizeWitness({ strategy: 'counting', parameters: { modulus: 3, weights: { omega: 2, Gamma: 1 } }, lhs_value: 2, rhs_value: 0 }).detail,
    '2·#ω + #Γ modulo 3: 2 ≠ 0.');
  assert.deepEqual(summarizeWitness({ strategy: 'counting', parameters: { modulus: 3, weights: { H: 2, X: 1 } }, lhs_value: 2, rhs_value: 0 }),
    { label: 'Counting modulo 3', detail: '2·#H + #X modulo 3: 2 ≠ 0.' });
  assert.deepEqual(summarizeWitness({ strategy: 'counting', parameters: { modulus: 2, weights: {}, swap: 1 }, lhs_value: 1, rhs_value: 0 }),
    { label: 'Swap parity', detail: '#Swap modulo 2: 1 ≠ 0.' });
  assert.deepEqual(summarizeWitness({ strategy: 'counting', parameters: { modulus: 3, weights: { H: 2 }, swap: 2 }, lhs_value: 1, rhs_value: 0 }),
    { label: 'Counting modulo 3', detail: '2·#H + 2·#Swap modulo 3: 1 ≠ 0.' });
  assert.equal(summarizeWitness({ strategy: 'finite_model', parameters: { degree: 4 } }).detail,
    'A finite permutation model distinguishes the two sides (degree 4).');
});
