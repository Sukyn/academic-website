import assert from 'node:assert/strict';
import test from 'node:test';
import { startDailyFromLink } from '../../src/lib/games/daily-links.js';

function fixture(context, load = () => Promise.resolve()) {
  const location = { search: '' }, calls = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  context.after(() => original ? Object.defineProperty(globalThis, 'window', original) : delete globalThis.window);
  return { location, calls, daily: { load(...args) { calls.push(args); return load(); } } };
}

test('ordinary game URLs and unrelated query values retain the tutorial entry', context => {
  const app = fixture(context);
  for (const search of ['', '?daily', '?daily=0', '?daily=true', '?undaily=1', '?date=2026-10-17', '?daily=0&daily=1']) {
    app.location.search = search;
    assert.equal(startDailyFromLink(app.daily), false, search || 'no query');
  }
  assert.deepEqual(app.calls, [], 'Normal page entry never requests a daily puzzle');
});

test('an explicit daily link starts today once and ignores unrelated or archive-date parameters', context => {
  const app = fixture(context);
  for (const search of ['?daily=1', '?daily=%31', '?daily=1&date=2026-10-17&mode=custom']) {
    app.location.search = search;
    const before = app.calls.length;
    assert.equal(startDailyFromLink(app.daily), true);
    assert.equal(app.calls.length, before + 1);
    assert.deepEqual(app.calls.at(-1), [undefined, true], 'The shared link always selects the current daily puzzle');
  }
});

test('daily startup suppresses the tutorial immediately while the normal daily transport loads', context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const app = fixture(context, () => pending);
  app.location.search = '?daily=1';
  assert.equal(startDailyFromLink(app.daily), true);
  assert.deepEqual(app.calls, [[undefined, true]]);
  resolve();
});
