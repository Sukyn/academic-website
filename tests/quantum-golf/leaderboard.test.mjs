import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';
const {
  CAMPAIGN, MAX_SUBMISSION_BYTES, SubmissionError, getLevel, validateSubmission, readSubmission,
} = await import(websiteFile('src/lib/quantum-golf/leaderboard.ts'));
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { START_STATE, applyGate, traceDistance } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { DAILY_VERSION, dailyPuzzle } = await import(websiteFile('src/lib/quantum-golf/daily.js'));

const valid = (changes = {}) => ({ level: 1, name: 'Ada', sequence: 'T', ...changes });
const rejectsSubmission = (payload) => assert.throws(() => validateSubmission(payload), SubmissionError);

test('shared score validator replays each fixed campaign hole and derives the score from gates', () => {
  for (const level of LEVELS) {
    const result = solveShortest(level.target, level.epsilon, { maxDepth: level.optimalMoves, maxNodes: 2_000_000 });
    assert.equal(result.status, 'optimal');
    const score = validateSubmission({ level: level.id, name: 'Ada', sequence: result.sequence, moves: 0, epsilon: 1, target: [0, 0, 1] });
    assert.equal(score.campaign, CAMPAIGN);
    assert.equal(score.level, level.id);
    assert.equal(score.moves, level.optimalMoves);
    assert.equal('sequence' in score, false, 'The validated score discards the circuit');
    assert.equal(score.name, 'Ada');
    rejectsSubmission({ level: level.id, name: 'Ada', sequence: 'HH', epsilon: 1, target: [0, 0, 1], moves: level.optimalMoves });
  }
  const lessEfficient = validateSubmission(valid({ level: 2, sequence: 'HT', moves: 1 }));
  assert.equal(lessEfficient.moves, 2, 'A stationary T is still a counted stroke');
  assert.equal(getLevel('2').id, 2);
});

test('name validation counts Unicode code points and rejects invisible control characters', () => {
  assert.equal(validateSubmission(valid({ name: '  Zoë   Noether  ' })).name, 'Zoë Noether');
  assert.equal(validateSubmission(valid({ name: '🦊'.repeat(24) })).name, '🦊'.repeat(24));
  assert.equal(validateSubmission(valid({ name: '<b>Ada</b>' })).name, '<b>Ada</b>', 'Names are plain text for the client to render safely');
  for (const name of ['', '   ', '🦊'.repeat(25), 'a'.repeat(25), 'Ada\u0000', 'Ada\u202e', 'Ada\u200b', '\ud800', null, 12]) {
    rejectsSubmission(valid({ name }));
  }
});

test('small server replay agrees with the game for long winning and random circuits', () => {
  const length = 1358;
  let seed = 42;
  for (const level of LEVELS) {
    const { sequence } = solveShortest(level.target, level.epsilon, { maxDepth: level.optimalMoves, maxNodes: 2_000_000 });
    const padded = sequence + 'HTTTTTTTTH'.repeat(Math.floor((length - sequence.length) / 10));
    assert.equal(validateSubmission(valid({ level: level.id, sequence: padded })).moves, padded.length);
    for (let sample = 0; sample < 8; sample++) {
      const circuit = Array.from({ length }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed & 0x80000000 ? 'H' : 'T';
      }).join('');
      const state = [...circuit].reduce(applyGate, START_STATE);
      const payload = valid({ level: level.id, sequence: circuit });
      if (traceDistance(state, level.target) <= level.epsilon + 1e-12) {
        assert.equal(validateSubmission(payload).moves, length);
      } else rejectsSubmission(payload);
    }
  }
});

test('score validation rejects malformed or nonwinning circuits without a gate-count cap', () => {
  for (const payload of [null, [], 'H', 3, {}, valid({ level: 0 }), valid({ level: LEVELS.length + 1 }), valid({ level: 1.5 }), valid({ level: NaN })]) {
    rejectsSubmission(payload);
  }
  for (const sequence of ['', 'X', 'h', 'H T', 'H\n', 'HH', 'H', null, ['H']]) {
    rejectsSubmission(valid({ sequence }));
  }
  rejectsSubmission({ level: 11, name: 'Colin', moves: 1358 });
  const level = LEVELS.find(level => level.id === 11);
  const { sequence } = solveShortest(level.target, level.epsilon, { maxDepth: level.optimalMoves, maxNodes: 2_000_000 });
  const padded = sequence + 'H'.repeat(1358 - sequence.length);
  assert.equal(padded.length, 1358);
  assert.equal(validateSubmission(valid({ level: 11, name: 'Colin', sequence: padded })).moves, 1358);
  assert.equal(validateSubmission(valid({ level: 2, sequence: 'H' + 'T'.repeat(10_000) })).moves, 10_001);
});

