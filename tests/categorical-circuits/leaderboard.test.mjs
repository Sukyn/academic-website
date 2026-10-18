import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevelLeaderboard, MAX_REPLAY_MOVES } from '../../src/lib/categorical-circuits/leaderboard.js';
import { getLevels } from '../../src/lib/categorical-circuits/puzzles.js';
import { getGame } from '../../src/lib/games/server.js';
import { SubmissionError } from '../../src/lib/games/submission.js';
import { loadApiFixture } from '../../tools/games/api-fixture.mjs';

const key = (kind, profile) => `${kind === 'signals' ? 'quantum-signals' : 'circuit-reduction'}-${profile}`;
const sequenceFor = (puzzle, kind) => kind === 'signals'
  ? puzzle.solution.flatMap((gate, hole) => gate === 'I' ? [] : [{ hole, gate }]) : puzzle.solution;
const invalid = (action, status = 400) => assert.throws(action, error => error instanceof SubmissionError && error.status === status);

test('each advanced level has an isolated board and validates its official solution', () => {
  const campaigns = new Set();
  for (const kind of ['simplification', 'signals']) for (const profile of ['prop', 'controlled']) {
    const game = key(kind, profile), descriptor = getGame(game), levels = getLevels(profile, kind);
    assert.equal('completionOnly' in descriptor, kind === 'signals');
    assert.equal('dailyPuzzle' in descriptor, false);
    for (const puzzle of levels) {
      const original = structuredClone(puzzle), board = descriptor.getBoard({ level: String(puzzle.id) });
      campaigns.add(board.campaign);
      assert.deepEqual(board.puzzle, puzzle);
      const sequence = sequenceFor(puzzle, kind);
      const saved = descriptor.validateSubmission({ game, level: puzzle.id, name: '  Ada   Lovelace ', sequence });
      assert.deepEqual(saved, { campaign: board.campaign, level: puzzle.id, name: 'Ada Lovelace',
        ...(kind === 'signals' ? {} : { moves: sequence.filter(move => !['tidy', 'insert-column', 'remove-column'].includes(move.rule)).length }) });
      assert.deepEqual(board.puzzle, original, 'Replaying a submission never mutates the official level');
      invalid(() => descriptor.validateSubmission({ game, level: puzzle.id, name: 'Ada', sequence: [] }));
    }
  }
  assert.equal(campaigns.size, 4);
});

test('advanced boards accept campaign levels only and reject custom payloads', () => {
  for (const kind of ['simplification', 'signals']) for (const profile of ['prop', 'controlled']) {
    const board = createLevelLeaderboard(kind, profile), levels = getLevels(profile, kind);
    const valid = { level: 1, name: 'Ada', sequence: sequenceFor(levels[0], kind) };
    for (const level of [undefined, null, true, [], {}, '', 0, -1, .5, Infinity, levels.length + 1, 'custom']) {
      invalid(() => board.getBoard({ level }));
    }
    for (const selector of [null, [], { date: '2026-10-18' }, { level: 1, date: '2026-10-18' }]) invalid(() => board.getBoard(selector));
    for (const extra of [{ date: '2026-10-18' }, { circuit: levels[0].circuit }, { puzzle: levels[0] }, { profile: 'controlled' },
      { game: key(kind, profile === 'prop' ? 'controlled' : 'prop') }]) {
      invalid(() => board.validateSubmission({ ...valid, ...extra }));
    }
    for (const sequence of [null, {}, 'H', [null]]) invalid(() => board.validateSubmission({ ...valid, sequence }));
    invalid(() => board.validateSubmission({ ...valid, name: '\u0000Ada' }));
    invalid(() => board.validateSubmission({ ...valid, name: 'A'.repeat(board.maxBytes) }), 413);
  }
});

