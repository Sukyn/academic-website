import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailySession } from '../../src/lib/games/daily-session.js';
import { dailyBounds } from '../../src/lib/games/daily-calendar.js';
import { validateCircuit } from '../../src/lib/circuit-reduction/engine.js';
import { validatePuzzle as validateSignalsPuzzle } from '../../src/lib/quantum-signals/engine.js';

function metadata(date = '2026-10-14', overrides = {}) {
  const today = overrides.today ?? date;
  return {
    date, today, startDate: '2026-10-13', serverNow: Date.parse(`${today}T12:00:00Z`),
    ...dailyBounds(date), nextChangeAt: dailyBounds(today).closesAt, acceptingScores: date === today,
    puzzle: { circuit: [['H', 'H']], optimalMoves: 1 }, ...overrides,
  };
}

function harness(context, options = {}) {
  const descriptors = new Map(['document', 'fetch', 'performance', 'setTimeout', 'clearTimeout']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalNow = Date.now;
  context.after(() => {
    Date.now = originalNow;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const requests = [], timers = new Map(), puzzles = [], updates = [];
  const status = { textContent: '' };
  const archive = { children: [], value: '', replacements: 0,
    replaceChildren(...children) { this.children = children; this.replacements++; } };
  let elapsed = 100, wallTime = Date.parse('2026-10-14T12:00:00Z'), chosenDate, busy = false;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => elapsed } });
  Date.now = () => wallTime;
  // Deliberately ignore aborts: a late response must still be rejected by the session.
  globalThis.fetch = (url, requestOptions) => new Promise((resolve, reject) => requests.push({ url, options: requestOptions, resolve, reject }));
  globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay }; timers.set(timer, timer); return timer; };
  globalThis.clearTimeout = timer => timers.delete(timer);
  let session;
  session = createDailySession({
    game: 'circuit-reduction', startDate: '2026-10-13', get: id => id === 'daily-status' ? status : archive,
    onPuzzle(response, select) { puzzles.push({ response, select }); if (select) chosenDate = response.date; },
    selectedDate: () => chosenDate, isBusy: () => busy,
    update: () => updates.push({ loading: session.loading }), ...options,
  });
  const respond = (request, body, status = 200) => request.resolve({ ok: status < 400, status, json: async () => body });
  const timerAt = delay => [...timers.values()].find(timer => timer.delay === delay);
  const runTimer = async timer => {
    assert.ok(timer, 'Expected scheduled timer'); timers.delete(timer); await timer.callback();
  };
  return {
    session, requests, timers, puzzles, updates, status, archive, respond, timerAt, runTimer,
    setElapsed: value => { elapsed = value; }, setWallTime: value => { wallTime = value; },
    setBusy: value => { busy = value; }, setDate: value => { chosenDate = value; },
  };
}

test('Daily sessions reject ignored-abort stale responses and explicit cancellation', async context => {
  let validations = 0;
  const h = harness(context, { validatePuzzle(puzzle) { validations++; return puzzle; } });
  const staleLoad = h.session.load('2026-10-14'), stale = h.requests.at(-1);
  assert.equal(h.session.loading, true);
  const currentLoad = h.session.load('2026-10-15'), current = h.requests.at(-1);
  assert.equal(stale.options.signal.aborted, true);
  assert.equal(new URL(current.url, 'https://game.test').searchParams.get('game'), 'circuit-reduction');
  assert.equal(current.options.cache, 'no-store');
  h.respond(current, metadata('2026-10-15')); await currentLoad;
  const currentInfo = h.session.info, updateCount = h.updates.length;
  h.respond(stale, metadata()); await staleLoad;
  assert.strictEqual(h.session.info, currentInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.updates.length, updateCount, 'A stale response cannot update the visible round');
  assert.equal(h.archive.value, '2026-10-15');
  assert.equal(validations, 1, 'Stale responses never run game validation');

  const cancelledLoad = h.session.load('2026-10-14'), cancelled = h.requests.at(-1);
  h.session.cancel();
  assert.equal(cancelled.options.signal.aborted, true);
  assert.equal(h.session.loading, false);
  assert.equal(h.status.textContent, '');
  h.respond(cancelled, metadata()); await cancelledLoad;
  assert.strictEqual(h.session.info, currentInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.timers.size, 0, 'Cancelled work cannot resurrect a refresh timer');
  assert.equal(validations, 1, 'Cancelled responses never run game validation');
});

