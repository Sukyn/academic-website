import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSubmissionSize, SubmissionError } from '../../src/lib/games/submission.js';
import { getGame } from '../../src/lib/games/server.js';

const rejected = (action, status, message) => assert.throws(action, error =>
  error instanceof SubmissionError && error.status === status && error.message === message);

test('submission size counts UTF-8 bytes and preserves the exact limit', () => {
  const payload = { name: 'Ada 🦊' }, bytes = Buffer.byteLength(JSON.stringify(payload));
  assert.doesNotThrow(() => checkSubmissionSize(payload, bytes, 'Invalid submission.'));
  rejected(() => checkSubmissionSize(payload, bytes - 1, 'Invalid submission.'), 413, 'Submission is too large.');
  const cyclic = {}; cyclic.self = cyclic;
  for (const input of [cyclic, undefined, { invalid: 1n }]) {
    rejected(() => checkSubmissionSize(input, bytes, 'Invalid submission.'), 400, 'Invalid submission.');
  }
});

test('each replay validator treats deeply nested JSON as invalid and oversized JSON as too large', () => {
  for (const game of ['graph-states', 'quantum-signals', 'circuit-reduction', 'zx-calculus',
    'circuit-reduction-prop', 'circuit-reduction-controlled', 'quantum-signals-prop', 'quantum-signals-controlled']) {
    const descriptor = getGame(game), depth = Math.min(12_000, Math.floor((descriptor.maxBytes - 100) / 2));
    const raw = '{"level":1,"name":"Ada","sequence":[' + '['.repeat(depth) + 'null' + ']'.repeat(depth) + ']}';
    assert.ok(Buffer.byteLength(raw) < descriptor.maxBytes);
    assert.throws(() => descriptor.validateSubmission(JSON.parse(raw)), error =>
      error instanceof SubmissionError && error.status === 400, game);
    rejected(() => descriptor.validateSubmission({ level: 1, name: 'Ada', sequence: [], padding: 'x'.repeat(descriptor.maxBytes) }),
      413, 'Submission is too large.');
  }
});
