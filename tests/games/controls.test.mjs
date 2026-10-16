import assert from 'node:assert/strict';
import test from 'node:test';
import { bindGameDialogs, ignoresGameShortcut, updateModeMenu } from '../../src/lib/games/controls.js';

for (const extraDialogs of [[], ['gate-legend']]) test(`shared dialogs respect disabled controls and backdrop boundaries (${extraDialogs.length ? 'with guide' : 'default'})`, () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, {
        open: false, disabled: false, hidden: false, openings: 0,
        addEventListener(type, action) { listeners.set(type, action); },
        emit(type, event = {}) { listeners.get(type)?.({ target: this, ...event }); },
        showModal() { this.open = true; this.openings++; }, close() { this.open = false; },
        scrollIntoView(options) { this.scrolled = options; },
        focus(options) { this.focused = options; },
        getBoundingClientRect() { return { left: 10, right: 100, top: 20, bottom: 120 }; },
      });
    }
    return nodes.get(id);
  };
  bindGameDialogs(get, extraDialogs);
  const show = get('show-rules'), rules = get('rules-dialog'), win = get('win-dialog');
  show.disabled = true; show.emit('click'); assert.equal(rules.open, false);
  show.disabled = false; show.emit('click'); show.emit('click'); assert.equal(rules.openings, 1);
  rules.emit('click', { clientX: 50, clientY: 50 }); assert.equal(rules.open, true);
  rules.emit('click', { target: {}, clientX: 0, clientY: 0 }); assert.equal(rules.open, true);
  rules.emit('click', { clientX: 9, clientY: 50 }); assert.equal(rules.open, false);
  show.emit('click'); get('close-rules').emit('click'); assert.equal(rules.open, false);
  win.showModal(); win.emit('click', { clientX: 50, clientY: 121 }); assert.equal(win.open, false);
  win.showModal(); get('close-win').emit('click'); assert.equal(win.open, false);
  const check = get('check-daily-puzzles'), dailyGames = get('daily-games');
  check.emit('click'); assert.equal(dailyGames.focused, undefined, 'A closed result cannot redirect focus');
  win.showModal(); check.hidden = true; check.emit('click');
  assert.equal(win.open, true); assert.equal(dailyGames.focused, undefined, 'Other game modes cannot jump to hidden daily links');
  check.hidden = false; check.disabled = true; check.emit('click');
  assert.equal(win.open, true); assert.equal(dailyGames.scrolled, undefined, 'Pending saves keep the result open');
  check.disabled = false; check.emit('click');
  assert.equal(win.open, false);
  assert.deepEqual(dailyGames.scrolled, { block: 'start' });
  assert.deepEqual(dailyGames.focused, { preventScroll: true }, 'Checking other daily puzzles reveals and focuses their navigation');
  if (extraDialogs.length) {
    const legend = get('gate-legend-dialog'), showLegend = get('show-gate-legend');
    showLegend.disabled = true; showLegend.emit('click'); assert.equal(legend.open, false);
    showLegend.disabled = false; showLegend.emit('click'); showLegend.emit('click'); assert.equal(legend.openings, 1);
    legend.emit('click', { clientX: 50, clientY: 50 }); assert.equal(legend.open, true);
    legend.emit('click', { clientX: 0, clientY: 0 }); assert.equal(legend.open, false);
    showLegend.emit('click'); get('close-gate-legend').emit('click'); assert.equal(legend.open, false);
  }
});

test('daily navigation is visible only in Daily mode and save locks reset without changing mode controls', () => {
  const nodes = new Map(), modes = ['tutorial', 'campaign', 'random', 'daily'];
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, inert: false, attrs: new Map(),
      setAttribute(name, value) { this.attrs.set(name, value); } });
    return nodes.get(id);
  };
  /** @type {[string, boolean, boolean][]} */
  const states = [
    ['daily', false, true], ['daily', false, false], ['campaign', true, false],
    ['random', false, false], ['tutorial', false, false],
  ];
  for (const [mode, locked, saving] of states) {
    updateModeMenu(get, mode, locked, saving);
    for (const name of modes) {
      assert.equal(get('mode-' + name).attrs.get('aria-pressed'), String(name === mode));
      assert.equal(get('mode-' + name).disabled, locked);
    }
    assert.equal(get('daily-games').hidden, mode !== 'daily');
    assert.equal(get('daily-games').inert, saving);
    assert.equal(get('check-daily-puzzles').hidden, mode !== 'daily');
    assert.equal(get('check-daily-puzzles').disabled, saving);
  }
});

test('shared shortcut guard protects editing and dialogs without swallowing game-specific modifiers', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let modal = null;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => modal } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const event = (extra = {}, target = {}) => ({ target: { tagName: 'BUTTON', ...target }, ...extra });
  assert.equal(ignoresGameShortcut(event()), false);
  for (const flag of ['defaultPrevented', 'altKey', 'repeat']) assert.equal(ignoresGameShortcut(event({ [flag]: true })), true);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(ignoresGameShortcut(event({}, { tagName })), true);
  assert.equal(ignoresGameShortcut(event({}, { isContentEditable: true })), true);
  for (const flag of ['ctrlKey', 'metaKey', 'shiftKey']) assert.equal(ignoresGameShortcut(event({ [flag]: true })), false);
  modal = {}; assert.equal(ignoresGameShortcut(event()), true);
});