test('The server clock follows elapsed time and archive metadata retains no puzzle', async context => {
  const h = harness(context);
  assert.equal(h.session.serverTime(), Date.now());
  const load = h.session.load(), response = metadata();
  h.respond(h.requests.at(-1), response); await load;
  assert.equal(h.session.serverTime(), response.serverNow);
  assert.equal(Object.hasOwn(h.session.info, 'puzzle'), false);
  assert.strictEqual(h.puzzles[0].response.puzzle, response.puzzle);
  assert.equal(h.archive.replacements, 1);
  assert.deepEqual(h.archive.children.map(option => option.value), ['2026-10-14', '2026-10-13']);

  h.setElapsed(2_100); h.setWallTime(response.serverNow - 86_400_000);
  assert.equal(h.session.serverTime(), response.serverNow + 2_000, 'Changing the computer clock does not reopen a closed ranking');
  const refresh = h.session.refresh();
  assert.equal(h.session.loading, false, 'A metadata refresh does not lock gameplay');
  h.respond(h.requests.at(-1), metadata('2026-10-14', { serverNow: response.serverNow + 2_000 })); await refresh;
  assert.equal(h.puzzles.at(-1).select, false);
  assert.equal(h.archive.replacements, 1, 'An unchanged date range reuses archive options');

  const rollover = h.session.refresh();
  h.respond(h.requests.at(-1), metadata('2026-10-14', { today: '2026-10-15', acceptingScores: false })); await rollover;
  assert.equal(h.archive.replacements, 2);
  assert.equal(h.archive.children[0].value, '2026-10-15');
  assert.equal(h.archive.value, '2026-10-14', 'Midnight preserves the currently played date');
  h.session.cancel();
});

test('An initial outage creates no puzzle and retries the same server date', async context => {
  const h = harness(context);
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), {}, 503); await load;
  assert.equal(h.session.info, undefined);
  assert.equal(h.puzzles.length, 0, 'An unavailable API never invents a local daily puzzle');
  assert.equal(h.session.loading, false);
  assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
  const retry = h.runTimer(h.timerAt(60_000));
  assert.equal(h.requests.length, 2);
  assert.equal(new URL(h.requests.at(-1).url, 'https://game.test').searchParams.get('date'), '2026-10-14');
  h.respond(h.requests.at(-1), metadata()); await retry;
  assert.equal(h.session.info.acceptingScores, true);
  assert.equal(h.status.textContent, '');
  assert.equal(h.puzzles.at(-1).select, true, 'The first successful response opens the requested puzzle');
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.timerAt(60_000), undefined);
  h.session.cancel();
});

test('Retries wait for gameplay to settle and cancellation clears deferred work', async context => {
  const h = harness(context);
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), {}, 503); await load;
  assert.equal(h.session.loading, false);
  h.setBusy(true);
  await h.runTimer(h.timerAt(60_000));
  assert.equal(h.requests.length, 1);
  assert.ok(h.timerAt(1_000));
  await h.runTimer(h.timerAt(1_000));
  assert.equal(h.requests.length, 1, 'An active animation postpones a replacing request');
  h.setBusy(false);
  const retry = h.runTimer(h.timerAt(1_000));
  assert.equal(h.requests.length, 2);
  h.respond(h.requests.at(-1), metadata()); await retry;
  assert.equal(h.puzzles.length, 1);

  const outage = h.session.load('2026-10-13');
  h.respond(h.requests.at(-1), {}, 503); await outage;
  h.setBusy(true); await h.runTimer(h.timerAt(60_000));
  assert.ok(h.timerAt(1_000));
  h.session.cancel();
  assert.equal(h.timers.size, 0);
  assert.equal(h.status.textContent, '');
});