test('streamed JSON score requests enforce a byte limit and preserve split UTF-8 names', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(valid({ name: 'Zoë 🦊' })));
  const stream = new ReadableStream({
    start(controller) {
      // One byte at a time deliberately splits multi-byte Unicode characters.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const request = new Request('https://example.test/api/scores', { method: 'POST', body: stream, duplex: 'half' });
  assert.deepEqual(await readSubmission(request), valid({ name: 'Zoë 🦊' }));
  assert.equal(validateSubmission(await readSubmission(new Request('https://example.test', { method: 'POST', body: JSON.stringify(valid()) }))).moves, 1);

  await assert.rejects(() => readSubmission(new Request('https://example.test', { method: 'POST', body: '{bad' })), (error) => error instanceof SubmissionError && error.status === 400);
  await assert.rejects(() => readSubmission(new Request('https://example.test', { method: 'POST' })), (error) => error instanceof SubmissionError && error.status === 400);
  // Character count is below the byte cap; UTF-8 byte count exceeds it.
  await assert.rejects(() => readSubmission(new Request('https://example.test', {
    method: 'POST', body: '🦊'.repeat(Math.floor(MAX_SUBMISSION_BYTES / 4) + 1),
  })), (error) => error instanceof SubmissionError && error.status === 413);

  const chunks = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_SUBMISSION_BYTES));
    controller.enqueue(Uint8Array.of(0));
    controller.close();
  } });
  await assert.rejects(() => readSubmission(new Request('https://example.test', { method: 'POST', body: chunks, duplex: 'half' })), (error) => error instanceof SubmissionError && error.status === 413);
  const long = valid({ level: 2, sequence: 'H' + 'T'.repeat(10_000) });
  assert.deepEqual(await readSubmission(new Request('https://example.test', {
    method: 'POST', body: JSON.stringify(long),
  })), long, 'Circuits exceeding the old 2KB request limit are read intact');
});

test('server campaign metadata agrees with playable holes and contains no solutions', async () => {
  const { version, levels } = JSON.parse(await readFile(websiteFile('src/lib/quantum-golf/campaign.json'), 'utf8'));
  const source = JSON.parse(await readFile(websiteFile('tools/quantum-golf/campaign.json'), 'utf8'));
  assert.equal(version, source.version);
  assert.equal(CAMPAIGN, source.version);
  assert.deepEqual(levels.map(({ id, target, epsilon, optimalMoves }) => ({ id, target, epsilon, optimalMoves })), LEVELS.map(({ id, target, epsilon, optimalMoves }) => ({ id, target, epsilon, optimalMoves })));
  for (const level of levels) {
    assert.equal('sequence' in level, false);
    assert.equal('witness' in level, false);
  }
});

test('daily submissions replay the server puzzle and cannot choose their own target or scoring day', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const date = '2026-10-14';
  const puzzle = dailyPuzzle(date);
  const { status, sequence } = solveShortest(puzzle.target, puzzle.epsilon, { maxDepth: 12 });
  assert.equal(status, 'optimal');
  const payload = { date, name: 'Daily Ada', sequence, target: [1, 0, 0], epsilon: 1, moves: 0 };
  const score = validateSubmission(payload, now);
  assert.equal(score.campaign, DAILY_VERSION);
  assert.equal(score.level, 20261014);
  assert.equal(score.moves, puzzle.optimalMoves);
  assert.equal(score.date, date);
  assert.equal(score.opensAt, Date.parse('2026-10-13T22:00:00Z'));
  assert.equal(score.closesAt, Date.parse('2026-10-14T22:00:00Z'));
  for (const changes of [
    { date: '' }, { date: '2026-02-30' }, { date: '2026-10-12' },
    { date: '2026-10-15' }, { date: '2026-10-14T00:00:00Z' },
    { date: null }, { date: 20261014 }, { level: 1 }, { sequence: 'H' },
  ]) assert.throws(() => validateSubmission({ ...payload, ...changes }, now), SubmissionError);
  assert.throws(() => validateSubmission(payload, score.closesAt),
    error => error instanceof SubmissionError && error.status === 409);
  assert.equal(validateSubmission(payload, score.closesAt - 1).moves, puzzle.optimalMoves);
});
