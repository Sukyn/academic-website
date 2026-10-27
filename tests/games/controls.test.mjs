import assert from 'node:assert/strict';
import test from 'node:test';
import { ignoresShortcut } from '../../src/lib/browser/shortcuts.js';
import { bindGameDialogs, directionalControl, handleGateShortcut, handleRoundShortcut, ignoresGameShortcut,
  rectangleCells, updateLevelControls, updateModeMenu, updateResultMenu } from '../../src/lib/games/controls.js';

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

test('campaign navigation follows caller eligibility and keeps both next buttons in sync', () => {
  const nodes = new Map(['campaign-controls', 'level', 'previous-level', 'next-level', 'result-next'].map(id => [id, {
    value: '', hidden: false, disabled: false,
    click() { assert.fail('Rendering navigation must not select a level'); },
    focus() { assert.fail('Rendering navigation must not move focus'); },
  }]));
  const get = id => { assert.ok(nodes.has(id), `Unexpected control: ${id}`); return nodes.get(id); };
  for (const { level, count, loading, canAdvance, previousDisabled, nextDisabled, resultHidden } of [
    { level: 1, count: 3, loading: false, canAdvance: false, previousDisabled: true, nextDisabled: true, resultHidden: false },
    { level: 2, count: 3, loading: false, canAdvance: true, previousDisabled: false, nextDisabled: false, resultHidden: false },
    { level: 2, count: 3, loading: false, canAdvance: false, previousDisabled: false, nextDisabled: true, resultHidden: false },
    { level: 2, count: 3, loading: true, canAdvance: true, previousDisabled: true, nextDisabled: true, resultHidden: false },
    { level: 3, count: 3, loading: false, canAdvance: true, previousDisabled: false, nextDisabled: true, resultHidden: true },
    { level: 1, count: 1, loading: false, canAdvance: true, previousDisabled: true, nextDisabled: true, resultHidden: true },
  ]) {
    updateLevelControls(get, Object.freeze({ mode: 'campaign', level, count, loading, canAdvance }));
    assert.equal(get('campaign-controls').hidden, false);
    assert.equal(get('level').value, String(level)); assert.equal(get('level').disabled, loading);
    assert.equal(get('previous-level').disabled, previousDisabled);
    assert.equal(get('next-level').disabled, nextDisabled); assert.equal(get('result-next').disabled, nextDisabled);
    assert.equal(get('result-next').hidden, resultHidden);
  }
});

test('inactive campaign navigation cannot advance or overwrite the selected campaign level', () => {
  const nodes = new Map(['campaign-controls', 'level', 'previous-level', 'next-level', 'result-next'].map(id => [id, {
    value: '2', hidden: false, disabled: false,
  }]));
  const get = id => nodes.get(id);
  for (const mode of ['tutorial', 'random', 'daily']) for (const loading of [false, true]) {
    updateLevelControls(get, { mode, level: 1, count: 3, loading, canAdvance: true });
    assert.equal(get('campaign-controls').hidden, true); assert.equal(get('level').value, '2');
    assert.equal(get('level').disabled, loading);
    for (const id of ['previous-level', 'next-level', 'result-next']) assert.equal(get(id).disabled, true);
    assert.equal(get('result-next').hidden, true);
  }
});

