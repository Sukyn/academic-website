import test from 'node:test';
import assert from 'node:assert/strict';
import { getBoard, validateSubmission, MAX_SUBMISSION_BYTES, CAMPAIGN } from '../../src/lib/graph-states/leaderboard.js';
import { MAX_MOVES, optimalShots, sequenceCost, solutionForGraph } from '../../src/lib/graph-states/engine.js';
import { DAILY_START, DAILY_VERSION, LEVELS, dailyPuzzle } from '../../src/lib/graph-states/puzzles.js';
import { SubmissionError } from '../../src/lib/games/submission.js';
import { dailyBounds } from '../../src/lib/games/daily-calendar.js';
import { getGame } from '../../src/lib/games/server.js';

const now = Date.parse(`${DAILY_START}T12:00:00Z`);
const valid = changes => ({ level: 1, name: 'Ada', sequence: solutionForGraph(LEVELS[0]), ...changes });

test('scores count validated local complementations and ignore forged move counts', () => {
  for (let level = 1; level <= LEVELS.length; level++) {
    const sequence = solutionForGraph(LEVELS[level - 1]);
    assert.deepEqual(validateSubmission(valid({ level, name: '  Zoë   Noether  ', sequence, moves: -100, rank: 0 }), now),
      { campaign: CAMPAIGN, level, name: 'Zoë Noether', moves: sequenceCost(sequence) });
  }
  const sequence = solutionForGraph(dailyPuzzle(DAILY_START));
  const daily = validateSubmission({ date: DAILY_START, name: 'Ada', sequence }, now);
  assert.deepEqual(daily, { campaign: DAILY_VERSION, level: 20261016, name: 'Ada', moves: sequenceCost(sequence),
    date: DAILY_START, ...dailyBounds(DAILY_START) });
  const pivotLevel = solutionForGraph(LEVELS[1]);
  assert.deepEqual(pivotLevel, [{ edge: [0, 1] }]);
  assert.equal(validateSubmission(valid({ level: 2, sequence: pivotLevel }), now).moves, 3,
    'A pivot and the equivalent three local complementations have the same shot cost');
  assert.equal(validateSubmission(valid({ level: 2,
    sequence: [{ vertex: 0 }, { vertex: 1 }, { vertex: 0 }] }), now).moves, 3);
  const game = getGame('graph-states');
  assert.equal(Object.hasOwn(game, 'completionOnly'), false);
  const dailyGraph = dailyPuzzle(DAILY_START), { vertices, edges } = dailyGraph;
  assert.deepEqual(game.dailyPuzzle(DAILY_START), { vertices, edges, optimalMoves: optimalShots(dailyGraph) });
});

test('malformed graph submissions, forged wins and oversized replays fail before storage', () => {
  for (const input of [null, [], true, {}, valid({ name: null }), valid({ name: 'x'.repeat(25) }), valid({ name: 'Ada\u202e' }),
    valid({ sequence: [] }), valid({ sequence: null }), valid({ sequence: [{}] }), valid({ sequence: [{ vertex: 0 }] }),
    valid({ sequence: [{ edge: [0, 3] }] }), valid({ sequence: Array(MAX_MOVES + 1).fill({ vertex: 0 }) })]) {
    assert.throws(() => validateSubmission(input, now), SubmissionError);
  }
  assert.throws(() => validateSubmission(valid({ ignored: '🦊'.repeat(MAX_SUBMISSION_BYTES / 4) }), now),
    error => error instanceof SubmissionError && error.status === 413);
  for (const selector of [null, [], {}, { level: 0 }, { level: 1.5 }, { level: 11 }, { level: {} },
    { date: DAILY_START, level: 1 }, { date: '2026-10-17' }, { date: '2026-02-30' }, { date: 20261016 }]) {
    assert.throws(() => getBoard(selector, now), SubmissionError);
  }
});

test('valid editing detours remain acceptable up to the replay work limit', () => {
  const move = { vertex: 0 }, solution = solutionForGraph(LEVELS[0]);
  const pairs = Array.from({ length: Math.floor((MAX_MOVES - solution.length) / 2) * 2 }, () => move);
  const sequence = [...pairs, ...solution];
  assert.equal(validateSubmission(valid({ sequence }), now).moves, sequenceCost(sequence));
});

test('daily scores close at Paris midnight while archived graphs remain readable', () => {
  const { opensAt, closesAt } = dailyBounds(DAILY_START);
  const sequence = solutionForGraph(dailyPuzzle(DAILY_START));
  const payload = { date: DAILY_START, name: 'Ada', sequence };
  assert.equal(validateSubmission(payload, opensAt).moves, sequenceCost(sequence));
  assert.equal(validateSubmission(payload, closesAt - 1).moves, sequenceCost(sequence));
  assert.throws(() => validateSubmission(payload, closesAt), error => error instanceof SubmissionError && error.status === 409);
  assert.equal(getBoard(payload, closesAt).date, DAILY_START);
  assert.deepEqual(getBoard(payload, closesAt).puzzle, dailyPuzzle(DAILY_START));
});
