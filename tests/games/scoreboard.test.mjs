import assert from 'node:assert/strict';
import test from 'node:test';
import { createScoreboard } from '../../src/lib/games/scoreboard.js';
import { renderLeaderboard } from '../../src/lib/games/leaderboard.js';

const NAME_KEY = 'games.nickname.v1';
const settled = () => new Promise(resolve => setImmediate(resolve));

function setup(context, { completionOnly = false, nickname = null, blockedStorage = false, benchmark = { optimalMoves: 2 } } = {}) {
  class Element {
    constructor(tag = '') { this.tagName = tag.toUpperCase(); this.textContent = ''; this.children = []; this.value = ''; this.valid = true; this.attributes = {}; this.listeners = new Map(); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    reportValidity() { return this.valid; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    async trigger(type) {
      const event = { type, target: this, currentTarget: this, preventDefault() {} };
      await Promise.all((this.listeners.get(type) ?? []).map(listener => listener(event)));
    }
  }
  const ids = ['player-rank', 'leaderboard-body', 'result-leaderboard-body', 'leaderboard-total', 'result-leaderboard-total', 'leaderboard-status', 'score-status', 'score-form', 'player-name',
    'nickname-form', 'nickname-value', 'nickname-save', 'nickname-forget', 'nickname-status'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  if (completionOnly) elements.delete('player-rank');
  const get = id => elements.get(id);
  const previous = ['document', 'fetch', 'localStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Element(tag) } });
  const storage = new Map(nickname === null ? [] : [[NAME_KEY, nickname]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
    setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); storage.set(key, String(value)); },
    removeItem(key) { if (blockedStorage) throw new Error('Storage blocked'); storage.delete(key); },
  } });
  const requests = [];
  // Deliberately ignore abort: identity checks must also reject late responses.
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  let selected = { game: completionOnly ? 'quantum-signals' : 'circuit-reduction', level: 1 }, eligible = true, updates = 0, closed = 0;
  const scores = createScoreboard({
    get, selector: () => selected, completionOnly, ...(!completionOnly && { benchmark: () => benchmark }),
    canSubmit: () => eligible, sequence: () => completionOnly ? [{ hole: 'a', gate: 'X' }] : [{ rule: 'cancel-h', row: 0, column: 1 }],
    update: () => updates++, onDailyClosed: () => closed++,
  });
  if (nickname === null) get('player-name').value = ' Ada ';
  const reply = (request, data = { entries: [], currentPlayer: null, total: 0 }, status = 200) => request.resolve({
    ok: status >= 200 && status < 300, status, json: async () => data,
  });
  const board = (id, name = 'Ada') => {
    const entry = completionOnly ? { id, name, completed: true } : { id, name, rank: 1, moves: 2 };
    return { entries: [entry], currentPlayer: { ...entry }, total: 1 };
  };
  const submit = () => scores.submit({ preventDefault() {} });
  return { get, requests, scores, reply, board, submit, storage,
    select(value) { selected = value; }, eligible(value) { eligible = value; },
    get updates() { return updates; }, get closed() { return closed; },
  };
}

function assertTotals(app, expected) {
  for (const id of ['leaderboard-total', 'result-leaderboard-total']) {
    assert.equal(app.get(id).textContent, expected, id);
  }
}

for (const completionOnly of [false, true]) {
  const mode = completionOnly ? 'Completion' : 'Ranked';
  test(`${mode} leaderboards show every completed player and the total`, context => {
    const app = setup(context, { completionOnly });
    for (const [total, expected] of [
      [0, '0 players have completed this challenge.'],
      [1, '1 player has completed this challenge.'],
      [3, '3 players have completed this challenge.'],
      [10, '10 players have completed this challenge.'],
    ]) {
      const entries = Array.from({ length: total }, (_, index) => completionOnly
        ? { id: index + 1, name: `Player ${index + 1}`, completed: true }
        : { id: index + 1, name: `Player ${index + 1}`, rank: index + 1, moves: index + 2 });
      renderLeaderboard({ entries, currentPlayer: null, total }, { completionOnly, get: app.get });
      assertTotals(app, expected);
      for (const id of ['leaderboard-body', 'result-leaderboard-body']) {
        assert.equal(app.get(id).children.length, entries.length);
      }
    }
  });

  test(`${mode} scoreboard totals survive refresh failures and clear on round changes without accepting stale replies`, async context => {
    const app = setup(context, { completionOnly });
    const initial = app.scores.load();
    assertTotals(app, '');
    app.reply(app.requests.at(-1)); await initial;
    assertTotals(app, '0 players have completed this challenge.');

    const save = app.submit();
    app.reply(app.requests.at(-1), app.board(1)); await save;
    assertTotals(app, '1 player has completed this challenge.');

    const failedRefresh = app.scores.load();
    app.requests.at(-1).reject(new Error('Network unavailable'));
    await failedRefresh;
    assertTotals(app, '1 player has completed this challenge.');

    const oldBoard = app.scores.load(), oldRequest = app.requests.at(-1);
    app.scores.reset();
    assertTotals(app, '');
    app.select({ game: completionOnly ? 'quantum-signals' : 'circuit-reduction', level: 2 });
    const newBoard = app.scores.load();
    assertTotals(app, '');
    app.reply(app.requests.at(-1)); await newBoard;
    app.reply(oldRequest, app.board(1)); await oldBoard;
    assertTotals(app, '0 players have completed this challenge.');

    const oldSave = app.submit(), oldSaveRequest = app.requests.at(-1);
    app.scores.reset(); app.select(null);
    await app.scores.load();
    app.reply(oldSaveRequest, app.board(2)); await oldSave;
    assertTotals(app, '');
  });
}

test('shot rankings omit absent benchmarks and keep the first player row and shot units', async context => {
  const app = setup(context, { benchmark: { unit: 'shot' } });
  const load = app.scores.load();
  assert.equal(app.get('leaderboard-body').children.length, 0);
  app.reply(app.requests[0], app.board(1)); await load;
  assert.deepEqual(app.get('leaderboard-body').children.map(row => row.children.map(cell => cell.textContent)), [[1, 'Ada (you)', 2]]);
  assert.equal(app.get('leaderboard-body').children[0].className, 'current-player');
  assert.match(app.get('player-rank').textContent, /Best: 2 shots$/);
  const next = app.scores.load(), board = app.board(1);
  board.entries[0].moves = board.currentPlayer.moves = 1;
  app.reply(app.requests[1], board); await next;
  assert.match(app.get('player-rank').textContent, /Best: 1 shot$/);
});

test('round changes reject late leaderboard and score replies even when transport ignores abort', async context => {
  const app = setup(context);
  const oldBoard = app.scores.load();
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 2 });
  const newBoard = app.scores.load();
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.reply(app.requests[1]); await newBoard;
  app.reply(app.requests[0], app.board(1)); await oldBoard;
  assert.equal(app.scores.player, null);

  app.get('player-name').value = 'Ada';
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

test('Completion mode saves a replay without score fields and renders only names and checked boxes', async context => {
  const app = setup(context, { completionOnly: true });
  const loading = app.scores.load(), save = app.submit();
  await app.submit();
  assert.equal(app.requests.length, 2, 'Concurrent duplicate submissions are blocked.');
  assert.deepEqual(JSON.parse(app.requests[1].options.body), {
    game: 'quantum-signals', level: 1, name: 'Ada', sequence: [{ hole: 'a', gate: 'X' }],
  });
  const response = app.board(3);
  response.entries[0].name = response.currentPlayer.name = '<b>Ada</b>';
  app.reply(app.requests[1], response); await save;
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.reply(app.requests[0]); await loading;
  assert.equal(app.get('score-status').textContent, 'Completion saved.');
  assert.equal(app.get('player-rank'), undefined, 'Completion pages do not need rank markup.');
  for (const id of ['leaderboard-body', 'result-leaderboard-body']) {
    const [row] = app.get(id).children;
    assert.equal(app.get(id).children.length, 1, 'There is no benchmark row.');
    assert.equal(row.className, 'current-player');
    assert.equal(row.children.length, 2);
    assert.equal(row.children[0].textContent, '<b>Ada</b> (you)');
    assert.deepEqual(row.children[0].children, [], 'Names are text, never HTML.');
    const [checkbox] = row.children[1].children;
    assert.equal(checkbox.tagName, 'INPUT');
    assert.equal(checkbox.type, 'checkbox');
    assert.equal(checkbox.checked, true);
    assert.equal(checkbox.disabled, true);
    assert.equal(checkbox.attributes['aria-label'], 'Completed');
  }
  const refresh = app.scores.load();
  assert.equal(new URL(app.requests[2].url, 'https://example.test').searchParams.get('player'), '3');
  app.reply(app.requests[2], response); await refresh;
  await app.submit();
  assert.equal(app.requests.length, 3);
});

test('Completion boards show all players, including the current player after the first ten', async context => {
  const app = setup(context, { completionOnly: true });
  const entries = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Player ${index}`, completed: true }));
  const own = { id: 21, name: 'Zoe', completed: true };
  const loading = app.scores.load();
  app.reply(app.requests[0], { total: 21, entries: [...entries, own], currentPlayer: own }); await loading;
  assert.equal(app.get('leaderboard-body').children.length, 21);
  assertTotals(app, '21 players have completed this challenge.');
  assert.equal(app.get('leaderboard-body').children.at(-1).className, 'current-player');
  assert.equal(app.scores.player.id, 21);
});

test('Malformed completion boards preserve valid rows and reject score-bearing or inconsistent entries', async context => {
  const app = setup(context, { completionOnly: true });
  const loading = app.scores.load();
  app.reply(app.requests[0], app.board(7)); await loading;
  const player = app.scores.player, rows = app.get('leaderboard-body').children;
  const entry = { id: 7, name: 'Ada', completed: true };
  const withEntry = changes => ({ total: 1, entries: [{ ...entry, ...changes }], currentPlayer: null });
  const eleven = Array.from({ length: 11 }, (_, index) => ({ ...entry, id: index + 1 }));
  for (const response of [null, [], {},
    { total: -1, entries: [], currentPlayer: null },
    { total: '1', entries: [entry], currentPlayer: null },
    { total: 1, entries: [], currentPlayer: null },
    { total: 12, entries: [entry], currentPlayer: null },
    { total: 11, entries: eleven.slice(0, 10), currentPlayer: null },
    { total: 11, entries: eleven, currentPlayer: { ...eleven[0], id: 99 } },
    { total: 2, entries: [entry, entry], currentPlayer: null },
    withEntry({ id: 0 }), withEntry({ id: '7' }), withEntry({ completed: false }),
    withEntry({ completed: 1 }), withEntry({ completed: 'true' }),
    withEntry({ rank: 1 }), withEntry({ moves: 2 }), withEntry({ optimalMoves: 1 }), withEntry({ score: 1 }),
    withEntry({ name: '' }), withEntry({ name: '😀'.repeat(25) }), withEntry({ name: 'Ada\u202e' }),
    { ...app.board(7), currentPlayer: { ...entry, completed: false } },
    { ...app.board(7), currentPlayer: { ...entry, rank: 1 } },
    { ...app.board(7), currentPlayer: { ...entry, name: 'Other' } },
    { ...app.board(7), currentPlayer: undefined },
  ]) {
    const refresh = app.scores.load();
    app.reply(app.requests.at(-1), response); await refresh;
    assert.strictEqual(app.scores.player, player);
    assert.strictEqual(app.get('leaderboard-body').children, rows);
    assert.equal(app.get('leaderboard-status').textContent, 'Completions temporarily unavailable.');
  }
});

test('Completion retries and round changes retain stale-response and daily guards', async context => {
  const app = setup(context, { completionOnly: true });
  app.select({ game: 'quantum-signals', date: '2026-10-15' });
  const initial = app.scores.load(), oldRequest = app.requests.at(-1);
  for (const response of [{}, { ...app.board(5), currentPlayer: null }]) {
    const save = app.submit();
    app.reply(app.requests.at(-1), response, 201); await save;
    assert.equal(app.scores.player, null);
    assert.equal(app.scores.submitting, false);
    assert.equal(app.get('score-status').textContent, 'Completions temporarily unavailable.');
    assert.equal(oldRequest.options.signal.aborted, false);
  }
  const conflict = app.submit();
  app.reply(app.requests.at(-1), { error: 'Completion unavailable.' }, 409); await conflict;
  assert.equal(app.closed, 0, 'Completion conflicts do not close daily scoring in another game.');
  app.scores.reset(); app.select({ game: 'quantum-signals', level: 2 });
  app.get('player-name').value = 'Ada';
  const retry = app.submit(), savedRequest = app.requests.at(-1);
  app.scores.reset();
  app.reply(savedRequest, app.board(5), 201); await retry;
  app.reply(oldRequest, app.board(4)); await initial;
  assert.equal(app.scores.player, null);
  assert.equal(app.get('score-status').textContent, '');
  app.get('player-name').value = 'Ada';
  const final = app.submit();
  app.reply(app.requests.at(-1), app.board(6)); await final;
  assert.equal(app.scores.player.id, 6);
  assert.equal(app.get('score-status').textContent, 'Completion saved.');
});

test('successful manual saves remember the canonical nickname and start at most one automatic save per round', async context => {
  const app = setup(context);
  assert.equal(app.scores.autoSubmit(), false, 'A first-time player keeps the manual form');
  app.get('player-name').value = ' ada ';
  const manual = app.submit();
  assert.equal(app.storage.has(NAME_KEY), false, 'An unsaved nickname is not remembered');
  app.reply(app.requests[0], app.board(10, 'Ada')); await manual;
  assert.equal(app.storage.get(NAME_KEY), 'Ada', 'The server canonical name is remembered after success');
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 2 });
  assert.equal(app.scores.autoSubmit(), true, 'Starting an automatic save returns true synchronously');
  assert.equal(app.scores.automatic, true); assert.equal(app.scores.submitting, true);
  assert.equal(JSON.parse(app.requests[1].options.body).name, 'Ada');
  assert.equal(app.scores.autoSubmit(), false);
  await app.submit();
  assert.equal(app.requests.length, 2, 'Automatic and manual duplicate requests are blocked together');
  app.reply(app.requests[1], app.board(11)); await settled();
  assert.equal(app.scores.automatic, false); assert.equal(app.scores.submitting, false);
  assert.equal(app.scores.player.id, 11);
  assert.equal(app.scores.autoSubmit(), false, 'A saved round cannot start another automatic request');
});

test('automatic saves honor practice and custom guards without consuming the next eligible attempt', async context => {
  const app = setup(context, { nickname: 'Ada' });
  app.eligible(false);
  assert.equal(app.scores.autoSubmit(), false);
  app.eligible(true); app.select(null);
  assert.equal(app.scores.autoSubmit(), false);
  assert.equal(app.requests.length, 0);
  app.select({ game: 'circuit-reduction', date: '2026-10-15' });
  assert.equal(app.scores.autoSubmit(), true);
  const body = JSON.parse(app.requests[0].options.body);
  assert.equal(body.date, '2026-10-15'); assert.equal(body.name, 'Ada');
  app.reply(app.requests[0], app.board(12)); await settled();
  assert.equal(app.scores.player.id, 12);
});

test('reopening without a remembered nickname preserves failed manual input', async context => {
  const app = setup(context);
  const invalid = '😀'.repeat(25);
  app.get('player-name').value = invalid;
  await app.submit();
  assert.equal(app.requests.length, 0);
  assert.equal(app.scores.autoSubmit(), false);
  assert.equal(app.get('player-name').value, invalid, 'A validation error does not erase the entered nickname on reopen');
  const entered = ' Grace Hopper ';
  app.get('player-name').value = entered;
  const manual = app.submit();
  app.reply(app.requests[0], { error: 'unavailable' }, 503); await manual;
  assert.equal(app.scores.autoSubmit(), false);
  assert.equal(app.get('player-name').value, entered, 'A failed request also keeps its manual retry input');
  assert.equal(app.requests.length, 1);
  assert.equal(app.storage.has(NAME_KEY), false);
});

for (const status of [503, 429]) test(`automatic ${status} failures stop retrying and allow a manual retry`, async context => {
  const app = setup(context, { nickname: 'Ada' });
  assert.equal(app.scores.autoSubmit(), true);
  app.reply(app.requests[0], { error: status === 429 ? 'Try again later.' : 'private database error' }, status);
  await settled();
  assert.equal(app.scores.automatic, false); assert.equal(app.scores.submitting, false);
  assert.equal(app.scores.player, null);
  assert.equal(app.get('score-status').textContent, status === 429 ? 'Try again later.' : 'Scores temporarily unavailable.');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(app.scores.autoSubmit(), false);
  assert.equal(app.requests.length, 1, 'Updates cannot create an automatic retry loop');
  assert.equal(app.storage.get(NAME_KEY), 'Ada', 'Transient failures do not erase a valid nickname');
  const manual = app.submit();
  assert.equal(app.requests.length, 2, 'The manual form can retry after the automatic attempt fails');
  app.reply(app.requests[1], app.board(13)); await manual;
  assert.equal(app.scores.player.id, 13);
});

test('late score replies cannot remember a nickname or overwrite a newer round', async context => {
  const app = setup(context);
  const old = app.submit();
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 2 });
  app.get('player-name').value = 'Grace';
  const current = app.submit();
  app.reply(app.requests[1], app.board(15, 'Grace')); await current;
  assert.equal(app.storage.get(NAME_KEY), 'Grace');
  app.reply(app.requests[0], app.board(14, 'Stale nickname')); await old;
  assert.equal(app.scores.player.id, 15);
  assert.equal(app.storage.get(NAME_KEY), 'Grace', 'Transport success alone cannot cache a stale nickname');
  assert.equal(app.requests[0].options.signal.aborted, true);
});

test('editing or forgetting a nickname while a save is pending prevents late preference restoration', async context => {
  const app = setup(context, { nickname: 'Ada' });
  assert.equal(app.scores.autoSubmit(), true);
  assert.notEqual(app.get('nickname-save').disabled, true, 'Nickname preferences stay editable during a request');
  app.get('nickname-value').value = 'Grace'; await app.get('nickname-form').trigger('submit');
  assert.equal(app.storage.get(NAME_KEY), 'Grace', 'An explicit preference change applies immediately');
  app.reply(app.requests[0], app.board(16, 'Ada')); await settled();
  assert.equal(app.scores.player.name, 'Ada', 'The record already sent may still be saved');
  assert.equal(app.storage.get(NAME_KEY), 'Grace', 'The old response cannot overwrite the newer preference');
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 2 });
  assert.equal(app.scores.autoSubmit(), true);
  assert.equal(JSON.parse(app.requests[1].options.body).name, 'Grace');
  assert.notEqual(app.get('nickname-forget').disabled, true, 'Forgetting a nickname remains available while saving');
  await app.get('nickname-forget').trigger('click');
  assert.equal(app.storage.has(NAME_KEY), false);
  assert.equal(app.get('nickname-value').value, '');
  app.reply(app.requests[1], app.board(17, 'Grace')); await settled();
  assert.equal(app.scores.player.id, 17);
  assert.equal(app.storage.has(NAME_KEY), false, 'Forget also survives a successful pending response');
  assert.equal(app.get('nickname-value').value, '');
  app.scores.reset(); app.select({ game: 'circuit-reduction', level: 3 });
  assert.equal(app.scores.autoSubmit(), false, 'The next round returns to manual entry');
  assert.equal(app.requests.length, 2);
});

test('invalid remembered names preserve manual saving', async context => {
  const app = setup(context, { nickname: 'Ada\u202e' });
  assert.equal(app.scores.autoSubmit(), false);
  assert.equal(app.requests.length, 0, 'A corrupted remembered name is never submitted');
  app.get('player-name').value = 'Ada';
  const save = app.submit();
  app.reply(app.requests[0], app.board(18)); await save;
  assert.equal(app.scores.player.id, 18);
  assert.equal(app.storage.get(NAME_KEY), 'Ada');
});

test('storage errors do not turn a successful manual save into a failure', async context => {
  const app = setup(context, { blockedStorage: true });
  assert.equal(app.scores.autoSubmit(), false);
  app.get('player-name').value = 'Ada';
  const save = app.submit();
  app.reply(app.requests[0], app.board(19)); await save;
  assert.equal(app.scores.player.id, 19);
  assert.equal(app.scores.submitting, false);
  assert.equal(app.get('score-status').textContent, 'Score saved.');
  await app.get('nickname-forget').trigger('click');
  assert.equal(app.get('score-status').textContent, 'Nickname forgotten for this visit.');
  app.scores.reset();
  assert.equal(app.scores.autoSubmit(), false);
});

test('completion-only games automatically save remembered nicknames without ranked fields', async context => {
  const app = setup(context, { completionOnly: true, nickname: 'Ada' });
  assert.equal(app.scores.autoSubmit(), true);
  assert.equal(app.scores.automatic, true);
  assert.deepEqual(JSON.parse(app.requests[0].options.body), {
    game: 'quantum-signals', level: 1, name: 'Ada', sequence: [{ hole: 'a', gate: 'X' }],
  });
  app.reply(app.requests[0], app.board(20, 'Canonical Ada')); await settled();
  assert.equal(app.scores.automatic, false);
  assert.equal(app.get('score-status').textContent, 'Completion saved.');
  assert.equal(app.storage.get(NAME_KEY), 'Canonical Ada');
  assert.equal(app.scores.player.name, 'Canonical Ada');
});
