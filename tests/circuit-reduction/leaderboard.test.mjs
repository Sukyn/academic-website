import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN, MAX_REPLAY_MOVES, MAX_SUBMISSION_BYTES, SubmissionError,
  getBoard, getLevel, validateSubmission,
} from '../../src/lib/circuit-reduction/leaderboard.js';
import { LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { DAILY_START, DAILY_VERSION } from '../../src/lib/circuit-reduction/puzzles.js';
import { dailyBounds } from '../../src/lib/games/daily-calendar.js';
import { readSubmission } from '../../src/lib/games/submission.js';
import { applyMove, sequenceCost } from '../../src/lib/circuit-reduction/engine.js';

const first = LEVELS[0];
const valid = (changes = {}) => ({ level: first.id, name: 'Ada', sequence: first.solution, ...changes });

test('server validator replays every campaign circuit and derives its move count', () => {
  for (const level of LEVELS) {
    const before = structuredClone(level);
    const result = validateSubmission({ level: level.id, name: '  Zoë   Noether ', sequence: level.solution,
      moves: 0, circuit: [['.', '.']], optimalMoves: 0 });
    assert.equal(result.campaign, CAMPAIGN);
    assert.equal(result.level, level.id);
    assert.equal(result.name, 'Zoë Noether');
    assert.equal(result.moves, sequenceCost(level.solution));
    assert.deepEqual(level, before, 'Score verification never mutates campaign puzzles');
    assert.deepEqual(Object.keys(result).sort(), ['campaign', 'level', 'moves', 'name']);
  }
  const { solution, ...firstBoard } = first;
  assert.deepEqual(getLevel(String(first.id)), firstBoard);
});

test('server derives charged rewrites while replaying unlimited free identity layout', () => {
  const expand = { rule: 'insert-space', row: 0, column: 1, count: 100 };
  const compact = { rule: 'compact-identities', row: 0, column: 0 };
  const sequence = [expand, compact, { rule: 'cancel-x', row: 0, column: 0 }, expand, compact];
  const result = validateSubmission(valid({ sequence }));
  assert.equal(result.moves, 1, 'Spacing before and after the solution cannot inflate its score');
  const lockedReplay = [
    { rule: 'insert-column', row: 0, column: 0 }, { rule: 'insert-column', row: 0, column: 0 },
    { rule: 'cancel-h', row: 0, column: 0 }, { rule: 'cancel-h', row: 0, column: 0 },
    compact, { rule: 'cancel-x', row: 0, column: 0 },
  ];
  assert.deepEqual(lockedReplay.reduce(applyMove, structuredClone(first.circuit)), [['.', '.']], 'The locked-rule replay is otherwise a legal identity reduction');
  assert.throws(() => validateSubmission(valid({ sequence: lockedReplay })), SubmissionError,
    'A reversible but locked rule cannot be used to pad a lesson score');
  assert.throws(() => validateSubmission(valid({ sequence: [
    { rule: 'insert-space', row: 0, column: 0, count: 2 ** 32 }, ...first.solution,
  ] })), SubmissionError, 'A replay budget is checked before attempting hostile allocation');
  assert.deepEqual(sequence.reduce(applyMove, structuredClone(first.circuit)), [['.', '.']]);
});

test('replays must use legal rule windows on the server puzzle', () => {
  for (const sequence of [null, [], 'cancel-x', first.solution[0], [null], [[]], [1],
    [{ rule: 'cancel-x', row: 0, column: 0 }],
    [{ rule: 'cancel-x', row: 0, column: '1' }],
    [{ rule: 'cancel-x', row: -1, column: 1 }],
    [{ rule: 'cancel-x', row: 0.5, column: 1 }],
    [{ rule: 'erase', row: 0, column: 1 }],
    [{ rule: 'slide-x', row: 0, column: 0 }],
  ]) assert.throws(() => validateSubmission(valid({ sequence, circuit: [['.', '.']], moves: 1 })), SubmissionError);
  assert.throws(() => validateSubmission(valid({ sequence: Array(MAX_REPLAY_MOVES + 1).fill(first.solution[0]) })), SubmissionError);
  for (const input of [null, [], true, 1, {}, valid({ level: 0 }), valid({ level: 99 }),
    valid({ name: '\u202eAda' }), valid({ name: 'x'.repeat(25) }), valid({ name: null })]) {
    assert.throws(() => validateSubmission(input), SubmissionError);
  }
});

test('circuit request budgets apply to streaming and body-selected games', async () => {
  assert.throws(() => validateSubmission(valid({ ignored: 'x'.repeat(MAX_SUBMISSION_BYTES) })),
    error => error instanceof SubmissionError && error.status === 413);
  let cancelled = false;
  const request = new Request('https://example.test/api/leaderboard?game=circuit-reduction', {
    method: 'POST', duplex: 'half', headers: { 'Content-Length': '1' },
    body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_SUBMISSION_BYTES + 1)); },
      cancel() { cancelled = true; },
    }),
  });
  await assert.rejects(() => readSubmission(request, MAX_SUBMISSION_BYTES),
    error => error instanceof SubmissionError && error.status === 413);
  assert.equal(cancelled, true);
  assert.equal(request.body.locked, false);
});

test('daily scores verify the selected date and respect shared Paris deadlines', () => {
  const date = DAILY_START, { opensAt, closesAt } = dailyBounds(date);
  const puzzle = dailyPuzzle(date);
  const payload = { date, name: 'Daily Ada', sequence: puzzle.solution, circuit: [['.', '.']], moves: 0 };
  const score = validateSubmission(payload, opensAt);
  assert.equal(score.campaign, DAILY_VERSION);
  assert.equal(score.level, 20261014);
  assert.equal(score.moves, puzzle.optimalMoves);
  assert.ok(score.moves >= 10 && score.moves <= 14);
  assert.equal(score.opensAt, opensAt);
  assert.equal(score.closesAt, closesAt);
  assert.equal(validateSubmission(payload, closesAt - 1).moves, score.moves);
  assert.throws(() => validateSubmission(payload, closesAt),
    error => error instanceof SubmissionError && error.status === 409);
  assert.equal(getBoard({ date }, closesAt).campaign, DAILY_VERSION, 'Archives remain readable');
  for (const selector of [{ date, level: 1 }, { date: '2026-10-13' }, { date: '2026-10-15' },
    { date: '2026-02-30' }, { date: 20261014 }, { date: '' }]) {
    assert.throws(() => getBoard(selector, opensAt), SubmissionError);
  }
});
