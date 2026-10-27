import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, availableMoves, isSolved, LEVELS as LESSONS, MAX_MOVES, ruleFamily } from '../../src/lib/zx-calculus/engine.js';
import solutions from '../../tools/zx-calculus/solutions.json' with { type: 'json' };
import { CAMPAIGN, DAILY_START, DAILY_VERSION, dailyPuzzle, getBoard, MAX_SUBMISSION_BYTES,
  validateSubmission } from '../../src/lib/zx-calculus/leaderboard.js';
import { dailyBounds } from '../../src/lib/games/daily-calendar.js';
import { getGame } from '../../src/lib/games/server.js';
import { SubmissionError } from '../../src/lib/games/submission.js';

const now = Date.parse(`${DAILY_START}T12:00:00Z`);
const LEVELS = LESSONS.map((level, index) => ({ ...level, solution: solutions[index] }));
const valid = changes => ({ level: 1, name: 'Ada', sequence: LEVELS[0].solution, ...changes });

function inversePrefix(diagram, move) {
  const after = applyMove(diagram, move), added = after.nodes.filter(node => !diagram.nodes.some(old => old.id === node.id)).map(node => node.id);
  if (move.rule === 'color') {
    const twice = applyMove(after, move), firstLayer = new Set(added);
    const secondLayer = new Set(twice.nodes.filter(node => !after.nodes.some(old => old.id === node.id)).map(node => node.id));
    const cancellations = twice.edges.filter(([a, b]) =>
      firstLayer.has(a) && secondLayer.has(b) || firstLayer.has(b) && secondLayer.has(a))
      .map(nodes => ({ rule: 'hh', nodes }));
    const sequence = [move, move, ...cancellations];
    assert.deepEqual(sequence.reduce(applyMove, diagram), diagram, 'Two colour changes need explicit HH cancellations to restore the diagram');
    return sequence;
  }
  const inverse = move.rule === 'insert' ? { rule: 'identity', nodes: added } :
    move.rule === 'insert-hh' ? { rule: 'hh', nodes: added } :
    move.rule === 'split' ? { rule: 'fusion', nodes: [...move.nodes, ...added] } :
    move.rule === 'add-hopf' ? { rule: 'hopf', nodes: move.nodes } : move;
  assert.deepEqual(applyMove(after, inverse), diagram);
  return [move, inverse];
}

test('every official ZX witness is validated and scores count the replay', () => {
  for (let level = 1; level <= LEVELS.length; level++) {
    const sequence = LEVELS[level - 1].solution;
    assert.deepEqual(validateSubmission(valid({ level, sequence, name: '  Zoë   Noether  ', moves: -1, rank: 0 }), now),
      { campaign: CAMPAIGN, level, name: 'Zoë Noether', moves: sequence.length });
  }
  assert.equal(getBoard({ level: '1' }, now).level, 1);
});

test('a colour change cannot silently remove the Hadamards from a scored solution', () => {
  const index = LEVELS.findIndex(level => level.solution[0]?.rule === 'color');
  assert.ok(index >= 0, 'An authored lesson introduces colour change');
  const colour = LEVELS[index].solution[0];
  const legacyShortcut = [colour, { rule: 'identity', nodes: colour.nodes }];
  assert.throws(() => validateSubmission(valid({ level: index + 1, sequence: legacyShortcut }), now),
    error => error instanceof SubmissionError && /does not reach the target/.test(error.message));
});

test('both directions of each unlocked equation can be used in scored campaign solutions', () => {
  for (const rule of ['insert', 'insert-hh', 'split', 'add-hopf', 'color']) {
    let found = false;
    for (const [index, level] of LEVELS.entries()) {
      if (!level.rules.includes(ruleFamily(rule))) continue;
      const move = availableMoves(level.diagram, { expand: true }).find(move => move.rule === rule);
      if (!move) continue;
      const sequence = [...inversePrefix(level.diagram, move), ...level.solution];
      assert.equal(validateSubmission(valid({ level: index + 1, sequence }), now).moves, sequence.length, rule);
      found = true;
      break;
    }
    assert.equal(found, true, `An unlocked lesson supports ${rule}`);
  }
});

test('daily scores accept inverse equations and count every rewrite', () => {
  const puzzle = dailyPuzzle(DAILY_START);
  for (const rule of ['insert', 'insert-hh', 'split', 'add-hopf', 'color']) {
    const move = availableMoves(puzzle.diagram, { expand: true }).find(move => move.rule === rule);
    assert.ok(move, rule);
    const sequence = [...inversePrefix(puzzle.diagram, move), ...puzzle.solution];
    assert.equal(validateSubmission({ date: DAILY_START, name: 'Ada', sequence }, now).moves, sequence.length, rule);
  }
});

test('daily ZX boards share the Paris calendar and publish only the playable diagram', () => {
  const puzzle = dailyPuzzle(DAILY_START), game = getGame('zx-calculus');
  assert.deepEqual(dailyPuzzle(DAILY_START), puzzle, 'A date must keep the same puzzle.');
  assert.equal(game.startDate, DAILY_START);
  assert.equal(game.maxBytes, MAX_SUBMISSION_BYTES);
  assert.equal(Object.hasOwn(game, 'completionOnly'), false);
  assert.deepEqual(game.dailyPuzzle(DAILY_START), { nodes: puzzle.diagram.nodes, edges: puzzle.diagram.edges });
  assert.deepEqual(validateSubmission({ date: DAILY_START, name: 'Ada', sequence: puzzle.solution }, now), {
    campaign: DAILY_VERSION, level: Number(DAILY_START.replaceAll('-', '')), name: 'Ada', moves: puzzle.solution.length,
    date: DAILY_START, ...dailyBounds(DAILY_START),
  });
});

