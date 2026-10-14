import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJson, ScoreError } from '../../src/lib/games/http.js';
import { readSubmission, scoreName, SubmissionError } from '../../src/lib/games/submission.js';

test('score names preserve Unicode boundaries and normalize whitespace in large inputs', () => {
  assert.equal(scoreName('😀'.repeat(24)), '😀'.repeat(24));
  assert.equal(scoreName(' '.repeat(100_000) + 'Ada' + ' '.repeat(100_000)), 'Ada');
  for (const name of ['x'.repeat(100_000), '😀'.repeat(100_000), '😀'.repeat(24) + 'x']) {
    assert.throws(() => scoreName(name), SubmissionError);
  }
});

function mockTimers(context) {
  const timers = new Map();
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const timer = { callback, delay };
    timers.set(timer, timer);
    return timer;
  });
  context.mock.method(globalThis, 'clearTimeout', timer => timers.delete(timer));
  return timers;
}

test('JSON transport forwards request options and releases its deadline after success', async context => {
  const timers = mockTimers(context), request = new AbortController();
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' };
  const data = { entries: [], total: 0, currentPlayer: null };
  context.mock.method(globalThis, 'fetch', async (url, received) => {
    assert.equal(url, '/api/leaderboard');
    assert.deepEqual(received, { ...options, signal: request.signal });
    assert.equal([...timers.values()][0].delay, 15_000);
    return Response.json(data);
  });
  assert.deepEqual(await fetchJson('/api/leaderboard', request, options), data);
  assert.equal(timers.size, 0);
  assert.equal(request.signal.aborted, false);
});

test('only bounded validation messages can become public score errors', async context => {
  const timers = mockTimers(context);
  let response;
  context.mock.method(globalThis, 'fetch', async () => response);
  for (const status of [400, 408, 409, 413, 415, 429]) {
    for (const error of ['Use a valid replay.', 'x'.repeat(160)]) {
      response = Response.json({ error }, { status });
      await assert.rejects(fetchJson('/api/leaderboard', new AbortController()),
        result => result instanceof ScoreError && result.status === status && result.message === error);
    }
  }
  for (const status of [400, 401, 403, 404, 500, 502, 503]) {
    for (const error of [null, {}, '', 'private '.repeat(24)]) {
      response = Response.json({ error }, { status });
      await assert.rejects(fetchJson('/api/leaderboard', new AbortController()),
        result => !(result instanceof ScoreError) && result.message === 'Scores unavailable');
    }
  }
  assert.equal(timers.size, 0);
});

test('network, invalid JSON and timed-out response bodies release the transport deadline', async context => {
  const timers = mockTimers(context);
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(fetchJson('/api/leaderboard', new AbortController()), TypeError);
  assert.equal(timers.size, 0);
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Gateway unavailable</html>', { status: 502 }));
  await assert.rejects(fetchJson('/api/leaderboard', new AbortController()), SyntaxError);
  assert.equal(timers.size, 0);
  const request = new AbortController();
  let cancelled = false;
  context.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    signal.addEventListener('abort', () => body.cancel());
    return { ok: true, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) };
  });
  const pending = fetchJson('/api/leaderboard', request);
  await Promise.resolve();
  [...timers.values()][0].callback();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(cancelled, true, 'The same abort signal covers fetching and reading the response');
  assert.equal(timers.size, 0);
});

for (const cancellation of ['rejects', 'never settles']) {
  test(`submission errors survive an upstream cancellation hook that ${cancellation}`, { timeout: 1_000 }, async () => {
    for (const [bytes, limit, status] of [[Uint8Array.of(1, 2), 1, 413], [Uint8Array.of(0xff), 10, 400]]) {
      let cancelled = false;
      const request = new Request('https://example.test/api/leaderboard', {
        method: 'POST', duplex: 'half', body: new ReadableStream({
          start(controller) { controller.enqueue(bytes); },
          cancel() {
            cancelled = true;
            return cancellation === 'rejects' ? Promise.reject(new Error('upstream failure')) : new Promise(() => {});
          },
        }),
      });
      await assert.rejects(readSubmission(request, limit),
        error => error instanceof SubmissionError && error.status === status);
      assert.equal(cancelled, true);
      assert.equal(request.body.locked, false);
    }
  });
}

test('an aborted submission releases its reader without waiting for upstream cancellation', { timeout: 1_000 }, async () => {
  const controller = new AbortController();
  const request = new Request('https://example.test/api/leaderboard', {
    method: 'POST', signal: controller.signal, duplex: 'half',
    body: new ReadableStream({ cancel() { return new Promise(() => {}); } }),
  });
  const pending = readSubmission(request);
  controller.abort();
  await assert.rejects(pending, error => error instanceof SubmissionError && error.status === 408);
  assert.equal(request.body.locked, false);
});
