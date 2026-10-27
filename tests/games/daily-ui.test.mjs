import assert from 'node:assert/strict';
import test from 'node:test';
import { updateDailyHeading } from '../../src/lib/games/daily-ui.js';

function heading() {
  const nodes = new Map(['daily-heading', 'daily-date', 'daily-title', 'daily-note'].map(id => [id, {
    hidden: true, disabled: true, textContent: '',
  }]));
  return id => nodes.get(id);
}

test('daily headings distinguish open scoring and closed practice without changing the date', () => {
  const get = heading(), open = Object.freeze({ mode: 'daily', date: '2026-10-24', available: true, acceptingScores: true });
  updateDailyHeading(get, open);
  assert.equal(get('daily-heading').hidden, false); assert.equal(get('daily-date').disabled, false);
  assert.equal(get('daily-title').textContent, 'Daily puzzle · 24 Oct 2026');
  assert.equal(get('daily-note').textContent, 'Scores close at midnight (Paris).');

  updateDailyHeading(get, { ...open, available: false, acceptingScores: false });
  assert.equal(get('daily-heading').hidden, false); assert.equal(get('daily-date').disabled, true);
  assert.equal(get('daily-title').textContent, 'Daily puzzle · 24 Oct 2026');
  assert.equal(get('daily-note').textContent, 'Practice · leaderboard closed.');
  updateDailyHeading(get, open);
  assert.equal(get('daily-date').disabled, false);
  assert.equal(get('daily-note').textContent, 'Scores close at midnight (Paris).');
});

test('other modes hide the heading without formatting an absent date or overwriting its content', () => {
  const get = heading();
  get('daily-title').textContent = 'Last selected date'; get('daily-note').textContent = 'Last selected status';
  for (const mode of ['tutorial', 'campaign', 'random']) for (const available of [false, true]) {
    updateDailyHeading(get, { mode, available, acceptingScores: false });
    assert.equal(get('daily-heading').hidden, true); assert.equal(get('daily-date').disabled, !available);
    assert.equal(get('daily-title').textContent, 'Last selected date');
    assert.equal(get('daily-note').textContent, 'Last selected status');
  }
});