test('daily result menus move existing replay controls and retain nickname management', () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { children: [], hidden: false, open: false, appends: 0, listeners: new Map(),
      appendChild(child) {
        if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
        child.parentElement = this; this.children.push(child); this.appends++;
        return child;
      },
      addEventListener(name, action) { this.listeners.set(name, action); },
      click() { this.listeners.get('click')?.(); },
    });
    return nodes.get(id);
  };
  const actions = get('result-replay-actions'), advanced = get('result-advanced-features');
  const daily = get('daily-result-actions'), nickname = get('nickname-form');
  advanced.appendChild(actions); advanced.appendChild(nickname); advanced.open = true;
  const replay = get('replay-result'), share = get('share-result');
  actions.appendChild(replay); actions.appendChild(share);
  let replays = 0, shares = 0;
  replay.addEventListener('click', () => replays++); share.addEventListener('click', () => shares++);
  nickname.hidden = true;

  updateResultMenu(get, true);
  assert.equal(actions.parentElement, daily); assert.equal(daily.hidden, false);
  assert.equal(advanced.hidden, true, 'Daily results hide the empty Advanced disclosure');
  assert.deepEqual(actions.children, [replay, share], 'Replay and Share move together');
  const appends = daily.appends;
  updateResultMenu(get, true);
  assert.equal(daily.appends, appends, 'Repeated rendering does not move an already placed block');
  replay.click(); share.click();
  assert.deepEqual([replays, shares], [1, 1], 'Moving controls preserves their listeners');

  nickname.hidden = false; updateResultMenu(get, true);
  assert.equal(advanced.hidden, false, 'A saved nickname remains editable during daily play');
  assert.equal(nickname.parentElement, advanced);
  nickname.hidden = true; updateResultMenu(get, true);
  assert.equal(advanced.hidden, true, 'Forgetting the nickname removes the empty disclosure');

  updateResultMenu(get, false);
  assert.equal(actions.parentElement, advanced); assert.equal(daily.hidden, true);
  assert.equal(advanced.hidden, false); assert.equal(advanced.open, true, 'Mode changes preserve the disclosure state');
  replay.click(); share.click(); assert.deepEqual([replays, shares], [2, 2]);
});

test('shared shortcut guard protects editing and dialogs without swallowing game-specific modifiers', context => {
  assert.equal(ignoresGameShortcut, ignoresShortcut, 'Games and other browser tools use the same shortcut guard');
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
  assert.equal(ignoresShortcut(event({ repeat: true }), true), false, 'Circuit navigation can opt into held keys');
  for (const flag of ['defaultPrevented', 'altKey']) assert.equal(ignoresShortcut(event({ repeat: true, [flag]: true }), true), true);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(ignoresGameShortcut(event({}, { tagName })), true);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(ignoresShortcut(event({ repeat: true }, { tagName }), true), true);
  assert.equal(ignoresGameShortcut(event({}, { isContentEditable: true })), true);
  for (const flag of ['ctrlKey', 'metaKey', 'shiftKey']) assert.equal(ignoresGameShortcut(event({ [flag]: true })), false);
  modal = {}; assert.equal(ignoresGameShortcut(event()), true);
  assert.equal(ignoresShortcut(event({ repeat: true }), true), true, 'Held circuit navigation still respects modal focus');
});

const keyEvent = (key, extra = {}, target = {}) => ({ key, target: { tagName: 'BUTTON', ...target }, ...extra,
  prevented: 0, preventDefault() { this.prevented++; this.defaultPrevented = true; } });

test('round shortcuts preserve native editing, modifiers, undo and reset before gate dispatch', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let modal = null;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => modal } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const actions = [], round = { undo: () => actions.push('undo'), reset: () => actions.push('reset') };
  for (const event of [keyEvent('Backspace'), keyEvent('z', { ctrlKey: true }), keyEvent('Z', { metaKey: true })]) {
    assert.equal(handleRoundShortcut(event, round), true);
    assert.equal(actions.pop(), 'undo'); assert.equal(event.prevented, 1);
  }
  for (const key of ['r', 'R']) {
    const event = keyEvent(key);
    assert.equal(handleRoundShortcut(event, round), true);
    assert.equal(actions.pop(), 'reset'); assert.equal(event.prevented, 1);
  }
  for (const event of [keyEvent('z', { ctrlKey: true, shiftKey: true }), keyEvent('H', { ctrlKey: true }),
    keyEvent('r', { metaKey: true }), keyEvent('r', { altKey: true }), keyEvent('r', { repeat: true }),
    keyEvent('Backspace', { defaultPrevented: true })]) {
    assert.equal(handleRoundShortcut(event, round), true);
    assert.equal(event.prevented, 0); assert.deepEqual(actions, []);
  }
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }]) {
    for (const key of ['r', 'H', 'Backspace']) {
      const event = keyEvent(key, {}, target);
      assert.equal(handleRoundShortcut(event, round), true);
      assert.equal(event.prevented, 0); assert.deepEqual(actions, []);
    }
  }
  modal = {};
  assert.equal(handleRoundShortcut(keyEvent('H'), round), true);
  modal = null;
  assert.equal(handleRoundShortcut(keyEvent('H'), { ...round, blocked: true }), true);
  const reviewEvent = keyEvent('H');
  assert.equal(handleRoundShortcut(reviewEvent, round), false);
  assert.equal(handleGateShortcut(reviewEvent, { choices: ['H'], place: () => actions.push('H'), blocked: true }), false);
  assert.equal(reviewEvent.prevented, 0); assert.deepEqual(actions, [], 'Review blocks gate edits without consuming their keys');
  assert.equal(handleRoundShortcut(keyEvent('Backspace'), round), true);
  assert.equal(actions.pop(), 'undo', 'Undo remains available to leave replay review');
});