test('advanced simplification counts equations only and rejects illegal or excessive work', () => {
  const descriptor = createLevelLeaderboard('simplification', 'prop'), puzzle = getLevels('prop')[0];
  const valid = { level: 1, name: 'Ada', sequence: puzzle.solution };
  const padded = [{ rule: 'insert-column', column: puzzle.circuit.columns.length },
    { rule: 'remove-column', column: puzzle.circuit.columns.length }, ...puzzle.solution, { rule: 'tidy' }];
  assert.equal(descriptor.validateSubmission({ ...valid, sequence: padded }).moves, 1);
  for (const move of [{ rule: 'cancel-swap', column: 0, wires: [0, 3] }, { rule: 'not-a-rule' },
    { rule: 'tidy', circuit: { wires: 2, columns: [[]] } }, { ...puzzle.solution[0], reverse: 'false' },
    { rule: 'insert-column', column: 0, count: 1e12 }, { rule: 'remove-column', column: 0 }]) {
    invalid(() => descriptor.validateSubmission({ ...valid, sequence: [move] }));
  }
  invalid(() => descriptor.validateSubmission({ ...valid, sequence: Array(MAX_REPLAY_MOVES + 1).fill({ rule: 'tidy' }) }));
  const controlled = createLevelLeaderboard('simplification', 'controlled'), braid = getLevels('controlled').at(-1);
  const expensive = [{ rule: 'insert-column', column: braid.circuit.columns.length, count: 48 - braid.circuit.columns.length },
    ...Array.from({ length: 490 }, () => [{ rule: 'remove-column', column: 47 }, { rule: 'insert-column', column: 47 }]).flat(), ...braid.solution];
  assert.ok(expensive.length <= MAX_REPLAY_MOVES);
  invalid(() => controlled.validateSubmission({ level: braid.id, name: 'Ada', sequence: expensive }));
});

test('deeply nested advanced submissions are invalid while ordinary oversized bodies keep their size status', () => {
  const raw = '{"level":1,"name":"Ada","sequence":[' + '['.repeat(12_000) + 'null' + ']'.repeat(12_000) + ']}';
  for (const profile of ['prop', 'controlled']) {
    const descriptor = createLevelLeaderboard('simplification', profile);
    assert.ok(Buffer.byteLength(raw) < descriptor.maxBytes);
    invalid(() => descriptor.validateSubmission(JSON.parse(raw)));
    invalid(() => descriptor.validateSubmission({ level: 1, name: 'Ada', sequence: [], padding: 'x'.repeat(descriptor.maxBytes) }), 413);
  }
});

test('advanced Signals verifies final offered placements without accepting a submitted score or target', () => {
  for (const profile of ['prop', 'controlled']) {
    const descriptor = createLevelLeaderboard('signals', profile), levels = getLevels(profile, 'signals');
    const puzzle = levels.at(-1), sequence = sequenceFor(puzzle, 'signals');
    const valid = { level: puzzle.id, name: 'Ada', sequence };
    assert.equal(Object.hasOwn(descriptor.validateSubmission(valid), 'moves'), false);
    for (const placement of [{ hole: -1, gate: 'I' }, { hole: 999, gate: 'I' }, { hole: 0, gate: 'NOT' },
      { hole: '0', gate: sequence[0].gate }, { hole: 0, gate: null }, { ...sequence[0], target: [1, 0] }]) {
      invalid(() => descriptor.validateSubmission({ ...valid, sequence: [placement] }));
    }
    invalid(() => descriptor.validateSubmission({ ...valid, sequence: [sequence[0], sequence[0]] }));
    invalid(() => descriptor.validateSubmission({ ...valid, moves: 1 }));
    invalid(() => descriptor.validateSubmission({ ...valid, target: puzzle.target }));
    invalid(() => descriptor.validateSubmission({ ...valid, sequence: [{ hole: 0, gate: 'I' }] }));
  }
});

test('the daily API rejects advanced categories without creating a daily board', async () => {
  const route = await loadApiFixture('api/daily.ts');
  for (const kind of ['simplification', 'signals']) for (const profile of ['prop', 'controlled']) {
    const response = await route.fetch(new Request(`https://example.test/api/daily?game=${key(kind, profile)}`));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'This game has no daily puzzle.' });
  }
});
