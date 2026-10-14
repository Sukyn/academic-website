import assert from 'node:assert/strict';
import test from 'node:test';
import { createScoreboard } from '../../src/lib/games/scoreboard.js';

function setup(context) {
  class Element {
    constructor() { this.textContent = ''; this.children = []; this.value = ''; this.valid = true; }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    reportValidity() { return this.valid; }
  }
  const ids = ['player-rank', 'leaderboard-body', 'result-leaderboard-body', 'leaderboard-status', 'score-status', 'score-form', 'player-name'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const get = id => elements.get(id);
  const previous = ['document', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  const requests = [];
  // Deliberately ignore abort: identity checks must also reject late responses.
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  let selected = { game: 'circuit-reduction', level: 1 }, eligible = true, updates = 0, closed = 0;
  const scores = createScoreboard({
    get, selector: () => selected, benchmark: () => ({ optimalMoves: 2 }),
    canSubmit: () => eligible, sequence: () => [{ rule: 'cancel-h', row: 0, column: 1 }],
    update: () => updates++, onDailyClosed: () => closed++,
  });
  get('player-name').value = ' Ada ';
  const reply = (request, data = { entries: [], currentPlayer: null, total: 0 }, status = 200) => request.resolve({
    ok: status >= 200 && status < 300, status, json: async () => data,
  });
  const board = id => ({ entries: [{ id, name: 'Ada', rank: 1, moves: 2 }], currentPlayer: { id, name: 'Ada', rank: 1, moves: 2 }, total: 1 });
  const submit = () => scores.submit({ preventDefault() {} });
  return { get, requests, scores, reply, board, submit,
    select(value) { selected = value; }, eligible(value) { eligible = value; },
    get updates() { return updates; }, get closed() { return closed; },
  };
}

test('round changes reject late leaderboard and score replies even when transport ignores abort', async context => {
  const app = setup(context);
  const oldBoard = app.scores.load();
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 2 });
  const newBoard = app.scores.load();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.reply(app.requests[1]); await newBoard;
  app.reply(app.requests[0], app.board(1)); await oldBoard;
  assert.equal(app.scores.player, null);

  const oldScore = app.submit();
  app.scores.reset();
  app.reply(app.requests[2], app.board(2)); await oldScore;
  assert.equal(app.scores.player, null);
  assert.equal(app.scores.submitting, false);
  assert.equal(app.get('score-status').textContent, '');
});

test('submission locks duplicates, cancels older ranks and refreshes the saved player', async context => {
  const app = setup(context);
  const boardRequest = app.scores.load(), scoreRequest = app.submit();
  await app.submit();
  assert.equal(app.requests.length, 2);
  assert.equal(app.scores.submitting, true);
  assert.deepEqual(JSON.parse(app.requests[1].options.body), {
    game: 'circuit-reduction', level: 1, name: 'Ada', sequence: [{ rule: 'cancel-h', row: 0, column: 1 }],
  });
  app.reply(app.requests[1], app.board(3)); await scoreRequest;
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.reply(app.requests[0]); await boardRequest;
  assert.equal(app.scores.player.id, 3);
  assert.equal(app.get('score-status').textContent, 'Score saved.');
  assert.equal(app.get('leaderboard-body').children.length, 2);
  assert.equal(app.get('result-leaderboard-body').children.length, 2);
  const refresh = app.scores.load();
  assert.equal(new URL(app.requests[2].url, 'https://example.test').searchParams.get('player'), '3');
  app.reply(app.requests[2], app.board(3)); await refresh;
  await app.submit();
  assert.equal(app.requests.length, 3, 'A saved round cannot submit twice');
});