test('gate shortcuts use the visible palette order and preserve erase and directional navigation', () => {
  const actions = [], settings = { choices: ['I', 'H', 'X', 'Z'], place: gate => actions.push(gate),
    erase: () => actions.push('erase'), navigate: key => actions.push(key) };
  for (const [event, expected] of [
    [keyEvent('h'), 'H'], [keyEvent('Z', { shiftKey: true }), 'Z'], [keyEvent('1'), 'I'],
    [keyEvent('@', { code: 'Digit2', shiftKey: true }), 'H'], [keyEvent('4', { code: 'Numpad4' }), 'Z'],
    [keyEvent('Delete'), 'erase'], ...['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map(key => [keyEvent(key), key]),
  ]) {
    assert.equal(handleGateShortcut(event, settings), true);
    assert.equal(actions.pop(), expected); assert.equal(event.prevented, 1);
  }
  const missing = keyEvent('4');
  assert.equal(handleGateShortcut(missing, { ...settings, choices: ['I', 'SWAP'] }), false);
  assert.equal(missing.prevented, 0);
  const swap = keyEvent('2');
  assert.equal(handleGateShortcut(swap, { ...settings, choices: ['I', 'SWAP'] }), true);
  assert.equal(actions.pop(), 'SWAP', 'New gates use the same numeric palette shortcuts');
  for (const event of [keyEvent('5'), keyEvent('(', { code: 'Digit5' })]) {
    assert.equal(handleGateShortcut(event, { ...settings, choices: ['I', 'CX', 'XC', 'CZ', 'SWAP'] }), true);
    assert.equal(actions.pop(), 'SWAP', 'Every whole-gate choice has its advertised numeric shortcut');
  }
  const unavailable = keyEvent('9');
  assert.equal(handleGateShortcut(unavailable, settings), false); assert.equal(unavailable.prevented, 0);
  for (const key of ['Q', 'Enter', 'Escape']) {
    const event = keyEvent(key);
    assert.equal(handleGateShortcut(event, settings), false); assert.equal(event.prevented, 0);
  }
  assert.deepEqual(actions, []);
});

test('directional controls keep row alignment, forward distance and stable ties without selecting the origin', () => {
  const control = (left, top, width = 20, height = 20) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });
  const origin = control(100, 100), right = control(200, 100), farther = control(300, 100), nearDiagonal = control(125, 110);
  const left = control(40, 100), up = control(100, 0), down = control(100, 300);
  const candidates = [origin, nearDiagonal, farther, right, left, up, down];
  assert.equal(directionalControl(origin, candidates, 'ArrowRight'), right);
  assert.equal(directionalControl(origin, candidates, 'ArrowLeft'), left);
  assert.equal(directionalControl(origin, candidates, 'ArrowUp'), up);
  assert.equal(directionalControl(origin, candidates, 'ArrowDown'), down);
  const firstTie = control(200, 100), secondTie = control(200, 100);
  assert.equal(directionalControl(origin, [firstTie, secondTie], 'ArrowRight'), firstTie);
  assert.equal(directionalControl(origin, [origin, control(101, 100)], 'ArrowRight'), null, 'The one-pixel threshold ignores overlapping controls');
  assert.equal(directionalControl(null, candidates, 'ArrowRight'), null);
  assert.equal(directionalControl(origin, candidates, 'Enter'), null);
});

test('rectangle selections share the same inclusive row and column order in either drag direction', () => {
  const expected = ['1:2', '1:3', '1:4', '2:2', '2:3', '2:4'];
  assert.deepEqual([...rectangleCells('1:2', '2:4')], expected);
  assert.deepEqual([...rectangleCells('2:4', '1:2')], expected);
  assert.deepEqual([...rectangleCells('1:4', '2:2')], expected);
  assert.deepEqual([...rectangleCells('0:0', '0:0')], ['0:0']);
});
