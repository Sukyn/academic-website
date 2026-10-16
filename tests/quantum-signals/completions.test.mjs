import test from 'node:test';
import assert from 'node:assert/strict';
import { getBoard, validateSubmission, MAX_REPLAY_MOVES, MAX_SUBMISSION_BYTES } from '../../src/lib/quantum-signals/completions.js';
import { SubmissionError } from '../../src/lib/games/submission.js';
import { DAILY_START, DAILY_VERSION, dailyPuzzle } from '../../src/lib/quantum-signals/puzzles.js';
import { solvePuzzle } from '../../src/lib/quantum-signals/engine.js';

const valid = changes => ({ level: 1, name: 'Ada', sequence: [{ hole: 'a', gate: 'X' }], ...changes });

test('daily completions use the current puzzle version and accept omitted identities', () => {
  const filling = solvePuzzle(dailyPuzzle(DAILY_START), { limit: 1 })[0];
  const sequence = Object.entries(filling).filter(([, gate]) => gate !== 'I').map(([hole, gate]) => ({ hole, gate }));
  const record = validateSubmission({ date: DAILY_START, name: 'Ada', sequence }, Date.parse(`${DAILY_START}T12:00:00Z`));
  assert.equal(record.campaign, DAILY_VERSION);
  assert.deepEqual(Object.keys(record).sort(), ['campaign', 'level', 'name']);
});

test('completion replay limits bound work without penalizing valid editing detours', () => {
  const detour = Array(MAX_REPLAY_MOVES - 1).fill({ hole: 'a', gate: 'I' });
  const result = validateSubmission(valid({ sequence: [...detour, { hole: 'a', gate: 'X' }] }));
  assert.deepEqual(Object.keys(result).sort(), ['campaign', 'level', 'name']);
  assert.throws(() => validateSubmission(valid({ sequence: [...detour, ...valid().sequence, ...valid().sequence] })), SubmissionError);
  for (const sequence of [undefined, null, [], 'X', [null], [[]], [{}],
    [{ hole: 'unknown', gate: 'X' }], [{ hole: 'a', gate: {} }],
    [{ hole: 'a', gate: 'X' }, { hole: 'a', gate: null }]]) {
    assert.throws(() => validateSubmission(valid({ sequence })), SubmissionError);
  }
  assert.throws(() => validateSubmission(valid({ ignored: '🦊'.repeat(MAX_SUBMISSION_BYTES / 4) })),
    error => error instanceof SubmissionError && error.status === 413, 'The limit counts UTF-8 bytes');
});

test('completion selectors and nicknames reject malformed or forged identities', () => {
  for (const selector of [{}, { level: 0 }, { level: 1.5 }, { level: 99 }, { level: {} },
    { date: '2026-10-15', level: 1 }, { date: '2026-02-30' }, { date: 20261015 }]) {
    assert.throws(() => getBoard(selector), SubmissionError);
  }
  for (const input of [null, [], true, {}, valid({ name: null }), valid({ name: 'x'.repeat(25) }), valid({ name: 'Ada\u202e' })]) {
    assert.throws(() => validateSubmission(input), SubmissionError);
  }
  const record = validateSubmission(valid({ name: '  Zoë   Noether  ', moves: -100, rank: 0 }));
  assert.equal(record.name, 'Zoë Noether');
  assert.equal(Object.hasOwn(record, 'moves'), false);
  assert.equal(Object.hasOwn(record, 'rank'), false);
});