test('score guards reject practice, invalid forms and long Unicode names before network work', async context => {
  const app = setup(context);
  app.eligible(false); await app.submit();
  app.eligible(true); app.get('score-form').valid = false; await app.submit();
  app.get('score-form').valid = true; app.get('player-name').value = '😀'.repeat(25); await app.submit();
  assert.equal(app.requests.length, 0);
  assert.equal(app.get('score-status').textContent, 'Use 1–24 characters.');
  app.get('player-name').value = '😀'.repeat(24);
  const score = app.submit();
  app.reply(app.requests[0], app.board(4)); await score;
  assert.equal(app.scores.player.id, 4);
  app.scores.reset(); app.select(null);
  await app.scores.load(); await app.submit();
  assert.equal(app.requests.length, 1, 'Custom rounds have no score selector');
});

test('closed daily scores trigger refresh once; only expected errors reach the UI', async context => {
  const app = setup(context);
  app.select({ date: '2026-10-14' });
  const closed = app.submit();
  app.reply(app.requests[0], { error: 'Scores have closed.' }, 409); await closed;
  assert.equal(app.closed, 1);
  assert.equal(app.get('score-status').textContent, 'Scores have closed.');
  const unavailable = app.submit();
  app.reply(app.requests[1], { error: 'private database error' }, 500); await unavailable;
  assert.equal(app.get('score-status').textContent, 'Scores temporarily unavailable.');
  assert.equal(app.scores.submitting, false);
  const invalid = app.submit();
  app.reply(app.requests[2], { error: 'Use a valid name.' }, 400); await invalid;
  assert.equal(app.get('score-status').textContent, 'Use a valid name.');
  assert.equal(app.closed, 1);
});

test('Malformed successful leaderboard responses preserve the last valid ranking', async context => {
  const app = setup(context);
  const initial = app.scores.load();
  app.reply(app.requests.at(-1), app.board(7)); await initial;
  const player = app.scores.player, rows = app.get('leaderboard-body').children;
  const entry = { id: 7, name: 'Ada', rank: 1, moves: 2 };
  const withEntry = changes => ({ total: 1, entries: [{ ...entry, ...changes }], currentPlayer: null });
  for (const response of [null, [], {},
    { total: -1, entries: [], currentPlayer: null },
    { total: Infinity, entries: [], currentPlayer: null },
    { total: '1', entries: [entry], currentPlayer: null },
    { total: 1, entries: {}, currentPlayer: null },
    { total: 1, entries: [], currentPlayer: null },
    { total: 11, entries: Array(11).fill(entry), currentPlayer: null },
    { total: 2, entries: [entry, entry], currentPlayer: null },
    withEntry({ id: '7' }), withEntry({ id: 0 }), withEntry({ moves: -1 }),
    withEntry({ rank: 2 }), withEntry({ rank: NaN }), withEntry({ name: null }),
    withEntry({ name: '😀'.repeat(25) }), withEntry({ name: 'Ada\u202e' }),
    { ...app.board(7), currentPlayer: { ...entry, moves: 999 } },
    { ...app.board(7), currentPlayer: undefined },
  ]) {
    const refresh = app.scores.load();
    app.reply(app.requests.at(-1), response); await refresh;
    assert.strictEqual(app.scores.player, player);
    assert.strictEqual(app.get('leaderboard-body').children, rows);
    assert.equal(app.get('leaderboard-status').textContent, 'Scores temporarily unavailable.');
  }
});

test('Malformed saved-score responses allow retry and do not cancel a pending valid ranking', async context => {
  const app = setup(context);
  const ranking = app.scores.load(), rankingRequest = app.requests.at(-1);
  for (const response of [{}, null, { ...app.board(5), currentPlayer: null }]) {
    const save = app.submit();
    app.reply(app.requests.at(-1), response, 201); await save;
    assert.equal(app.scores.player, null);
    assert.equal(app.scores.submitting, false);
    assert.equal(app.get('score-status').textContent, 'Scores temporarily unavailable.');
    assert.equal(rankingRequest.options.signal.aborted, false);
  }
  app.reply(rankingRequest); await ranking;
  const retry = app.submit();
  app.reply(app.requests.at(-1), app.board(5), 201); await retry;
  assert.equal(app.scores.player.id, 5);
  assert.equal(app.get('score-status').textContent, 'Score saved.');
});
