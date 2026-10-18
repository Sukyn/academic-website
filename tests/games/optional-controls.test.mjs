import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { bindGameDialogs, updateModeMenu } from '../../src/lib/games/controls.js';
import { expandGameControls } from './markup.mjs';

function controls(ids) {
  const nodes = new Map(ids.map(id => [id, {
    open: false, hidden: false, disabled: false, attributes: new Map(), listeners: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, action) { this.listeners.set(name, action); },
    click(event = {}) { this.listeners.get('click')?.({ target: this, ...event }); },
    showModal() { this.open = true; }, close() { this.open = false; },
    getBoundingClientRect() { return { left: 10, right: 100, top: 10, bottom: 100 }; },
  }]));
  return id => nodes.get(id) ?? null;
}

test('games share mode controls without rendering daily controls', () => {
  const get = controls(['mode-tutorial', 'mode-campaign', 'mode-random']);
  for (const mode of ['tutorial', 'campaign', 'random']) {
    updateModeMenu(get, mode);
    for (const name of ['tutorial', 'campaign', 'random']) {
      assert.equal(get('mode-' + name).attributes.get('aria-pressed'), String(name === mode));
      assert.equal(get('mode-' + name).disabled, false);
    }
  }
  updateModeMenu(get, 'random', true, true);
  assert.equal(get('mode-random').disabled, true);
  assert.equal(get('mode-daily'), null);
  assert.equal(get('daily-games'), null);
});

for (const optional of [[], ['check-daily-puzzles'], ['daily-games']]) {
  test(`shared dialogs work without the complete daily interface (${optional.join(', ') || 'none'})`, () => {
    const get = controls(['rules-dialog', 'show-rules', 'close-rules', 'win-dialog', 'close-win', ...optional]);
    bindGameDialogs(get);
    const rules = get('rules-dialog'), show = get('show-rules'), win = get('win-dialog');
    show.disabled = true; show.click(); assert.equal(rules.open, false);
    show.disabled = false; show.click(); assert.equal(rules.open, true);
    rules.click({ clientX: 50, clientY: 50 }); assert.equal(rules.open, true);
    rules.click({ target: {}, clientX: 0, clientY: 0 }); assert.equal(rules.open, true);
    rules.click({ clientX: 0, clientY: 0 }); assert.equal(rules.open, false);
    show.click(); get('close-rules').click(); assert.equal(rules.open, false);
    win.showModal(); get('close-win').click(); assert.equal(win.open, false);
    if (get('check-daily-puzzles')) {
      win.showModal(); get('check-daily-puzzles').click(); assert.equal(win.open, true);
    }
    updateModeMenu(get, 'random');
    if (get('check-daily-puzzles')) assert.equal(get('check-daily-puzzles').hidden, true);
    if (get('daily-games')) assert.equal(get('daily-games').hidden, true);
  });
}

test('shared result fixtures keep campaign boards while daily and sharing controls are optional', async () => {
  const component = async name => (await readFile(new URL(`../../src/components/games/${name}.astro`, import.meta.url), 'utf8'))
    .replace(/^---[\s\S]*?---/, '');
  const defaults = await expandGameControls('<GameRulesDialog><p>Rules content</p></GameRulesDialog><GameResultDialog><Fragment slot="result-actions"><button id="forwarded-action">Forwarded</button></Fragment></GameResultDialog><GameRoundControls />', component);
  assert.match(defaults, /id="rules-dialog"/); assert.match(defaults, /<p>Rules content<\/p>/);
  assert.match(defaults, /aria-label="Close popup"/); assert.match(defaults, /id="win-title">GG/);
  assert.match(defaults, /id="show-results"/); assert.match(defaults, />Scores<\/button>/);
  assert.match(defaults, /id="result-next"/);
  for (const id of ['score-form', 'share-result', 'player-name', 'check-daily-puzzles', 'daily-result-actions', 'forwarded-action']) {
    assert.match(defaults, new RegExp(`id="${id}"`));
  }
  const advanced = await expandGameControls('<GameResultDialog title="Circuit complete" closeLabel="Close result" sharing={false} daily={false} /><GameRoundControls><button id="tidy">Tidy</button></GameRoundControls><GameHoleControls /><GameAutofocus />', component);
  assert.match(advanced, /id="win-title">Circuit complete/); assert.match(advanced, /aria-label="Close result"/);
  for (const id of ['undo', 'restart', 'tidy', 'erase-gate', 'autofocus', 'show-results', 'score-form', 'player-name',
    'result-leaderboard-body', 'player-rank', 'nickname-form', 'replay-result']) assert.match(advanced, new RegExp(`id="${id}"`));
  for (const id of ['share-dialog', 'share-result', 'win-practice', 'daily-result-actions', 'check-daily-puzzles']) {
    assert.doesNotMatch(advanced, new RegExp(`id="${id}"`));
  }
  assert.match(advanced, /id="autofocus"[^>]*aria-pressed="false"/);
  const completed = await expandGameControls('<GameResultDialog completionOnly sharing={false} daily={false} />', component);
  assert.match(completed, />Save completion<\/button>/); assert.match(completed, /<th scope="col">Completed<\/th>/);
  assert.doesNotMatch(completed, /id="player-rank"|<th scope="col">Rank<\/th>/);
  assert.match(completed, /id="result-actions"\s*>/);
  assert.doesNotMatch(completed, /id="daily-result-actions"/);
  const dailyCompleted = await expandGameControls('<GameResultDialog completionOnly />', component);
  assert.match(dailyCompleted, /id="daily-result-actions"/);
  assert.match(dailyCompleted, /id="replay-result"/);
  assert.match(dailyCompleted, />Share your replay<\/button>/);
  assert.doesNotMatch(dailyCompleted, /id="win-practice"|id="player-rank"|<th scope="col">Rank<\/th>/);
});

test('circuit host fixtures retain only the active PRO controls', async () => {
  const component = async name => (await readFile(new URL(`../../src/components/games/${name}.astro`, import.meta.url), 'utf8'))
    .replace(/^---[\s\S]*?---/, '');
  const html = await expandGameControls('<CircuitGame kind="signals"><div id="signal-board"></div><GameRoundControls /><CategoricalCircuitGame kind="signals" slot="categorical" /></CircuitGame><template><div id="signal-board"></div></template>', component);
  assert.match(html, /data-circuit-game="signals"/);
  assert.match(html, /data-pro-game/);
  assert.equal([...html.matchAll(/id="signal-board"/g)].length, 1);
  assert.equal([...html.matchAll(/id="undo"/g)].length, 1);
  assert.doesNotMatch(html, /<template|<CategoricalCircuitGame|data-categorical-game/);
});
