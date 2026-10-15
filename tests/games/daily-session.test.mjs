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
  const h = harness(context);
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

  const cancelledLoad = h.session.load('2026-10-14'), cancelled = h.requests.at(-1);
  h.session.cancel();
  assert.equal(cancelled.options.signal.aborted, true);
  assert.equal(h.session.loading, false);
  assert.equal(h.status.textContent, '');
  h.respond(cancelled, metadata()); await cancelledLoad;
  assert.strictEqual(h.session.info, currentInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.timers.size, 0, 'Cancelled work cannot resurrect a refresh timer');
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

test('Offline metadata retries online eligibility without replacing the played puzzle', async context => {
  const fallbackDates = [];
  const h = harness(context, { fallback: date => {
    fallbackDates.push(date); return metadata(date, { offline: true, acceptingScores: false });
  } });
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), {}, 503); await load;
  assert.deepEqual(fallbackDates, ['2026-10-14']);
  assert.equal(h.session.info.acceptingScores, false);
  assert.match(h.status.textContent, /Offline practice/);
  assert.equal(h.puzzles.at(-1).select, true);
  const retry = h.runTimer(h.timerAt(60_000));
  assert.equal(h.requests.length, 2);
  assert.equal(new URL(h.requests.at(-1).url, 'https://game.test').searchParams.get('date'), '2026-10-14');
  h.respond(h.requests.at(-1), metadata()); await retry;
  assert.equal(h.session.info.acceptingScores, true);
  assert.equal(h.status.textContent, '');
  assert.equal(h.puzzles.at(-1).select, false);
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

test('Unranked daily puzzles recover from offline fallback without benchmark metadata', async context => {
  const puzzle = { wires: 1, columns: [[{ id: 'a', wires: [0], choices: ['I', 'X'] }]], target: [0, 1] };
  const h = harness(context, { ranked: false, validatePuzzle: validateSignalsPuzzle, offlineMessage: 'Offline puzzle.',
    fallback: date => metadata(date, { puzzle, acceptingScores: false, offline: true }) });
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), {}, 503); await load;
  assert.equal(h.status.textContent, 'Offline puzzle.');
  assert.deepEqual(h.puzzles.at(-1).response.puzzle, puzzle);
  assert.equal(Object.hasOwn(h.puzzles.at(-1).response.puzzle, 'optimalMoves'), false);
  const retry = h.runTimer(h.timerAt(60_000));
  h.respond(h.requests.at(-1), metadata('2026-10-14', { puzzle, acceptingScores: false })); await retry;
  assert.equal(h.status.textContent, '');
  assert.equal(h.puzzles.at(-1).select, false);
  h.session.cancel();
});

test('Invalid archive dates never retry or enter offline fallback', async context => {
  const h = harness(context, { fallback: () => { assert.fail('Validation errors are not offline outages'); } });
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

test('Malformed successful responses use a valid offline puzzle when the game supports fallback', async context => {
  const dates = [];
  const h = harness(context, { fallback: date => {
    dates.push(date);
    return metadata(date, { offline: true, acceptingScores: false });
  } });
  const load = h.session.load('2026-10-14');
  h.respond(h.requests.at(-1), metadata('2026-10-14', { nextChangeAt: Infinity })); await load;
  assert.deepEqual(dates, ['2026-10-14']);
  assert.equal(h.session.info.offline, true);
  assert.equal(h.session.info.acceptingScores, false);
  assert.equal(h.puzzles.length, 1);
  assert.match(h.status.textContent, /Offline practice/);
  assert.ok(h.timerAt(60_000));
  const retry = h.runTimer(h.timerAt(60_000));
  h.respond(h.requests.at(-1), metadata()); await retry;
  assert.equal(h.puzzles.at(-1).select, false, 'Recovery updates eligibility while preserving the ongoing round');
  assert.equal(h.session.info.acceptingScores, true);
  assert.equal(h.status.textContent, '');
  h.session.cancel();
});

test('Invalid offline metadata is rejected rather than corrupting the active round', async context => {
  const h = harness(context, { fallback: () => metadata('2026-10-14', { serverNow: null }) });
  const initial = h.session.load();
  h.respond(h.requests.at(-1), metadata()); await initial;
  const lastInfo = h.session.info;
  const refresh = h.session.refresh();
  h.respond(h.requests.at(-1), {}, 503); await refresh;
  assert.strictEqual(h.session.info, lastInfo);
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.status.textContent, 'Daily puzzle unavailable. Try again.');
  assert.ok(h.timerAt(60_000));
  h.session.cancel();
});

test('Gameplay validation runs before replacing metadata or the played puzzle', async context => {
  const h = harness(context, { validatePuzzle: puzzle => validateCircuit(puzzle.circuit) });
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

test('Invalid JSON in an HTTP 200 response enters the supported offline fallback', async context => {
  const h = harness(context, { fallback: date => metadata(date, { offline: true, acceptingScores: false }),
    validatePuzzle: puzzle => validateCircuit(puzzle.circuit) });
  const load = h.session.load('2026-10-14');
  h.requests.at(-1).resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected HTML'); } });
  await load;
  assert.equal(h.puzzles.length, 1);
  assert.equal(h.session.info.offline, true);
  assert.match(h.status.textContent, /Offline practice/);
  assert.ok(h.timerAt(60_000));
  h.session.cancel();
});