test('generated daily witnesses stay verifiable across dates', () => {
  for (const offset of [0, 1, 2, 3, 7, 14, 31, 90, 180, 365]) {
    const instant = now + offset * 86_400_000, date = new Date(instant).toISOString().slice(0, 10);
    const sequence = dailyPuzzle(date).solution;
    assert.equal(validateSubmission({ date, name: 'Ada', sequence }, instant).moves, sequence.length);
  }
});

test('malformed selectors, names, rules and over-budget replays are rejected', () => {
  for (const selector of [null, [], {}, { level: 0 }, { level: 1.5 }, { level: LEVELS.length + 1 }, { level: {} },
    { date: DAILY_START, level: 1 }, { date: '2026-10-23' }, { date: '2026-02-30' }, { date: 20261022 }, { date: '2026-10-21' }]) {
    assert.throws(() => getBoard(selector, now), SubmissionError);
  }
  for (const payload of [null, [], true, {}, valid({ name: null }), valid({ name: 'x'.repeat(25) }),
    valid({ name: 'Ada\u202e' }), valid({ sequence: [] }), valid({ sequence: null }), valid({ sequence: [{}] }),
    ...[null, 0, true, 'identity', [], Object.assign([], { rule: 'identity', nodes: [4] })].map(move => valid({ sequence: [move] })),
    valid({ sequence: [{ rule: 'fusion', nodes: [-1, 999] }] }), valid({ sequence: [{ rule: 'unknown', nodes: [] }] }),
    valid({ sequence: Array(MAX_MOVES + 1).fill(LEVELS[0].solution[0]) })]) {
    assert.throws(() => validateSubmission(payload, now), SubmissionError);
  }
  assert.throws(() => validateSubmission(valid({ ignored: '🦊'.repeat(MAX_SUBMISSION_BYTES / 4) }), now),
    error => error instanceof SubmissionError && error.status === 413);
  const circular = valid();
  circular.ignored = circular;
  assert.throws(() => validateSubmission(circular, now), SubmissionError);
});

test('forged graphs and truncated witnesses cannot claim a completion', () => {
  const levelIndex = LEVELS.findIndex(({ diagram, solution }) =>
    !isSolved(solution.slice(0, -1).reduce(applyMove, diagram)));
  assert.notEqual(levelIndex, -1);
  assert.throws(() => validateSubmission(valid({ level: levelIndex + 1,
    sequence: LEVELS[levelIndex].solution.slice(0, -1), diagram: { nodes: [], edges: [] } }), now), SubmissionError);
});

test('lesson rule restrictions are enforced before applying a rewrite', () => {
  const restricted = LEVELS.findIndex(level => level.rules && !level.rules.includes('color'));
  assert.notEqual(restricted, -1, 'The introductory lessons should use a smaller rule set.');
  assert.throws(() => validateSubmission(valid({ level: restricted + 1,
    sequence: [{ rule: 'color', nodes: [LEVELS[restricted].diagram.nodes.find(node => node.kind === 'z' || node.kind === 'x')?.id] }] }), now),
  error => error instanceof SubmissionError && /invalid ZX rule/.test(error.message));
});

test('inverse directions stay locked until their equation family is introduced', () => {
  const first = LEVELS[0];
  const hh = availableMoves(first.diagram, { expand: true }).find(move => move.rule === 'insert-hh');
  const color = availableMoves(first.diagram).find(move => move.rule === 'color');
  const hopf = [
    { rule: 'insert', edge: [1, 3], kind: 'x' },
    { rule: 'add-hopf', nodes: [4, 6] },
    { rule: 'hopf', nodes: [4, 6] },
    { rule: 'identity', nodes: [6] },
  ];
  for (const prefix of [inversePrefix(first.diagram, hh), inversePrefix(first.diagram, color), hopf]) {
    const sequence = [...prefix, ...first.solution];
    assert.equal(isSolved(sequence.reduce(applyMove, first.diagram)), true, 'A valid mathematical solution may still use a locked lesson equation.');
    assert.throws(() => validateSubmission(valid({ sequence }), now), error => error instanceof SubmissionError && /invalid ZX rule/.test(error.message));
  }
});

test('daily scores close at Paris midnight and older boards remain readable', () => {
  const { opensAt, closesAt } = dailyBounds(DAILY_START), puzzle = dailyPuzzle(DAILY_START);
  const payload = { date: DAILY_START, name: 'Ada', sequence: puzzle.solution };
  assert.equal(validateSubmission(payload, opensAt).moves, puzzle.solution.length);
  assert.equal(validateSubmission(payload, closesAt - 1).moves, puzzle.solution.length);
  assert.throws(() => validateSubmission(payload, closesAt), error => error instanceof SubmissionError && error.status === 409);
  assert.deepEqual(getBoard(payload, closesAt).puzzle, puzzle);
});