test('Unranked daily puzzles use server data without benchmark metadata', async context => {
  const puzzle = { wires: 1, columns: [[{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: [0, 1] };
  const h = harness(context, { game: 'quantum-signals', ranked: false, validatePuzzle: validateSignalsPuzzle });
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), {}, 503); await load;
  assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
  assert.equal(h.puzzles.length, 0);
  const retry = h.runTimer(h.timerAt(60_000));
  h.respond(h.requests.at(-1), metadata('2026-10-14', { puzzle, acceptingScores: false })); await retry;
  assert.equal(h.status.textContent, '');
  assert.deepEqual(h.puzzles.at(-1).response.puzzle, puzzle);
  assert.equal(Object.hasOwn(h.puzzles.at(-1).response.puzzle, 'optimalMoves'), false);
  assert.equal(h.puzzles.at(-1).select, true);
  h.session.cancel();
});

test('Invalid archive dates do not retry', async context => {
  const h = harness(context);
  const load = h.session.load('2099-01-01');
  h.respond(h.requests.at(-1), { error: 'Choose an available daily puzzle.' }, 400); await load;
  assert.equal(h.status.textContent, 'Choose an available daily puzzle.');
  assert.equal(h.session.info, undefined);
  assert.equal(h.puzzles.length, 0);
  assert.equal(h.timers.size, 0);
});

test('A puzzle callback can cancel the session without resurrecting refresh work', async context => {
  let h;
  h = harness(context, { onPuzzle: () => h.session.cancel() });
  const load = h.session.load();
  h.respond(h.requests.at(-1), metadata()); await load;
  assert.equal(h.session.loading, false);
  assert.equal(h.status.textContent, '');
  assert.equal(h.archive.replacements, 0);
  assert.equal(h.timers.size, 0);
});

test('Malformed successful responses preserve the last valid round and retry at a bounded delay', async context => {
  const h = harness(context);
  const initial = h.session.load();
  h.respond(h.requests.at(-1), metadata()); await initial;
  const lastInfo = h.session.info, archive = h.archive.children;
  h.setElapsed(2_100);
  const lastClock = h.session.serverTime();
  for (const response of [null, [], {},
    metadata('2026-10-14', { serverNow: NaN }),
    metadata('2026-10-14', { serverNow: Infinity }),
    metadata('2026-10-14', { serverNow: '2026-10-14' }),
    metadata('2026-10-14', { nextChangeAt: NaN }),
    metadata('2026-10-14', { nextChangeAt: 0 }),
    metadata('2026-10-14', { opensAt: Infinity }),
    metadata('2026-10-14', { acceptingScores: 'yes' }),
    metadata('2026-10-14', { startDate: '2026-02-30' }),
    metadata('2026-10-14', { startDate: '0000-01-01' }),
    metadata('2026-10-14', { today: '9999-01-01' }),
    { ...metadata(), today: 'invalid' },
    metadata('2026-10-14', { date: '2026-10-15' }),
    metadata('2026-10-14', { puzzle: null }),
    metadata('2026-10-14', { puzzle: [] }),
    metadata('2026-10-14', { puzzle: {} }),
    metadata('2026-10-14', { puzzle: { optimalMoves: NaN } }),
    metadata('2026-10-14', { puzzle: { optimalMoves: 0 } }),
  ]) {
    const refresh = h.session.refresh();
    h.respond(h.requests.at(-1), response); await refresh;
    assert.strictEqual(h.session.info, lastInfo);
    assert.equal(h.session.serverTime(), lastClock);
    assert.strictEqual(h.archive.children, archive);
    assert.equal(h.puzzles.length, 1, 'Invalid transport data never enters a gameplay callback');
    assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
    assert.equal(h.timers.size, 1);
    assert.ok(h.timerAt(60_000), 'Malformed clocks cannot schedule an immediate refresh loop');
  }
  h.session.cancel();
});

test('Network failures preserve the ongoing round and recover metadata without resetting play', async context => {
  const h = harness(context);
  const initial = h.session.load();
  h.respond(h.requests.at(-1), metadata()); await initial;
  const lastInfo = h.session.info;
  const refresh = h.session.refresh();
  h.requests.at(-1).reject(new TypeError('Failed to fetch')); await refresh;
  assert.strictEqual(h.session.info, lastInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
  assert.ok(h.timerAt(60_000));
  const retry = h.runTimer(h.timerAt(60_000));
  h.respond(h.requests.at(-1), metadata()); await retry;
  assert.equal(h.puzzles.at(-1).select, false, 'A metadata retry preserves the ongoing puzzle');
  assert.equal(h.session.info.acceptingScores, true);
  assert.equal(h.status.textContent, '');
  h.session.cancel();
});

test('Gameplay validation runs before replacing metadata or the played puzzle', async context => {
  const h = harness(context, { validatePuzzle: puzzle => ({ ...puzzle, circuit: validateCircuit(puzzle.circuit) }) });
  const initial = h.session.load();
  h.respond(h.requests.at(-1), metadata()); await initial;
  const lastInfo = h.session.info;
  for (const circuit of [undefined, [['H']], [['ZU', '.']], [['H', 'H'], ['.']], [['erase', 'erase']]]) {
    const refresh = h.session.refresh();
    h.respond(h.requests.at(-1), metadata('2026-10-14', { puzzle: { circuit, optimalMoves: 1 } })); await refresh;
    assert.strictEqual(h.session.info, lastInfo);
    assert.equal(h.puzzles.length, 1);
    assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
    assert.ok(h.timerAt(60_000));
  }
  h.session.cancel();
});

test('Puzzle normalization runs once, preserves the raw response and follows ranked metadata checks', async context => {
  let calls = 0, normalized;
  const h = harness(context, {
    validatePuzzle(puzzle) {
      calls++;
      normalized = { circuit: validateCircuit(puzzle.circuit).map(row => [...row]) };
      return normalized;
    },
  });
  const response = Object.freeze(metadata()), originalPuzzle = response.puzzle;
  const load = h.session.load();
  h.respond(h.requests.at(-1), response); await load;
  assert.equal(calls, 1);
  const played = h.puzzles[0].response;
  assert.notStrictEqual(played, response, 'Normalization does not mutate the network response');
  assert.strictEqual(response.puzzle, originalPuzzle);
  assert.strictEqual(played.puzzle, normalized, 'Gameplay receives the normalizer result without repeating validation');
  assert.notStrictEqual(played.puzzle.circuit, originalPuzzle.circuit);
  assert.notStrictEqual(played.puzzle.circuit[0], originalPuzzle.circuit[0]);
  assert.equal(Object.hasOwn(played.puzzle, 'optimalMoves'), false, 'The normalizer may return only playable data');
  assert.equal(Object.hasOwn(h.session.info, 'puzzle'), false);

  const lastInfo = h.session.info, refresh = h.session.refresh();
  h.respond(h.requests.at(-1), metadata('2026-10-14', { puzzle: { circuit: [['H', 'H']], optimalMoves: 0 } }));
  await refresh;
  assert.equal(calls, 1, 'Invalid ranked metadata is rejected before gameplay validation');
  assert.strictEqual(h.session.info, lastInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
  h.session.cancel();
});

for (const game of ['quantum-golf', 'circuit-reduction', 'quantum-signals', 'graph-states']) {
  test(`${game}: invalid JSON creates no puzzle and a server retry recovers`, async context => {
    const h = harness(context, { game });
    const load = h.session.load('2026-10-14');
    assert.equal(new URL(h.requests.at(-1).url, 'https://game.test').searchParams.get('game'), game);
    h.requests.at(-1).resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected HTML'); } });
    await load;
    assert.equal(h.puzzles.length, 0);
    assert.equal(h.session.info, undefined);
    assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
    assert.equal(h.timers.size, 1);
    const retry = h.runTimer(h.timerAt(60_000)), response = metadata();
    h.respond(h.requests.at(-1), response); await retry;
    assert.strictEqual(h.puzzles[0].response, response, 'Only the received server puzzle enters gameplay');
    assert.equal(h.puzzles[0].select, true);
    assert.equal(h.status.textContent, '');
    h.session.cancel();
  });
}
