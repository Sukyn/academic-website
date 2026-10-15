import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RULES, applyMove, cloneCircuit, isSolved, sequenceCost } from '../../src/lib/circuit-reduction/engine.js';
import { LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { DAILY_START } from '../../src/lib/circuit-reduction/puzzles.js';
import { dailyBounds, dailyDate } from '../../src/lib/games/daily-calendar.js';

const root = new URL('../../', import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));

async function gameMarkup() {
  let html = await readFile(new URL('src/pages/games/circuit-reduction.astro', root), 'utf8');
  const component = async name => (await readFile(new URL(`src/components/games/${name}.astro`, root), 'utf8')).replace(/^---[\s\S]*?---/, '');
  for (const name of ['GameModeMenu', 'GameToolbar', 'GameLeaderboard']) html = html.replace(new RegExp(`<${name}\\b[^>]*\\/>`), await component(name));
  const dialogs = html.match(/<GameDialogs\b[^>]*>([\s\S]*?)<\/GameDialogs>/);
  assert.ok(dialogs, 'The circuit game uses the same overlays as Golf');
  html = html.replace(dialogs[0], (await component('GameDialogs'))
    .replace('<slot name="rules" />', dialogs[1].match(/<Fragment slot="rules">([\s\S]*?)<\/Fragment>/)?.[1] ?? '')
    .replace('<slot name="result-actions" />', ''));
  html = html.replace(/\{RULES\.map\(rule => <button[^\n]+/g,
    RULES.map(rule => `<button type="button" data-rule="${rule.id}" aria-label="${rule.title}" disabled>${rule.title}</button>`).join(''));
  html = html.replace(/\{RULES\.map\(rule => <div data-reference-rule[^\n]+/g,
    RULES.map(rule => `<div data-reference-rule="${rule.id}">${rule.title}</div>`).join(''));
  return html.replace(/^---[\s\S]*?---/, '').replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/g, '');
}

test('circuit controller preserves rounds, validates scoring, cancels stale work and follows Paris midnight', async context => {
  class Element {
    constructor(tag = 'DIV') {
      this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = new Map();
      this.style = { setProperty() {} }; this.hidden = this.disabled = this.open = false; this.value = ''; this._text = '';
    }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
    async dispatch(name, extra = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      const path = [this]; if (['click', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel'].includes(name)) for (let parent = this.parentElement; parent; parent = parent.parentElement) path.push(parent);
      const promises = [];
      for (const node of path) {
        event.currentTarget = node;
        for (const callback of node.listeners.get(name) ?? []) promises.push(callback(event));
      }
      await Promise.all(promises);
    }
    click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
      if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
      if (selector.startsWith('.')) return (this.className ?? '').split(/\s+/).includes(selector.slice(1));
      const match = selector.match(/^(button)?\[data-([\w-]+)\]$/);
      return Boolean(match && (!match[1] || this.tagName === 'BUTTON') && Object.hasOwn(this.dataset, match[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())));
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    appendChild(child) {
      if (child.tagName === '#FRAGMENT') { for (const node of [...child.children]) this.appendChild(node); }
      else { child.remove(); child.parentElement = this; this.children.push(child); }
      return child;
    }
    remove() { const siblings = this.parentElement?.children; if (siblings) siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; for (const child of children) this.appendChild(child); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
    focus() { document.activeElement = this; }
    setPointerCapture() {}
    releasePointerCapture() {}
    reportValidity() { return true; }
    getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 100 }; }
  }

  const html = await gameMarkup(), elements = new Map(), documentMock = new Element('DOCUMENT'), ancestors = [];
  for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
    const tag = match[2].toLowerCase();
    if (match[1]) { const index = ancestors.findLastIndex(parent => parent.tag === tag); if (index >= 0) ancestors.length = index; continue; }
    const node = new Element(tag.toUpperCase());
    node.className = match[3].match(/\bclass="([^"]*)"/)?.[1] ?? '';
    for (const attribute of match[3].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.hidden = /\bhidden\b/.test(match[3]); node.disabled = /\bdisabled\b/.test(match[3]);
    node.value = node.attrs.value ?? '';
    if (node.attrs.id) elements.set(node.attrs.id, node);
    (ancestors.at(-1)?.node ?? documentMock).appendChild(node);
    if (!['input', 'img', 'br', 'hr', 'link', 'meta'].includes(tag)) ancestors.push({ tag, node });
  }
  const get = id => { assert.ok(elements.has(id), `Real game markup contains #${id}`); return elements.get(id); };
  const rules = documentMock.querySelectorAll('[data-rule]');
  assert.equal(rules.length, RULES.length, 'All printed and Unity rules are playable');
  documentMock.getElementById = get;
  documentMock.createElement = tag => new Element(tag.toUpperCase());
  documentMock.createElementNS = (_namespace, tag) => new Element(tag.toUpperCase());
  documentMock.createDocumentFragment = () => new Element('#FRAGMENT');
  Object.defineProperty(documentMock, 'visibilityState', { get: () => documentMock.hidden ? 'hidden' : 'visible' });
  const query = documentMock.querySelector.bind(documentMock);
  documentMock.querySelector = selector => {
    if (selector.startsWith('#')) { const [id, child] = selector.split(/\s+/); return child ? get(id.slice(1)).querySelector(child) : get(id.slice(1)); }
    return query(selector);
  };
  get('difficulty').value = '6';
  const globals = ['document', 'window', 'navigator', 'fetch', 'performance', 'Worker', 'setTimeout', 'clearTimeout', '__circuitGif'];
  const descriptors = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  context.after(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const originalDateNow = Date.now;
  Date.now = () => Date.parse('2026-10-14T12:00:00Z');
  context.after(() => { Date.now = originalDateNow; });
  const windowMock = new Element('WINDOW'), requests = [], workers = [], gifs = [], timers = new Map();
  let monotonic = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => monotonic } });
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject }));
  globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay }; timers.set(timer, timer); return timer; };
  globalThis.clearTimeout = timer => timers.delete(timer);
  let failPosting = false;
  const WorkerMock = class {
    constructor() { this.onmessage = null; this.onerror = null; workers.push(this); }
    postMessage(message) { if (failPosting) throw new Error('Message could not be posted'); this.message = message; }
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage?.({ data }); }
  };
  globalThis.Worker = WorkerMock;
  globalThis.__circuitGif = (...args) => new Promise((resolve, reject) => gifs.push({ args, resolve, reject }));
  const scriptURL = new URL('src/scripts/circuit-reduction.js', root);
  const original = await readFile(scriptURL, 'utf8');
  const instrumented = original
    .replace(/import\(['"]\.\.\/lib\/circuit-reduction\/replay-gif\.js['"]\)/g, 'Promise.resolve({ createReplayGif: globalThis.__circuitGif })')
    .replace(/from (['"])(\.\.\/lib\/[^'"]+)\1/g, (_, _quote, path) => `from '${new URL(path, scriptURL).href}'`)
    .replace(/new URL\(['"]\.\/circuit-reduction-worker\.js['"], import\.meta\.url\)/g, `new URL('${new URL('./circuit-reduction-worker.js', scriptURL).href}')`);
  await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);

  const click = id => get(id).click();
  const moveCount = () => Number(get('move-count').textContent.split(' ')[0]);
  const boardSignature = () => get('circuit-board').querySelectorAll('[data-cell]').map(cell => cell.getAttribute('aria-label')).join('|');
  const boardCircuit = () => {
    const circuit = [];
    const symbols = { 'empty slot': '.', H: 'H', X: 'X', Z: 'Z', 'upper Z endpoint': 'ZU', 'lower Z endpoint': 'ZD', 'upper X endpoint': 'XU', 'lower X endpoint': 'XD' };
    for (const cell of get('circuit-board').querySelectorAll('[data-cell]')) {
      const [row, column] = cell.dataset.cell.split(':').map(Number);
      (circuit[row] ??= [])[column] = symbols[cell.getAttribute('aria-label').split(': ').at(-1)];
    }
    return circuit;
  };
  const selected = () => get('circuit-board').querySelectorAll('[data-cell]').filter(cell => cell.getAttribute('aria-pressed') === 'true');
  const requestPath = request => new URL(request.url, 'https://example.test').pathname;
  const pendingDaily = () => requests.findLast(request => requestPath(request) === '/api/daily' && !request.replied);
  const boardData = (currentPlayer = null) => ({ entries: currentPlayer ? [currentPlayer] : [], currentPlayer, total: currentPlayer ? 1 : 0 });
  async function reply(request, data, status = 200) { assert.ok(request); request.replied = true; request.resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); await settle(); }
  async function boards() { for (const request of requests.filter(request => requestPath(request) === '/api/leaderboard' && request.options.method !== 'POST' && !request.replied)) await reply(request, boardData()); }
  async function chooseLevel(id) { get('level').value = id; await get('level').dispatch('change'); await boards(); }
  async function addSpace(row, column, count = 1, all = false) {
    for (let index = 0; index < count; index++) {
      const gap = get('circuit-board').querySelectorAll('[data-space]').find(node => node.dataset.space === `${row}:${column}`);
      assert.ok(gap, 'Identity space is added directly at a wire boundary');
      await gap.dispatch('click', { shiftKey: all });
    }
  }
  async function removeSpace(row, column) {
    const cell = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.cell === `${row}:${column}`);
    assert.ok(cell, 'An identity slot is visible on its wire');
    await cell.dispatch('contextmenu');
  }
  async function play(move) {
    if (move.rule === 'arrange') {
      await click('compact-identities');
      // Reproduce the solver's free layout using the same wire-spacing controls
      // available to a player, retaining gate order and linked endpoints.
      const seen = move.circuit.map(() => 0);
      for (let column = 0; column < move.circuit[0].length; column++) for (let row = 0; row < move.circuit.length; row++) {
        const symbol = move.circuit[row][column];
        if (symbol === '.') continue;
        const current = boardCircuit()[row].flatMap((cell, index) => cell === '.' ? [] : [{ cell, index }])[seen[row]++];
        assert.equal(current.cell, symbol);
        if (symbol.endsWith('D')) continue;
        assert.ok(current.index <= column, 'Free arrangement only adds space after compaction');
        if (current.index < column) {
          await addSpace(row, current.index, column - current.index);
        }
      }
      while (boardCircuit()[0].length > move.circuit[0].length) {
        const column = boardCircuit()[0].length - 1;
        assert.ok(boardCircuit().every(line => line[column] === '.'));
        await removeSpace(0, column);
      }
      if (boardCircuit()[0].length < move.circuit[0].length) {
        await addSpace(0, boardCircuit()[0].length, move.circuit[0].length - boardCircuit()[0].length, true);
      }
      assert.deepEqual(boardCircuit(), move.circuit, 'Players can recreate the free witness arrangement');
    } else if (move.rule === 'compact-identities') {
      await click('compact-identities');
    } else if (move.rule === 'insert-space') {
      await addSpace(move.row, move.column, move.count ?? 1);
    } else if (move.rule === 'remove-space') {
      await removeSpace(move.row, move.column);
    } else if (move.rule.endsWith('-column')) {
      if (move.rule === 'insert-column') await addSpace(0, move.column, move.count ?? 1, true);
      else await removeSpace(0, move.column);
    } else {
      const rule = RULES.find(rule => rule.id === move.rule);
      for (let y = 0; y < rule.left.length; y++) for (let x = 0; x < rule.left[0].length; x++) {
        const cell = get('circuit-board').querySelectorAll('[data-cell]').find(button => button.dataset.cell === `${move.row + y}:${move.column + x}`);
        assert.ok(cell, 'The rule window is on the visible board'); await cell.click();
      }
      const button = rules.find(button => button.dataset.rule === move.rule);
      assert.equal(button.disabled, false, `Selected window enables ${move.rule}`); await button.click();
    }
  }
  async function finish(puzzle) { for (const move of puzzle.solution) await play(move); assert.ok(isSolved(boardCircuit())); assert.equal(get('win-dialog').open, true); }
  function metadata(date, serverNow = Date.parse('2026-10-14T12:00:00Z')) {
    const today = dailyDate(serverNow), bounds = dailyBounds(date);
    return { today, date, startDate: DAILY_START, serverNow, ...bounds, nextChangeAt: dailyBounds(today).closesAt,
      acceptingScores: date === today && serverNow >= bounds.opensAt && serverNow < bounds.closesAt, puzzle: dailyPuzzle(date) };
  }
  async function loadDaily(date, serverNow, today = false) {
    get('daily-date').value = date;
    const loading = today ? click('mode-daily') : get('daily-date').dispatch('change');
    await reply(pendingDaily(), metadata(date, serverNow)); await loading; await boards();
  }

  await boards();
  // A first metadata request can be cancelled before any server clock exists.
  // Back/forward restoration unlocks the same round and restarts its ranks.
  const beforeRestoreBoard = boardSignature();
  const interruptedDailyLoad = click('mode-daily'), interruptedDaily = pendingDaily();
  assert.equal(get('restart').disabled, true);
  await windowMock.dispatch('pagehide');
  assert.equal(interruptedDaily.options.signal.aborted, true);
  await windowMock.dispatch('pageshow', { persisted: true });
  assert.equal(get('restart').disabled, false);
  assert.ok(get('circuit-board').querySelectorAll('[data-cell]').every(cell => !cell.disabled));
  await reply(interruptedDaily, metadata('2026-10-14')); await interruptedDailyLoad; await boards();
  assert.equal(boardSignature(), beforeRestoreBoard, 'A cancelled Daily response preserves the restored board');
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');

  // Advanced remains available before the first move, so its Trace control
  // can be used without needing to discover it after a completed round.
  assert.equal(get('advanced-features').hidden, false);
  assert.equal(get('toggle-trace').closest('.advanced-features'), get('advanced-features'));
  assert.equal(get('sequence').closest('.advanced-features'), get('advanced-features'));
  assert.equal(get('review-controls').closest('.advanced-features'), null, 'Replay navigation remains reachable outside collapsed Advanced');
  assert.equal(get('replay').closest('.advanced-features'), get('advanced-features'));
  assert.equal(get('replay-result').closest('.advanced-features'), get('result-advanced-features'));
  assert.equal(get('share-score').parentElement, get('replay-actions'));
  assert.equal(get('share-result').parentElement, get('result-replay-actions'));
  await click('toggle-trace'); assert.equal(get('sequence').hidden, true);
  await click('toggle-trace'); assert.equal(get('sequence').hidden, false);
  // Tutorial rules and their reference cards unlock only when introduced.
  for (const button of rules) {
    assert.equal(button.hidden, !LEVELS[0].allowedRules.includes(button.dataset.rule));
    if (button.hidden) assert.equal(button.disabled, true);
    assert.ok(button.querySelector('.rule-preview'), 'The playable rule shows a circuit diagram');
  }
  assert.equal(elements.has('paper-rules'), false, 'Rules are not placed in a collapsed Advanced disclosure');
  assert.ok(rules.every(button => button.parentElement === rules[0].parentElement), 'All rules share the visible palette');
  const xGate = get('circuit-board').querySelectorAll('[data-cell]').find(cell => /: X$/.test(cell.getAttribute('aria-label')));
  assert.ok(xGate.children[0]?.children.some(node => node.tagName === 'PATH'), 'X is drawn as a vector plus');
  assert.equal(xGate.textContent, '', 'The X symbol does not rely on a Unicode glyph');

  // Layout is unbounded, costs no rewrites, and can be compacted in one action.
  for (const id of ['space-wire', 'space-position', 'space-count', 'add-space', 'insert-column', 'remove-column']) assert.equal(elements.has(id), false, 'Spacing needs no separate form');
  await addSpace(0, 1, 50); assert.equal(boardCircuit()[0].length, 54); assert.equal(moveCount(), 0);
  await addSpace(0, 0, 100, true); assert.equal(boardCircuit()[0].length, 154); assert.equal(moveCount(), 0);
  await click('compact-identities'); assert.deepEqual(boardCircuit(), [['X', 'X']]); assert.equal(moveCount(), 0);
  await click('restart'); await boards();

  // Right-click edits the clicked identity; a gate stays intact. A gap's
  // context menu removes the identity immediately before that boundary.
  let beforeSpace = boardCircuit();
  await removeSpace(0, 0);
  assert.deepEqual(boardCircuit(), applyMove(beforeSpace, { rule: 'remove-space', row: 0, column: 0 }));
  assert.equal(moveCount(), 0);
  await click('undo'); await boards();
  const gateBeforeRemoval = boardSignature(); await removeSpace(0, 1); assert.equal(boardSignature(), gateBeforeRemoval);
  await addSpace(0, 1);
  beforeSpace = boardCircuit();
  const gap = get('circuit-board').querySelectorAll('[data-space]').find(node => node.dataset.space === '0:1');
  await gap.dispatch('contextmenu');
  assert.deepEqual(boardCircuit(), applyMove(beforeSpace, { rule: 'remove-space', row: 0, column: 0 }));
  await click('restart'); await boards();

  // Delete keeps focus on the same wire as the board shrinks, so consecutive
  // key presses can remove trailing identities without finding the cell again.
  const keyboardLesson = LEVELS.find(lesson => lesson.circuit.length > 1);
  await chooseLevel(keyboardLesson.id);
  const keyboardInitial = boardCircuit(), keyboardRow = 1, keyboardWidth = keyboardInitial[0].length;
  await addSpace(keyboardRow, keyboardWidth, 2);
  let focusedCell = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.cell === `${keyboardRow}:${keyboardWidth + 1}`);
  focusedCell.focus();
  for (let removed = 1; removed <= 2; removed++) {
    const previouslyFocused = documentMock.activeElement;
    await documentMock.dispatch('keydown', { target: previouslyFocused, key: 'Delete' });
    assert.equal(boardCircuit()[0].length, keyboardWidth + 2 - removed);
    focusedCell = documentMock.activeElement;
    assert.notEqual(focusedCell, previouslyFocused, 'Focus transfers to the rebuilt circuit');
    assert.equal(focusedCell.parentElement, get('circuit-board'), 'Keyboard focus remains on a live circuit cell');
    assert.equal(focusedCell.dataset.cell, `${keyboardRow}:${keyboardWidth + 1 - removed}`, 'Focus follows the nearest surviving column on the same wire');
    assert.equal(moveCount(), 0, 'Keyboard spacing edits remain free');
  }
  assert.deepEqual(boardCircuit(), keyboardInitial);
  const focusedGate = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.gate !== '.');
  focusedGate.focus();
  await documentMock.dispatch('keydown', { target: focusedGate, key: 'Delete' });
  assert.deepEqual(boardCircuit(), keyboardInitial, 'Delete preserves a focused gate');
  assert.equal(documentMock.activeElement, focusedGate);
  await chooseLevel(1);

  // Touch holds perform the same free edit, suppress its compatibility click,
  // and allow scrolling to cancel a pending hold.
  let held = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.cell === '0:0');
  beforeSpace = boardCircuit();
  await held.dispatch('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 50, clientY: 50 });
  const hold = [...timers.values()].find(timer => timer.delay === 450); assert.ok(hold, 'Touch removal has a deliberate hold threshold');
  timers.delete(hold); hold.callback();
  await get('circuit-board').dispatch('pointerup', { pointerType: 'touch', pointerId: 7 });
  assert.deepEqual(boardCircuit(), applyMove(beforeSpace, { rule: 'remove-space', row: 0, column: 0 }));
  held = get('circuit-board').querySelectorAll('[data-cell]')[0];
  monotonic += 2500;
  await held.click(); assert.equal(selected().length, 0, 'A delayed compatibility click after slow rendering still cannot select a rule cell');
  await held.dispatch('pointerdown', { pointerType: 'touch', pointerId: 9, clientX: 50, clientY: 50 });
  await held.dispatch('pointerup', { pointerType: 'touch', pointerId: 9 });
  await held.click(); assert.equal(selected().length, 1, 'The next deliberate touch tap selects its cell immediately');
  await held.click(); assert.equal(selected().length, 0);
  await click('restart'); await boards();
  held = get('circuit-board').querySelectorAll('[data-cell]')[0];
  await held.dispatch('pointerdown', { pointerType: 'touch', pointerId: 8, clientX: 50, clientY: 50 });
  await held.dispatch('pointermove', { pointerType: 'touch', pointerId: 8, clientX: 70, clientY: 50 });
  assert.equal([...timers.values()].some(timer => timer.delay === 450), false, 'Moving a finger cancels removal while scrolling');
  await held.dispatch('pointerup', { pointerType: 'touch', pointerId: 8 });
  assert.deepEqual(boardCircuit(), LEVELS[0].circuit);

  // Actual cell selection and reversible rewrites drive the controller.
  const firstCell = get('circuit-board').querySelectorAll('[data-cell]')[1];
  await firstCell.click(); assert.equal(selected().length, 1);
  assert.equal(get('circuit-board').querySelectorAll('[data-cell]')[1], firstCell, 'Selection retains the focused cell');
  await firstCell.click(); assert.equal(selected().length, 0);
  firstCell.focus();
  const adjacentCell = get('circuit-board').querySelectorAll('[data-cell]')[2];
  await firstCell.click(); await adjacentCell.click(); assert.equal(selected().length, 2);
  await documentMock.dispatch('keydown', { target: firstCell, key: 'Escape' });
  assert.equal(selected().length, 0, 'Escape clears the complete rule-window selection');
  assert.equal(get('circuit-board').querySelectorAll('[data-cell]')[1], firstCell, 'Escape preserves the live circuit cells');
  assert.equal(documentMock.activeElement, firstCell, 'Escape retains keyboard focus on the circuit');
  await finish(LEVELS[0]); assert.equal(moveCount(), 1); assert.equal(get('score-form').hidden, false);
  get('player-name').value = 'Ada';
  const saving = get('score-form').dispatch('submit'), post = requests.at(-1);
  assert.deepEqual(JSON.parse(post.options.body), { game: 'circuit-reduction', level: 1, name: 'Ada', sequence: LEVELS[0].solution });
  await reply(post, boardData({ id: 1, rank: 1, name: 'Ada', moves: 1 }), 201); await saving;
  assert.equal(get('win-results').hidden, false); assert.match(get('player-rank').textContent, /Your rank: 1/);
  await click('try-again'); await boards(); assert.equal(moveCount(), 0);

  // Empty layouts remain editable after a win without inflating the score.
  await finish(LEVELS[0]); await click('close-win');
  await addSpace(0, 0, 100, true); assert.equal(boardCircuit()[0].length, 104); assert.equal(moveCount(), 1);
  await click('compact-identities'); assert.deepEqual(boardCircuit(), [['.', '.']]); assert.equal(moveCount(), 1);
  assert.equal(get('score-form').hidden, false);
  await click('restart'); await boards();

  // Re-selecting the active mode and disclosing the archive retain progress.
  await chooseLevel(3); await play(LEVELS[2].solution[0]);
  const progress = boardSignature(); await click('mode-campaign'); assert.equal(moveCount(), 1); assert.equal(boardSignature(), progress);
  const disclosure = click('daily-toggle'); await reply(pendingDaily(), metadata('2026-10-14')); await disclosure; await boards();
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true'); assert.equal(boardSignature(), progress);
  const staleLoad = click('mode-daily'), stale = pendingDaily(); assert.equal(get('undo').disabled, true);
  await click('mode-campaign'); assert.equal(stale.options.signal.aborted, true);
  await reply(stale, metadata('2026-10-14')); await staleLoad;
  assert.equal(boardSignature(), progress); assert.equal(moveCount(), 1);

  // Reset and switching modes invalidate saved-score and ranking responses.
  await chooseLevel(1); await finish(LEVELS[0]);
  const staleSave = get('score-form').dispatch('submit'), stalePost = requests.at(-1);
  await click('mode-random'); assert.equal(stalePost.options.signal.aborted, true);
  await reply(stalePost, boardData({ id: 2, rank: 1, name: 'Ada', moves: 1 }), 201); await staleSave;
  assert.equal(get('leaderboard-section').hidden, true); assert.equal(get('score-form').hidden, true); assert.equal(get('win-results').hidden, true);
  await chooseLevel(1);
  await click('restart'); const staleBoard = requests.at(-1);
  await click('mode-random'); assert.equal(staleBoard.options.signal.aborted, true);
  await reply(staleBoard, boardData({ id: 3, rank: 1, name: 'Stale', moves: 1 }));
  assert.equal(get('win-results').hidden, true, 'A previous leaderboard cannot attach a player to a random round');
  const randomSignature = boardSignature(); await click('mode-random'); assert.equal(boardSignature(), randomSignature);
  get('custom-circuit').value = '. X X .'; await get('custom-form').dispatch('submit');
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  await finish({ solution: LEVELS[0].solution }); assert.equal(get('score-form').hidden, true);
  const beforeRandomSubmit = requests.length; await get('score-form').dispatch('submit'); assert.equal(requests.length, beforeRandomSubmit, 'Random/custom wins never create a ranked score');

  // Replay reviews snapshots, permits undo, and cannot mutate a later round.
  await click('close-win');
  const traceStep = get('sequence').children[0]; traceStep.focus(); await traceStep.click();
  assert.equal(get('sequence').children[0], traceStep, 'Inspecting a step retains its live Trace button');
  assert.equal(documentMock.activeElement, traceStep, 'Keyboard focus remains on the inspected Trace step');
  assert.equal(traceStep.getAttribute('aria-current'), 'step');
  await click('resume-round'); assert.equal(traceStep.getAttribute('aria-current'), 'false');
  await addSpace(0, 0);
  assert.equal(get('sequence').children[0], traceStep, 'Appending a free layout step retains earlier Trace buttons');
  assert.equal(get('sequence').children[1].textContent, '·');
  await click('undo'); await boards();
  assert.equal(get('sequence').children.length, 1);
  assert.equal(get('sequence').children[0], traceStep, 'Undo removes only the last Trace button');
  await click('replay-result'); assert.equal(get('win-dialog').open, false); assert.equal(get('review-note').textContent, 'Step 0 / 1');
  const replayTimer = [...timers.values()].find(timer => timer.delay === 650); timers.delete(replayTimer); replayTimer.callback();
  assert.equal(get('review-note').textContent, 'Step 1 / 1');
  await click('undo'); await boards(); assert.equal(moveCount(), 0); assert.equal(get('review-controls').hidden, true);
  const invalid = new Element('BUTTON'); invalid.dataset.step = 'nope'; get('sequence').appendChild(invalid);
  await invalid.dispatch('click'); assert.equal(get('review-controls').hidden, true);
  invalid.remove();
  await finish({ solution: LEVELS[0].solution });
  const beforeExport = gifs.length;
  await click('share-result'); await settle();
  assert.equal(gifs.length, beforeExport, 'Opening sharing does not encode a replay');
  click('download-gif'); await settle(); const exportJob = gifs.at(-1);
  assert.equal(exportJob.args[0].label, 'Custom circuit'); assert.deepEqual(exportJob.args[0].circuit, [['.', 'X', 'X', '.']]);
  await click('restart'); assert.equal(exportJob.args[1].signal.aborted, true); assert.equal(get('share-dialog').open, false);
  exportJob.resolve(new Blob(['GIF89a'], { type: 'image/gif' })); await settle(); assert.equal(get('share-preview').hidden, true);

  // An interrupted advisory search leaves an honest status on return and
  // cannot publish an optimum after its worker has been terminated.
  get('custom-circuit').value = 'H Z H X'; await get('custom-form').dispatch('submit');
  const interruptedSearch = workers.at(-1), beforeSearchRestore = boardSignature();
  assert.match(get('custom-status').textContent, /Finding a shortest solution/);
  await windowMock.dispatch('pagehide');
  assert.equal(interruptedSearch.terminated, true);
  interruptedSearch.respond({ status: 'optimal', optimalMoves: 99 });
  assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);
  await windowMock.dispatch('pageshow', { persisted: true });
  await reply(pendingDaily(), metadata('2026-10-14')); await boards();
  assert.equal(boardSignature(), beforeSearchRestore);
  assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);

  // A custom worker is advisory and stale results cannot change another level.
  get('custom-circuit').value = 'H Z H X'; await get('custom-form').dispatch('submit'); const staleWorker = workers.at(-1);
  await click('mode-campaign'); staleWorker.respond({ status: 'optimal', optimalMoves: 99 }); assert.equal(staleWorker.terminated, true);
  assert.equal(get('custom-status').textContent, ''); await boards();
  globalThis.Worker = undefined; await get('custom-form').dispatch('submit'); assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);
  globalThis.Worker = WorkerMock;
  get('custom-circuit').value = '. X . .'; const validCustom = boardSignature(); await get('custom-form').dispatch('submit');
  assert.match(get('custom-status').textContent, /not the identity/); assert.equal(boardSignature(), validCustom);

  // Import budgets protect parsing, identity evaluation and DOM construction,
  // while the paper game's interactive horizontal layout remains unlimited.
  const pasteLimit = Number(get('custom-circuit').getAttribute('maxlength'));
  assert.equal(pasteLimit, 16_384);
  const beforeLargePaste = boardSignature(), beforeLargePasteMoves = moveCount(), beforeLargePasteWorkers = workers.length;
  get('custom-circuit').value = '!'.repeat(pasteLimit + 1);
  await get('custom-form').dispatch('submit');
  assert.match(get('custom-status').textContent, /up to 16,384 characters/);
  assert.equal(boardSignature(), beforeLargePaste, 'An excessive import preserves the current circuit');
  assert.equal(moveCount(), beforeLargePasteMoves);
  assert.equal(workers.length, beforeLargePasteWorkers, 'Excessive imports never start searches');
  get('custom-circuit').value = 'H H'.padEnd(pasteLimit, ' ');
  await get('custom-form').dispatch('submit');
  assert.deepEqual(workers.at(-1).message.circuit, [['H', 'H']], 'Imports at the advertised boundary remain valid');
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  assert.match(get('custom-status').textContent, /Shortest solution: 1 moves/);
  for (const result of [null, undefined, [], {}, 'bad', { status: 'optimal' },
    ...[0, -1, .5, NaN, Infinity, '1'].map(optimalMoves => ({ status: 'optimal', optimalMoves }))]) {
    get('custom-circuit').value = 'H H'; await get('custom-form').dispatch('submit');
    const worker = workers.at(-1);
    assert.doesNotThrow(() => worker.respond(result));
    assert.equal(worker.terminated, true, 'Malformed terminal replies release their search worker');
    assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  }
  await get('custom-form').dispatch('submit');
  const unreadableMessage = workers.at(-1);
  unreadableMessage.onmessageerror();
  assert.equal(unreadableMessage.terminated, true);
  assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  failPosting = true;
  await get('custom-form').dispatch('submit');
  assert.equal(workers.at(-1).terminated, true, 'A synchronous posting failure releases its worker');
  assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  failPosting = false;
  await get('custom-form').dispatch('submit');
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  assert.match(get('custom-status').textContent, /Shortest solution: 1 moves/, 'A search failure does not prevent the next import');

  // Restoring a saved round keeps its result, closes cancelled export UI and
  // fetches the same player's leaderboard instead of treating it as a new try.
  await chooseLevel(1); await finish(LEVELS[0]);
  const savedPlayer = { id: 4, rank: 1, name: 'Ada', moves: 1 };
  const savedSubmission = get('score-form').dispatch('submit');
  await reply(requests.at(-1), boardData(savedPlayer), 201); await savedSubmission;
  const savedBoard = boardSignature(), savedMoves = moveCount();
  await click('share-result'); click('download-gif'); await settle(); const restoredExport = gifs.at(-1);
  await windowMock.dispatch('pagehide');
  assert.equal(restoredExport.args[1].signal.aborted, true);
  assert.equal(get('share-dialog').open, false, 'Navigation closes the disposed sharing dialog');
  await windowMock.dispatch('pageshow', { persisted: true });
  const restoredRanking = requests.at(-1);
  assert.equal(new URL(restoredRanking.url, 'https://example.test').searchParams.get('player'), String(savedPlayer.id));
  await reply(restoredRanking, boardData(savedPlayer));
  await reply(pendingDaily(), metadata('2026-10-14')); await boards();
  restoredExport.resolve(new Blob(['GIF89a'], { type: 'image/gif' })); await settle();
  assert.equal(boardSignature(), savedBoard); assert.equal(moveCount(), savedMoves);
  assert.equal(get('win-dialog').open, true); assert.equal(get('score-form').hidden, true);
  assert.equal(get('win-results').hidden, false, 'A BFCache return preserves the saved score');

  // Every PDF lesson is playable using only its unlocked rules and public layout controls.
  for (const lesson of LEVELS) {
    await chooseLevel(lesson.id);
    for (const button of rules) assert.equal(button.hidden, !lesson.allowedRules.includes(button.dataset.rule), `Rule availability in lesson ${lesson.id}`);
    await finish(lesson);
    assert.equal(moveCount(), sequenceCost(lesson.solution), `Witness score in lesson ${lesson.id}`);
  }

  // Server time is authoritative, and reopening today's puzzle preserves play.
  const today = '2026-10-14', beforeMidnight = dailyBounds(today).closesAt - 1000;
  await loadDaily(today, beforeMidnight, true); const puzzle = dailyPuzzle(today);
  assert.equal(get('advanced-features').hidden, false, 'Daily mode keeps Advanced available for Trace');
  assert.equal(get('toggle-trace').closest('.advanced-features'), get('advanced-features'));
  await click('toggle-trace'); assert.equal(get('sequence').hidden, true);
  await click('toggle-trace'); assert.equal(get('sequence').hidden, false);
  Date.now = () => Date.parse('2036-01-01T12:00:00Z');
  assert.equal(get('replay').closest('.advanced-features'), get('advanced-features'), 'Daily replay remains in main Advanced');
  assert.equal(get('replay-result').closest('.advanced-features'), get('result-advanced-features'), 'Daily result replay remains in result Advanced');
  assert.equal(get('result-advanced-features').hidden, false);
  assert.equal(get('share-score').parentElement, get('daily-replay-actions'));
  assert.equal(get('share-result').parentElement, get('daily-result-actions'));
  assert.equal(get('daily-replay-actions').hidden, true, 'An unwon daily has no empty share-action block');
  assert.equal(get('daily-result-actions').hidden, true);
  await play(puzzle.solution[0]); const dailyProgress = boardSignature();
  await get('sequence').querySelectorAll('[data-step]')[0].click();
  assert.equal(get('review-controls').hidden, false, 'A daily Trace step opens replay inspection');
  await click('resume-round'); assert.equal(get('review-controls').hidden, true);
  assert.equal(boardSignature(), dailyProgress, 'Leaving daily Trace inspection preserves the round');
  await loadDaily(today, beforeMidnight, true); assert.equal(moveCount(), 1); assert.equal(boardSignature(), dailyProgress);
  for (const move of puzzle.solution.slice(1)) await play(move);
  assert.equal(get('daily-replay-actions').hidden, false);
  assert.equal(get('daily-result-actions').hidden, false);
  assert.equal(get('share-score').closest('.advanced-features'), null, 'Daily sharing stays outside Advanced');
  assert.equal(get('share-result').closest('.advanced-features'), null);
  assert.equal(get('score-form').hidden, false); const winningBoard = boardSignature();
  const rollover = [...timers.values()].find(timer => timer.delay === 1020); assert.ok(rollover);
  monotonic += 1020; timers.delete(rollover); const refreshing = rollover.callback();
  assert.match(get('daily-note').textContent, /Practice.*closed/);
  await reply(pendingDaily(), metadata(today, beforeMidnight + 1020)); await refreshing; await boards();
  assert.equal(moveCount(), puzzle.optimalMoves); assert.equal(boardSignature(), winningBoard); assert.equal(get('score-form').hidden, true);
  assert.equal(get('daily-date').children[0].value, '2026-10-15'); assert.equal(get('daily-date').value, today);
  const beforePastSubmit = requests.length; await get('score-form').dispatch('submit'); assert.equal(requests.length, beforePastSubmit);
  await click('try-again'); await boards(); assert.equal(moveCount(), 0);
  Date.now = () => Date.parse('2026-10-14T12:00:00Z');

  // An API rejection at midnight turns an already-won round into practice.
  await loadDaily('2026-10-15', dailyBounds('2026-10-15').opensAt + 100, true);
  const next = dailyPuzzle('2026-10-15'); await finish(next);
  const expiring = get('score-form').dispatch('submit'), expired = requests.at(-1);
  await reply(expired, { error: 'This puzzle’s leaderboard is closed.' }, 409); await expiring;
  assert.equal(get('score-form').hidden, true); assert.equal(get('win-practice').hidden, false);
  await reply(pendingDaily(), metadata('2026-10-15', dailyBounds('2026-10-15').closesAt + 10)); await boards();
  assert.equal(moveCount(), next.optimalMoves); assert.equal(get('win-dialog').open, true);

  // Offline puzzles are playable but never authorize submission.
  const offline = click('mode-daily'); await reply(pendingDaily(), {}, 503); await offline; await boards();
  assert.match(get('daily-status').textContent, /Offline practice/); assert.equal(get('score-form').hidden, true);
  assert.ok([...timers.values()].some(timer => timer.delay === 60_000), 'Offline practice retries online scoring metadata');
  const requestCount = requests.length; documentMock.hidden = true; await documentMock.dispatch('visibilitychange'); assert.equal(requests.length, requestCount);
  documentMock.hidden = false; const resumed = documentMock.dispatch('visibilitychange'); await reply(pendingDaily(), metadata(today)); await resumed; await boards();
  assert.equal(get('daily-status').textContent, '');
  await click('mode-campaign'); await boards();
  assert.equal(get('share-score').parentElement, get('replay-actions'), 'Leaving daily restores main Share to Advanced');
  assert.equal(get('share-result').parentElement, get('result-replay-actions'), 'Leaving daily restores result Share to Advanced');
  assert.equal(get('daily-replay-actions').hidden, true);
  assert.equal(get('daily-result-actions').hidden, true);
  await windowMock.dispatch('pagehide'); assert.equal(timers.size, 0, 'Leaving the page cancels refresh/replay/request timers');
  // Generated witnesses are valid independent of the UI and play helper.
  assert.ok(isSolved(puzzle.solution.reduce(applyMove, cloneCircuit(puzzle.circuit))));
});
