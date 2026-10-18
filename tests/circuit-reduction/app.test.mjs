import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RULES, applyMove, cloneCircuit, compactCircuit, isSolved, moveCost, sequenceCost } from '../../src/lib/circuit-reduction/engine.js';
import { LEVELS, dailyPuzzle } from '../../tools/circuit-reduction/witnesses.js';
import { layoutMoves } from '../../tools/circuit-reduction/layout-moves.js';
import { DAILY_START } from '../../src/lib/circuit-reduction/puzzles.js';
import { dailyBounds, dailyDate } from '../../src/lib/games/daily-calendar.js';
import { expandGameControls } from '../games/markup.mjs';
import { replayWorkers } from '../games/replay-worker-fixture.mjs';
import { TUTORIAL_CIRCUIT, TUTORIAL_STEPS } from '../../src/lib/circuit-reduction/tutorial.js';

const root = new URL('../../', import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));

async function gameMarkup() {
  let html = await readFile(new URL('src/pages/games/circuit-reduction.astro', root), 'utf8');
  const component = async name => (await readFile(new URL(`src/components/games/${name}.astro`, root), 'utf8')).replace(/^---[\s\S]*?---/, '');
  for (const name of ['GameModeMenu', 'GameToolbar', 'GameLeaderboard', 'GameJsonActions']) html = html.replace(new RegExp(`<${name}\\b[^>]*\\/>`), await component(name));
  html = await expandGameControls(html, component);
  const dialogs = html.match(/<GameDialogs\b[^>]*>([\s\S]*?)<\/GameDialogs>/);
  assert.ok(dialogs, 'The circuit game uses the same overlays as Golf');
  html = html.replace(dialogs[0], (await component('GameDialogs'))
    .replace('<GamePuzzleJsonDialog />', await component('GamePuzzleJsonDialog'))
    .replace('<slot name="rules" />', dialogs[1].match(/<Fragment slot="rules">([\s\S]*?)<\/Fragment>/)?.[1] ?? '')
    .replace('<slot name="result-actions" />', ''));
  html = await expandGameControls(html, component);
  html = html.replace(/\{RULES\.map\(rule => <button[^\n]+/g,
    RULES.map(rule => `<button type="button" data-rule="${rule.id}" aria-label="${rule.title}" disabled>${rule.title}</button>`).join(''));
  return html.replace(/^---[\s\S]*?---/, '').replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/g, '');
}

test('circuit controller preserves rounds, validates scoring, cancels stale work and follows Paris midnight', async context => {
  class Element {
    constructor(tag = 'DIV') {
      this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = new Map();
      this.style = { setProperty() {} }; this.hidden = this.disabled = this.open = false; this.value = ''; this._text = '';
      this.offsetWidth = 100; this.cssZoom = 1;
    }
    addEventListener(name, callback, options) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), { callback, capture: options === true || Boolean(options?.capture) }]); }
    async dispatch(name, extra = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
      const path = [this]; if (['click', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'lostpointercapture'].includes(name)) for (let parent = this.parentElement; parent; parent = parent.parentElement) path.push(parent);
      const promises = [];
      for (const capture of [true, false]) {
        for (const node of capture ? [...path].reverse() : path) {
          event.currentTarget = node;
          for (const listener of node.listeners.get(name) ?? []) {
            if (listener.capture === capture) promises.push(listener.callback(event));
            if (event.stopped) break;
          }
          if (event.stopped) break;
        }
        if (event.stopped) break;
      }
      await Promise.all(promises);
      return event;
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
      if (/^[a-z]+$/i.test(selector)) return this.tagName === selector.toUpperCase();
      if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.open;
      if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
      if (selector.startsWith('.')) return (this.className ?? '').split(/\s+/).includes(selector.slice(1));
      const match = selector.match(/^(button)?\[data-([\w-]+)(?:="([^"]*)")?\]$/);
      const key = match?.[2].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Boolean(match && (!match[1] || this.tagName === 'BUTTON') && Object.hasOwn(this.dataset, key) && (match[3] === undefined || this.dataset[key] === match[3]));
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
    prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
    remove() { const siblings = this.parentElement?.children; if (siblings) siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; for (const child of children) this.appendChild(child); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
    focus() { document.activeElement = this; }
    select() { this.selected = true; }
    setPointerCapture(id) { (this.capturedPointers ??= new Set()).add(id); }
    releasePointerCapture(id) { this.capturedPointers?.delete(id); }
    hasPointerCapture(id) { return this.capturedPointers?.has(id) ?? false; }
    reportValidity() { return true; }
    getBoundingClientRect() {
      const width = this.offsetWidth * this.cssZoom, height = 100 * this.cssZoom;
      return { left: 0, right: width, top: 0, bottom: height, width, height };
    }
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
  get('editor-wires').value = '2';
  const globals = ['document', 'window', 'navigator', 'fetch', 'performance', 'Worker', 'setTimeout', 'clearTimeout', 'localStorage'];
  const descriptors = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  context.after(() => { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const originalDateNow = Date.now;
  Date.now = () => Date.parse('2026-10-17T12:00:00Z');
  context.after(() => { Date.now = originalDateNow; });
  const { ReplayWorker, gifs } = replayWorkers();
  const windowMock = new Element('WINDOW'), requests = [], workers = [], timers = new Map();
  windowMock.location = { search: '' };
  let monotonic = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => monotonic } });
  const nicknames = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => nicknames.get(key) ?? null,
    setItem: (key, value) => nicknames.set(key, String(value)),
    removeItem: key => nicknames.delete(key),
  } });
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url: String(url), options, resolve, reject }));
  globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay }; timers.set(timer, timer); return timer; };
  globalThis.clearTimeout = timer => timers.delete(timer);
  let failPosting = false;
  const WorkerMock = class extends ReplayWorker {
    constructor(url, options) {
      super(url, options);
      this.exporting = url.pathname.endsWith('/circuit-reduction-gif-worker.js');
      if (!this.exporting) workers.push(this);
    }
    postMessage(message) {
      if (failPosting) throw new Error('Message could not be posted');
      if (this.exporting) super.postMessage(message); else this.message = message;
    }
    respond(data) { this.onmessage?.({ data }); }
  };
  globalThis.Worker = WorkerMock;
  const scriptURL = new URL('src/scripts/circuit-reduction.js', root);
  const original = await readFile(scriptURL, 'utf8');
  const instrumented = original
    .replace(/from (['"])(\.\.\/lib\/[^'"]+)\1/g, (_, _quote, path) => `from '${new URL(path, scriptURL).href}'`)
    .replace(/new URL\(['"](\.\/circuit-reduction(?:-gif)?-worker\.js)['"], import\.meta\.url\)/g, (_, path) => `new URL('${new URL(path, scriptURL).href}')`);
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
  const cellAt = (row, column) => {
    const cell = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.cell === `${row}:${column}`);
    assert.ok(cell, `Circuit cell ${row}:${column} exists`); return cell;
  };
  const selectedKeys = () => selected().map(cell => cell.dataset.cell);
  const pointAt = (row, column) => ({ clientX: 22 + column * 64 + 32, clientY: row * 72 + 36 });
  const mouse = (row, column, extra = {}) => ({ pointerType: 'mouse', pointerId: 11, button: 0, buttons: 1, isPrimary: true, ...pointAt(row, column), ...extra });
  const requestPath = request => new URL(request.url, 'https://example.test').pathname;
  const pendingDaily = () => requests.findLast(request => requestPath(request) === '/api/daily' && !request.replied);
  const boardData = (currentPlayer = null) => ({ entries: currentPlayer ? [currentPlayer] : [], currentPlayer, total: currentPlayer ? 1 : 0 });
  async function reply(request, data, status = 200) { assert.ok(request); request.replied = true; request.resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); await settle(); }
  async function boards() { for (const request of requests.filter(request => requestPath(request) === '/api/leaderboard' && request.options.method !== 'POST' && !request.replied)) await reply(request, boardData()); }
  async function chooseLevel(id) { get('level').value = id; await get('level').dispatch('change'); await boards(); }
  async function inputJson(value) {
    await click('input-json');
    get('puzzle-json-text').value = typeof value === 'string' ? value : JSON.stringify(value);
    await get('puzzle-json-form').dispatch('submit');
  }
  const importCircuit = circuit => inputJson({ circuit });
  async function addSpace(row, column, count = 1) {
    for (let index = 0; index < count; index++) {
      const gap = get('circuit-board').querySelectorAll('[data-space]').find(node => node.dataset.space === `${row}:${column}`);
      assert.ok(gap, 'Identity space is added directly at a wire boundary');
      await gap.click();
    }
  }
  async function removeSpace(row, column) {
    const cell = get('circuit-board').querySelectorAll('[data-cell]').find(node => node.dataset.cell === `${row}:${column}`);
    assert.ok(cell, 'An identity slot is visible on its wire');
    await cell.dispatch('contextmenu');
  }
  async function play(move) {
    if (move.rule === 'arrange' || move.rule === 'insert-space') {
      const target = move.rule === 'arrange' ? move.circuit : applyMove(boardCircuit(), move);
      // Reproduce solver layouts and older local-spacing witnesses through the
      // current public controls: whole-column additions and identity removals.
      for (const spacing of layoutMoves(boardCircuit(), target)) await play(spacing);
      assert.deepEqual(boardCircuit(), target, 'Players can recreate the free witness arrangement');
    } else if (move.rule === 'compact-identities') {
      await click('compact-identities');
    } else if (move.rule === 'remove-space') {
      await removeSpace(move.row, move.column);
    } else if (move.rule.endsWith('-column')) {
      if (move.rule === 'insert-column') await addSpace(0, move.column, move.count ?? 1);
      else await removeSpace(0, move.column);
    } else {
      const rule = RULES.find(rule => rule.id === move.rule);
      for (let y = 0; y < rule.left.length; y++) for (let x = 0; x < rule.left[0].length; x++) {
        const cell = get('circuit-board').querySelectorAll('[data-cell]').find(button => button.dataset.cell === `${move.row + y}:${move.column + x}`);
        assert.ok(cell, 'The rule window is on the visible board');
        if (cell.getAttribute('aria-pressed') !== 'true') await cell.click();
      }
      const button = rules.find(button => button.dataset.rule === move.rule);
      assert.equal(button.disabled, false, `Selected window enables ${move.rule}`); await button.click();
    }
  }
  async function finish(puzzle) { for (const move of puzzle.solution) await play(move); assert.ok(isSolved(boardCircuit())); assert.equal(get('win-dialog').open, true); }
  function metadata(date, serverNow = Date.parse('2026-10-17T12:00:00Z')) {
    const today = dailyDate(serverNow), bounds = dailyBounds(date);
    return { today, date, startDate: DAILY_START, serverNow, ...bounds, nextChangeAt: dailyBounds(today).closesAt,
      acceptingScores: date === today && serverNow >= bounds.opensAt && serverNow < bounds.closesAt, puzzle: dailyPuzzle(date) };
  }
  async function loadDaily(date, serverNow, today = false) {
    get('daily-date').value = date;
    const loading = today ? click('mode-daily') : get('daily-date').dispatch('change');
    await reply(pendingDaily(), metadata(date, serverNow)); await loading; await boards();
  }

  assert.equal(get('mode-tutorial').getAttribute('aria-pressed'), 'true', 'The game opens with the guided example');
  assert.deepEqual(boardCircuit(), TUTORIAL_CIRCUIT);
  assert.equal(get('tutorial-panel').hidden, false);
  assert.equal(get('leaderboard-section').hidden, true);
  assert.equal(requests.length, 0, 'Tutorials do not load rankings or daily puzzles');
  assert.equal(workers.length, 0, 'The worked example needs no runtime solver');
  await cellAt(0, 0).dispatch('click');
  await documentMock.dispatch('keydown', { key: 'r', target: cellAt(0, 0) });
  assert.equal(selected().length, 0, 'Tutorial rejects manual circuit edits and shortcuts');
  await click('tutorial-start');
  let tutorialMoves = 0;
  for (const [index, step] of TUTORIAL_STEPS.entries()) {
    const target = step.target ? documentMock.querySelector(step.target) : rules.find(button => button.dataset.rule === step.move.rule);
    assert.ok(target, 'The tutorial highlights an actual game control');
    assert.equal(target.disabled, false);
    assert.equal(target.getAttribute('data-tutorial-focus'), '', 'Only the current action is highlighted');
    assert.equal(moveCount(), tutorialMoves);
    assert.equal(Boolean(selected().length), !step.target, 'Only rewrite steps select a gate window');
    const before = boardCircuit();
    if (step.target || index % 2 === 0) await target.click(); else await click('tutorial-next');
    await settle();
    tutorialMoves += moveCost(step.move);
    assert.equal(moveCount(), tutorialMoves, 'Only rewrites count as moves');
    if (step.target) {
      assert.deepEqual(compactCircuit(boardCircuit()), compactCircuit(before), 'Spacing keeps every gate and its wire order');
      assert.equal(boardCircuit()[0].length, step.move.rule === 'insert-column' ? before[0].length + 1 : 2,
        'The inserted space or Tidy result remains visible for the next step');
    }
    assert.equal(get('win-dialog').open, false, 'Tutorial completion never opens scoring');
  }
  assert.equal(tutorialMoves, 11, 'Cancellations and the uncontrolled basis change precede the seven-rewrite example');
  assert.ok(isSolved(boardCircuit()));
  assert.equal(get('tutorial-heading').textContent, 'Tutorial complete');
  assert.equal(get('tutorial-levels').hidden, false);
  assert.equal(requests.length, 0);
  await click('tutorial-start');
  assert.equal(moveCount(), 0, 'Restart returns to the prepared first step');
  await click('mode-campaign'); await boards();
  await chooseLevel(4);
  const rememberedCampaign = boardSignature();
  await click('mode-tutorial'); await click('mode-campaign'); await boards();
  assert.equal(boardSignature(), rememberedCampaign, 'Tutorial leaves the selected campaign lesson intact');
  await chooseLevel(1);
  assert.equal(get('tutorial-panel').hidden, true);
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
  await reply(interruptedDaily, metadata('2026-10-17')); await interruptedDailyLoad; await boards();
  assert.equal(boardSignature(), beforeRestoreBoard, 'A cancelled Daily response preserves the restored board');
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');

  for (const id of ['advanced-features', 'toggle-trace', 'sequence']) assert.equal(elements.has(id), false, 'The main game has no Advanced disclosure or Trace interface');
  assert.equal(get('review-controls').closest('.advanced-features'), null, 'Replay navigation is directly reachable');
  assert.equal(get('replay').closest('.advanced-features'), null);
  assert.equal(get('replay-actions').hidden, true, 'An untouched round has no empty replay row');
  assert.equal(get('replay-result').closest('.advanced-features'), get('result-advanced-features'));
  assert.equal(get('share-score').parentElement, get('replay-actions'));
  assert.equal(get('share-result').parentElement, get('result-replay-actions'));
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
  await addSpace(0, 0, 100); assert.equal(boardCircuit()[0].length, 154); assert.equal(moveCount(), 0);
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

  // Every + inserts a whole column, regardless of its wire or the Shift key.
  const keyboardLesson = LEVELS.find(lesson => lesson.circuit.length > 1);
  await chooseLevel(keyboardLesson.id);
  const beforeColumn = boardCircuit();
  const withColumn = applyMove(beforeColumn, { rule: 'insert-column', row: 0, column: 1 });
  await addSpace(1, 1);
  assert.deepEqual(boardCircuit(), withColumn, 'A normal + click on a lower wire inserts the same column on every wire');
  assert.equal(moveCount(), 0, 'Inserting a whole column costs no rewrites');
  await click('undo'); await boards();
  assert.deepEqual(boardCircuit(), beforeColumn, 'Undo restores every wire before the spacing edit');
  const lowerGap = get('circuit-board').querySelectorAll('[data-space]').find(node => node.dataset.space === '1:1');
  await lowerGap.dispatch('click', { shiftKey: true });
  assert.deepEqual(boardCircuit(), withColumn, 'Holding Shift no longer changes a + click');
  assert.equal(moveCount(), 0);
  await click('undo'); await boards();
  assert.deepEqual(boardCircuit(), beforeColumn);
  // Delete keeps focus on the same wire as the board shrinks, so consecutive
  // key presses can remove trailing identities without finding the cell again.
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

  // Mouse and pen drags replace a selection with the complete rectangle,
  // including reverse drags and every wire between the endpoints.
  const dragLesson = LEVELS.find(lesson => lesson.circuit.length > 1 && lesson.circuit[0].length > 3);
  await chooseLevel(dragLesson.id);
  const rectangle = ['0:0', '0:1', '0:2', '1:0', '1:1', '1:2'];
  const dragBoard = boardSignature(), dragOrigin = cellAt(0, 0);
  await cellAt(0, 3).click();
  await dragOrigin.dispatch('pointerdown', mouse(0, 0));
  assert.equal(dragOrigin.hasPointerCapture(11), false, 'A press does not capture before it becomes a drag');
  await get('circuit-board').dispatch('pointermove', mouse(1, 2, { pointerId: 12 }));
  assert.deepEqual(selectedKeys(), ['0:3'], 'An unrelated pointer cannot start the drag');
  await get('circuit-board').dispatch('pointermove', mouse(1, 2));
  assert.deepEqual(selectedKeys(), rectangle);
  assert.equal(dragOrigin.hasPointerCapture(11), true, 'A drag captures its original cell');
  await documentMock.dispatch('pointerup', mouse(1, 2, { buttons: 0 }));
  await dragOrigin.dispatch('click', { detail: 1, pointerId: 11 });
  assert.deepEqual(selectedKeys(), rectangle, 'Releasing a drag does not toggle its starting cell');
  assert.equal(boardSignature(), dragBoard, 'Dragging across insertion handles leaves circuit spacing intact');
  assert.equal(moveCount(), 0, 'Selecting cells is free');
  const reverseOrigin = cellAt(1, 2);
  await reverseOrigin.dispatch('pointerdown', mouse(1, 2, { pointerType: 'pen' }));
  await get('circuit-board').dispatch('pointermove', mouse(0, 0, { pointerType: 'pen' }));
  await documentMock.dispatch('pointerup', mouse(0, 0, { pointerType: 'pen', buttons: 0 }));
  await reverseOrigin.dispatch('click', { detail: 1, pointerId: 11 });
  assert.deepEqual(selectedKeys(), rectangle, 'Reverse pen drags use the same rectangle');

  const zoomedBoard = get('circuit-board');
  zoomedBoard.cssZoom = 1.25;
  const zoomedMouse = (row, column, extra = {}) => {
    const point = pointAt(row, column);
    return mouse(row, column, { clientX: point.clientX * 1.25, clientY: point.clientY * 1.25, ...extra });
  };
  await documentMock.dispatch('keydown', { key: 'Escape' });
  await dragOrigin.dispatch('pointerdown', zoomedMouse(0, 0));
  await zoomedBoard.dispatch('pointermove', zoomedMouse(1, 2));
  await documentMock.dispatch('pointerup', zoomedMouse(1, 2, { buttons: 0 }));
  await dragOrigin.dispatch('click', { detail: 1, pointerId: 11 });
  assert.deepEqual(selectedKeys(), rectangle, 'Enlarging the circuit preserves the selected rows and columns');
  assert.equal(boardSignature(), dragBoard, 'Dragging on the enlarged board never inserts space');
  zoomedBoard.cssZoom = 1;

  // Small hand movements retain ordinary toggles. Shift extends from the
  // previous clicked cell, and Escape resets that anchor as well as the paint.
  await documentMock.dispatch('keydown', { key: 'Escape' });
  await dragOrigin.dispatch('pointerdown', mouse(0, 0));
  await get('circuit-board').dispatch('pointermove', mouse(0, 0, { clientX: pointAt(0, 0).clientX + 3 }));
  await documentMock.dispatch('pointerup', mouse(0, 0, { buttons: 0 }));
  await dragOrigin.click(); assert.deepEqual(selectedKeys(), ['0:0', '1:0']);
  await cellAt(1, 2).dispatch('click', { shiftKey: true }); assert.deepEqual(selectedKeys(), rectangle);
  await documentMock.dispatch('keydown', { key: 'Escape' });
  await cellAt(1, 2).dispatch('click', { shiftKey: true });
  assert.deepEqual(selectedKeys(), ['0:2', '1:2'], 'Escape clears the old anchor and the next tap selects only its linked gate');
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
    await dragOrigin.dispatch('pointerdown', mouse(0, 0));
    await get('circuit-board').dispatch('pointermove', mouse(1, 2));
    if (ending === 'blur') await windowMock.dispatch(ending);
    else await (ending === 'lostpointercapture' ? dragOrigin : documentMock).dispatch(ending, mouse(1, 2));
    const endedSelection = selectedKeys();
    await get('circuit-board').dispatch('pointermove', mouse(1, 0));
    assert.deepEqual(selectedKeys(), endedSelection, `${ending} ends a drag even outside the board`);
  }
  await dragOrigin.dispatch('pointerdown', mouse(0, 0));
  await click('restart'); await boards();
  await get('circuit-board').dispatch('pointermove', mouse(1, 2));
  assert.deepEqual(selectedKeys(), [], 'A reset cannot leave a pending drag attached to an old board');
  await cellAt(0, 0).dispatch('pointerdown', mouse(0, 0, { button: 2, buttons: 2 }));
  await get('circuit-board').dispatch('pointermove', mouse(1, 2, { buttons: 2 }));
  assert.deepEqual(selectedKeys(), [], 'Right-clicking does not start selection');

  // Enter applies a unique match from the circuit, while other controls keep
  // their native Enter handling. Ambiguous matches never choose for the user.
  await chooseLevel(1);
  await cellAt(0, 1).click(); await cellAt(0, 2).click();
  const enterElsewhere = await documentMock.dispatch('keydown', { target: get('show-rules'), key: 'Enter' });
  assert.equal(enterElsewhere.defaultPrevented, false); assert.equal(moveCount(), 0);
  await documentMock.dispatch('keydown', { target: cellAt(0, 1), key: 'Enter' });
  assert.equal(moveCount(), 1); assert.equal(get('win-dialog').open, true);
  await click('close-win');
  await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'z', ctrlKey: true }); await boards();
  assert.equal(moveCount(), 0, 'Ctrl+Z undoes the rewrite');
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const beforeShortcut = boardSignature(); await addSpace(0, 0);
    await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'z', [modifier]: true }); await boards();
    assert.equal(boardSignature(), beforeShortcut, `${modifier} + Z undoes spacing too`);
  }
  await addSpace(0, 0); const guardedUndoBoard = boardSignature();
  for (const extra of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { defaultPrevented: true }, { target: get('puzzle-json-text') }]) {
    const ignored = await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'z', ctrlKey: true, ...extra });
    assert.equal(boardSignature(), guardedUndoBoard, 'Native or modified shortcuts do not undo the circuit');
    if (!extra.defaultPrevented) assert.equal(ignored.defaultPrevented, false);
  }
  get('rules-dialog').showModal();
  await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'z', metaKey: true });
  assert.equal(boardSignature(), guardedUndoBoard, 'A dialog owns its keyboard shortcuts');
  get('rules-dialog').close();
  await chooseLevel(2); await addSpace(0, 0, 2);
  await cellAt(0, 0).click(); await cellAt(0, 1).click();
  assert.ok(rules.filter(rule => !rule.hidden && !rule.disabled).length > 1);
  const ambiguous = boardSignature();
  await documentMock.dispatch('keydown', { target: cellAt(0, 0), key: 'Enter' });
  assert.equal(boardSignature(), ambiguous, 'Enter does not resolve competing rules arbitrarily');
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
  assert.equal(nicknames.get('games.nickname.v1'), 'Ada');
  await click('try-again'); await boards(); assert.equal(moveCount(), 0);

  // Empty layouts remain editable after a win without inflating the score.
  await finish(LEVELS[0]);
  const automaticPost = requests.at(-1);
  assert.deepEqual(JSON.parse(automaticPost.options.body), { game: 'circuit-reduction', level: 1, name: 'Ada', sequence: LEVELS[0].solution });
  assert.equal(get('score-form').hidden, true, 'A remembered nickname skips repeated registration.');
  assert.equal(get('next-level').disabled, true);
  await reply(automaticPost, {}, 503);
  assert.equal(get('score-form').hidden, false, 'A failed automatic save permits manual retry.');
  await click('close-win');
  await addSpace(0, 0, 100); assert.equal(boardCircuit()[0].length, 104); assert.equal(moveCount(), 1);
  await click('compact-identities'); assert.deepEqual(boardCircuit(), [['.', '.']]); assert.equal(moveCount(), 1);
  assert.equal(get('score-form').hidden, false);
  await click('restart'); await boards();

  // Re-selecting the active mode and disclosing the archive retain progress.
  await chooseLevel(3); await play(LEVELS[2].solution[0]);
  const progress = boardSignature(); await click('mode-campaign'); assert.equal(moveCount(), 1); assert.equal(boardSignature(), progress);
  const disclosure = click('daily-toggle'); await reply(pendingDaily(), metadata('2026-10-17')); await disclosure; await boards();
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true'); assert.equal(boardSignature(), progress);
  const staleLoad = click('mode-daily'), stale = pendingDaily(); assert.equal(get('undo').disabled, true);
  await cellAt(0, 0).dispatch('pointerdown', mouse(0, 0));
  await get('circuit-board').dispatch('pointermove', mouse(0, 1));
  await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'z', ctrlKey: true });
  assert.deepEqual(selectedKeys(), [], 'Daily loading locks drag selection');
  assert.equal(moveCount(), 1, 'Daily loading also locks keyboard undo');
  await click('mode-campaign'); assert.equal(stale.options.signal.aborted, true);
  await reply(stale, metadata('2026-10-17')); await staleLoad;
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
  assert.equal(get('custom-json-actions').hidden, false);

  // Either endpoint represents the same whole gate, including reversed CNOTs.
  for (const [upper, lower] of [['ZU', 'XD'], ['XU', 'ZD'], ['ZU', 'ZD']]) {
    const original = [[upper, upper], [lower, lower]];
    await importCircuit(original);
    for (const [first, second] of [[0, 1], [1, 0]]) {
      const endpoint = cellAt(first, 0); endpoint.focus();
      await endpoint.dispatch('click', { ctrlKey: true });
      assert.deepEqual(selectedKeys(), ['0:0', '1:0'], `${upper}/${lower}: either endpoint selects the whole gate`);
      assert.equal(documentMock.activeElement, endpoint, 'Selecting a whole gate retains its focused endpoint');
      await cellAt(second, 0).click();
      assert.deepEqual(selectedKeys(), [], 'The other endpoint deselects the whole gate');
    }
    await cellAt(0, 0).click();
    await cellAt(0, 1).dispatch('click', { shiftKey: true });
    assert.deepEqual(selectedKeys(), ['0:0', '0:1', '1:0', '1:1'], 'Shift expands both linked gates outside the selected row');
    await documentMock.dispatch('keydown', { key: 'Escape' });
    const origin = cellAt(1, 0);
    await origin.dispatch('pointerdown', mouse(1, 0));
    await get('circuit-board').dispatch('pointermove', mouse(1, 1));
    await documentMock.dispatch('pointerup', mouse(1, 1, { buttons: 0 }));
    await origin.dispatch('click', { detail: 1, pointerId: 11 });
    assert.deepEqual(selectedKeys(), ['0:0', '0:1', '1:0', '1:1'], 'Dragging a single row includes the linked endpoints');
    await cellAt(0, 0).dispatch('contextmenu');
    assert.deepEqual(boardCircuit(), original, 'A linked gate context menu preserves the circuit');
    assert.deepEqual(selectedKeys(), ['0:0', '0:1', '1:0', '1:1']);
    assert.equal(moveCount(), 0, 'Whole-gate selection remains free');
  }

  // One-wire basis and phase rules still match with their linked partner selected.
  for (const [rule, row, block] of [
    ['basis-up', 0, [['H', 'ZU', 'H'], ['.', 'ZD', '.']]],
    ['basis-down', 1, [['.', 'ZU', '.'], ['H', 'ZD', 'H']]],
    ['phase-up', 0, [['Z', 'ZU', '.'], ['.', 'ZD', '.']]],
    ['phase-down', 1, [['.', 'ZU', '.'], ['Z', 'ZD', '.']]],
  ]) {
    const original = block.map(line => [...line, ...line]);
    await importCircuit(original);
    await cellAt(row, 0).click();
    await cellAt(row, 2).dispatch('click', { shiftKey: true });
    assert.equal(selected().length, 4, `${rule}: the other wire contributes only its linked endpoint`);
    const button = rules.find(button => button.dataset.rule === rule);
    assert.equal(button.disabled, false, `${rule}: the complete gate does not enlarge the rule window`);
    const unrelated = cellAt(1 - row, 0);
    await unrelated.click(); assert.equal(button.disabled, true, 'An explicitly selected unrelated cell still prevents the rewrite');
    await unrelated.click(); assert.equal(button.disabled, false);
    await button.click();
    assert.deepEqual(boardCircuit(), applyMove(original, { rule, row, column: 0 }));
    assert.equal(moveCount(), 1);
  }

  // Identity construction reuses the ordinary reversible rule palette.
  await click('create-circuit');
  assert.equal(get('circuit-editor-controls').hidden, false);
  assert.deepEqual(boardCircuit(), Array.from({ length: 2 }, () => Array(6).fill('.')));
  assert.equal(get('save-circuit').disabled, true);
  assert.equal(get('share-json').disabled, true, 'An empty identity is not a custom puzzle.');
  assert.equal(get('input-json').disabled, false);
  get('editor-wires').value = '1'; await get('editor-wires').dispatch('change');
  await play({ rule: 'cancel-x', row: 0, column: 0, reverse: true });
  assert.deepEqual(boardCircuit(), [['X', 'X', '.', '.', '.', '.']]);
  assert.equal(get('win-dialog').open, false, 'Constructing an identity does not finish a game.');
  assert.equal(get('save-circuit').disabled, false);
  await click('share-json');
  assert.deepEqual(JSON.parse(get('puzzle-json-text').value), { circuit: [['X', 'X', '.', '.', '.', '.']] });
  await click('puzzle-json-close');
  await click('save-circuit');
  assert.equal(get('circuit-editor-controls').hidden, true);
  assert.equal(moveCount(), 0);
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  await finish({ solution: [{ rule: 'cancel-x', row: 0, column: 0 }] });
  assert.equal(get('score-form').hidden, true);
  await click('close-win');
  await importCircuit([['.', 'X', 'X', '.']]);
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  await finish({ solution: LEVELS[0].solution }); assert.equal(get('score-form').hidden, true);
  const beforeRandomSubmit = requests.length; await get('score-form').dispatch('submit'); assert.equal(requests.length, beforeRandomSubmit, 'Random/custom wins never create a ranked score');

  // Native rewrites commit once but keep the old board visible until the tween
  // finishes. Metadata refreshes and cancellation cannot expose a stale win.
  await click('close-win');
  await importCircuit(LEVELS[1].circuit);
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  const nativeJobs = [];
  Element.prototype.animate = function () {
    let resolve, reject;
    const finished = new Promise((done, fail) => { resolve = done; reject = fail; });
    const job = { finished, finish: resolve, cancel: () => reject(new Error('Cancelled')) };
    nativeJobs.push(job); return job;
  };
  const finishAnimations = async () => { for (const job of nativeJobs.splice(0)) job.finish(); await settle(); };
  const originalHadamards = boardCircuit();
  await play(LEVELS[1].solution[0]);
  assert.equal(moveCount(), 1);
  assert.deepEqual(boardCircuit(), originalHadamards, 'The old board remains under the transient gates');
  assert.equal(get('circuit-board').dataset.rewriteAnimating, 'true');
  assert.equal(get('win-dialog').open, false, 'The result waits for cancellation to be visible');
  assert.ok(get('circuit-board').querySelectorAll('[data-cell]').every(cell => cell.disabled));
  assert.ok(rules.every(button => button.disabled), 'Metadata/UI updates cannot re-enable a rewrite in flight');
  await click('undo'); await boards(); await finishAnimations();
  assert.deepEqual(boardCircuit(), originalHadamards);
  assert.equal(moveCount(), 0);
  assert.equal(get('win-dialog').open, false, 'An undone transition cannot finish the round later');
  assert.equal(get('circuit-board').querySelectorAll('.rewrite-overlay').length, 0);
  await play(LEVELS[1].solution[0]);
  await click('restart'); await boards(); await finishAnimations();
  assert.deepEqual(boardCircuit(), originalHadamards);
  assert.equal(get('win-dialog').open, false, 'Reset cancels the pending result');
  await play(LEVELS[1].solution[0]); await finishAnimations();
  assert.ok(isSolved(boardCircuit()));
  assert.equal(get('win-dialog').open, true);
  await click('close-win'); await click('replay');
  let nativeTimer = [...timers.values()].find(timer => timer.delay === 650);
  timers.delete(nativeTimer); nativeTimer.callback();
  assert.equal(get('review-note').textContent, 'Step 0 / 1', 'Replay waits for its native transition');
  await click('resume-round'); await finishAnimations();
  assert.equal(get('review-controls').hidden, true);
  assert.ok(isSolved(boardCircuit()), 'Cancelling replay restores the completed round');
  await click('mode-tutorial');
  await click('tutorial-start');
  const guidedMove = click('tutorial-next');
  await settle();
  assert.ok(nativeJobs.length, 'The tutorial rewrite is still animating');
  const requestCountDuringGuide = requests.length;
  await click('mode-daily');
  assert.equal(requests.length, requestCountDuringGuide, 'Daily requests cannot interrupt an executing tutorial step');
  await finishAnimations(); await guidedMove;
  assert.equal(get('tutorial-heading').textContent, `Step 2 of ${TUTORIAL_STEPS.length}`);
  delete Element.prototype.animate;
  await importCircuit([['.', 'X', 'X', '.']]);
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  await finish({ solution: LEVELS[0].solution });

  // Replay reviews snapshots, permits undo, and cannot mutate a later round.
  await click('close-win');
  assert.equal(get('replay-actions').hidden, false, 'The replay row is visible once a move exists');
  await click('replay');
  assert.equal(get('review-note').textContent, 'Step 0 / 1');
  assert.deepEqual(boardCircuit(), [['.', 'X', 'X', '.']], 'Replay begins with the original circuit');
  const inspectedBoard = boardSignature();
  await cellAt(0, 0).dispatch('pointerdown', mouse(0, 0));
  await get('circuit-board').dispatch('pointermove', mouse(0, 1));
  await documentMock.dispatch('keydown', { target: get('circuit-scroll'), key: 'Enter' });
  assert.deepEqual(selectedKeys(), [], 'Review snapshots cannot be selected by dragging');
  assert.equal(boardSignature(), inspectedBoard, 'Enter cannot rewrite an inspected snapshot');
  await click('resume-round'); assert.equal(get('review-controls').hidden, true);
  const finishedBoard = boardCircuit();
  await addSpace(0, 0);
  assert.equal(boardCircuit()[0].length, finishedBoard[0].length + 1);
  assert.equal(moveCount(), 1, 'Free layout history does not add a rewrite');
  await click('undo'); await boards();
  assert.deepEqual(boardCircuit(), finishedBoard, 'Undo restores the circuit before the free layout step');
  assert.equal(moveCount(), 1);
  await click('replay-result'); assert.equal(get('win-dialog').open, false); assert.equal(get('review-note').textContent, 'Step 0 / 1');
  const replayTimer = [...timers.values()].find(timer => timer.delay === 650); timers.delete(replayTimer); replayTimer.callback(); await settle();
  assert.equal(get('review-note').textContent, 'Step 1 / 1');
  await click('undo'); await boards(); assert.equal(moveCount(), 0); assert.equal(get('review-controls').hidden, true);
  assert.equal(get('replay-actions').hidden, true, 'Undoing the final move hides the empty replay row');
  await finish({ solution: LEVELS[0].solution });
  const beforeExport = gifs.length;
  await click('share-result'); await settle();
  assert.equal(gifs.length, beforeExport, 'Opening sharing does not encode a replay');
  click('download-gif'); await settle(); const exportJob = gifs.at(-1);
  assert.equal(exportJob.round.label, 'Custom circuit'); assert.deepEqual(exportJob.round.circuit, [['.', 'X', 'X', '.']]);
  await click('restart'); assert.equal(exportJob.worker.terminated, true); assert.equal(get('share-dialog').open, false);
  exportJob.resolve(new Blob(['GIF89a'], { type: 'image/gif' })); await settle(); assert.equal(get('share-preview').hidden, true);

  // An interrupted advisory search leaves an honest status on return and
  // cannot publish an optimum after its worker has been terminated.
  await importCircuit([['H', 'Z', 'H', 'X']]);
  const interruptedSearch = workers.at(-1), beforeSearchRestore = boardSignature();
  assert.match(get('custom-status').textContent, /Finding a shortest solution/);
  await windowMock.dispatch('pagehide');
  assert.equal(interruptedSearch.terminated, true);
  interruptedSearch.respond({ status: 'optimal', optimalMoves: 99 });
  assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);
  await windowMock.dispatch('pageshow', { persisted: true });
  await reply(pendingDaily(), metadata('2026-10-17')); await boards();
  assert.equal(boardSignature(), beforeSearchRestore);
  assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);

  // A custom worker is advisory and stale results cannot change another level.
  await importCircuit([['H', 'Z', 'H', 'X']]); const staleWorker = workers.at(-1);
  await click('mode-campaign'); staleWorker.respond({ status: 'optimal', optimalMoves: 99 }); assert.equal(staleWorker.terminated, true);
  assert.equal(get('custom-status').textContent, ''); await boards();
  await click('mode-random');
  globalThis.Worker = undefined; await importCircuit([['H', 'Z', 'H', 'X']]); assert.match(get('custom-status').textContent, /Identity verified.*unavailable/);
  globalThis.Worker = WorkerMock;
  const validCustom = boardSignature(); await importCircuit([['.', 'X', '.', '.']]);
  assert.match(get('puzzle-json-status').textContent, /implement the identity/); assert.equal(boardSignature(), validCustom);

  // Import budgets protect parsing, identity evaluation and DOM construction,
  // while the paper game's interactive horizontal layout remains unlimited.
  const pasteLimit = Number(get('puzzle-json-text').getAttribute('maxlength'));
  assert.equal(pasteLimit, 65_536);
  const beforeLargePaste = boardSignature(), beforeLargePasteMoves = moveCount(), beforeLargePasteWorkers = workers.length;
  await inputJson('!'.repeat(pasteLimit + 1));
  assert.match(get('puzzle-json-status').textContent, /64 KB/);
  assert.equal(boardSignature(), beforeLargePaste, 'An excessive import preserves the current circuit');
  assert.equal(moveCount(), beforeLargePasteMoves);
  assert.equal(workers.length, beforeLargePasteWorkers, 'Excessive imports never start searches');
  await inputJson(JSON.stringify({ circuit: [['H', 'H']] }).padEnd(pasteLimit, ' '));
  assert.deepEqual(workers.at(-1).message.circuit, [['H', 'H']], 'Imports at the advertised boundary remain valid');
  workers.at(-1).respond({ status: 'optimal', optimalMoves: 1 });
  assert.match(get('custom-status').textContent, /Shortest solution: 1 moves/);
  for (const result of [null, undefined, [], {}, 'bad', { status: 'optimal' },
    ...[0, -1, .5, NaN, Infinity, '1'].map(optimalMoves => ({ status: 'optimal', optimalMoves }))]) {
    await importCircuit([['H', 'H']]);
    const worker = workers.at(-1);
    assert.doesNotThrow(() => worker.respond(result));
    assert.equal(worker.terminated, true, 'Malformed terminal replies release their search worker');
    assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  }
  await importCircuit([['H', 'H']]);
  const unreadableMessage = workers.at(-1);
  unreadableMessage.onmessageerror();
  assert.equal(unreadableMessage.terminated, true);
  assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  failPosting = true;
  await importCircuit([['H', 'H']]);
  assert.equal(workers.at(-1).terminated, true, 'A synchronous posting failure releases its worker');
  assert.match(get('custom-status').textContent, /Identity verified.*search limit/);
  failPosting = false;
  await importCircuit([['H', 'H']]);
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
  assert.equal(restoredExport.worker.terminated, true);
  assert.equal(get('share-dialog').open, false, 'Navigation closes the disposed sharing dialog');
  await windowMock.dispatch('pageshow', { persisted: true });
  const restoredRanking = requests.at(-1);
  assert.equal(new URL(restoredRanking.url, 'https://example.test').searchParams.get('player'), String(savedPlayer.id));
  await reply(restoredRanking, boardData(savedPlayer));
  await reply(pendingDaily(), metadata('2026-10-17')); await boards();
  restoredExport.resolve(new Blob(['GIF89a'], { type: 'image/gif' })); await settle();
  assert.equal(boardSignature(), savedBoard); assert.equal(moveCount(), savedMoves);
  assert.equal(get('win-dialog').open, true); assert.equal(get('score-form').hidden, true);
  assert.equal(get('win-results').hidden, false, 'A BFCache return preserves the saved score');
  get('result-advanced-features').open = true;
  await click('nickname-forget');
  assert.equal(nicknames.has('games.nickname.v1'), false);

  // Every PDF lesson is playable using only its unlocked rules and public layout controls.
  for (const lesson of LEVELS) {
    await chooseLevel(lesson.id);
    for (const button of rules) assert.equal(button.hidden, !lesson.allowedRules.includes(button.dataset.rule), `Rule availability in lesson ${lesson.id}`);
    await finish(lesson);
    assert.equal(moveCount(), sequenceCost(lesson.solution), `Witness score in lesson ${lesson.id}`);
  }

  // Server time is authoritative, and reopening today's puzzle preserves play.
  const today = '2026-10-17', beforeMidnight = dailyBounds(today).closesAt - 1000;
  await loadDaily(today, beforeMidnight, true); const puzzle = dailyPuzzle(today);
  Date.now = () => Date.parse('2036-01-01T12:00:00Z');
  assert.equal(get('replay').closest('.advanced-features'), null, 'Daily replay is directly reachable');
  assert.equal(get('replay-actions').hidden, true, 'An untouched daily has no replay row');
  assert.equal(get('replay-result').closest('.advanced-features'), null, 'Daily result replay is directly reachable');
  assert.equal(get('result-replay-actions').parentElement, get('daily-result-actions'));
  assert.equal(get('result-advanced-features').hidden, true, 'Daily results hide the empty nickname disclosure');
  assert.equal(get('share-score').parentElement, get('daily-replay-actions'));
  assert.equal(get('share-result').parentElement, get('result-replay-actions'), 'Daily replay and sharing retain one action row');
  assert.equal(get('daily-replay-actions').hidden, true, 'An unwon daily has no empty share-action block');
  assert.equal(get('daily-result-actions').hidden, false);
  await play(puzzle.solution[0]); const dailyProgress = boardSignature();
  assert.equal(get('replay-actions').hidden, false);
  await click('replay');
  assert.equal(get('review-controls').hidden, false, 'The direct daily replay button opens inspection');
  assert.deepEqual(boardCircuit(), puzzle.circuit);
  await click('resume-round'); assert.equal(get('review-controls').hidden, true);
  assert.equal(boardSignature(), dailyProgress, 'Leaving daily replay inspection preserves the round');
  await loadDaily(today, beforeMidnight, true); assert.equal(moveCount(), 1); assert.equal(boardSignature(), dailyProgress);
  for (const move of puzzle.solution.slice(1)) await play(move);
  assert.equal(get('daily-replay-actions').hidden, false);
  assert.equal(get('daily-result-actions').hidden, false);
  assert.equal(get('share-score').closest('.advanced-features'), null, 'Daily sharing stays outside Advanced');
  assert.equal(get('share-result').closest('.advanced-features'), null);
  assert.equal(get('score-form').hidden, false); const winningBoard = boardSignature();
  const rollover = [...timers.values()].find(timer => timer.delay === 1050); assert.ok(rollover);
  monotonic += 1050; timers.delete(rollover); const refreshing = rollover.callback();
  assert.match(get('daily-note').textContent, /Practice.*closed/);
  await reply(pendingDaily(), metadata(today, beforeMidnight + 1050)); await refreshing; await boards();
  assert.equal(moveCount(), puzzle.optimalMoves); assert.equal(boardSignature(), winningBoard); assert.equal(get('score-form').hidden, true);
  assert.equal(get('daily-date').children[0].value, '2026-10-18'); assert.equal(get('daily-date').value, today);
  const beforePastSubmit = requests.length; await get('score-form').dispatch('submit'); assert.equal(requests.length, beforePastSubmit);
  await click('try-again'); await boards(); assert.equal(moveCount(), 0);
  Date.now = () => Date.parse('2026-10-17T12:00:00Z');

  // An API rejection at midnight turns an already-won round into practice.
  await loadDaily('2026-10-18', dailyBounds('2026-10-18').opensAt + 100, true);
  const next = dailyPuzzle('2026-10-18'); await finish(next);
  get('player-name').value = 'Ada';
  const expiring = get('score-form').dispatch('submit'), expired = requests.at(-1);
  await reply(expired, { error: 'This puzzle’s leaderboard is closed.' }, 409); await expiring;
  assert.equal(get('score-form').hidden, true); assert.equal(get('win-practice').hidden, false);
  await reply(pendingDaily(), metadata('2026-10-18', dailyBounds('2026-10-18').closesAt + 10)); await boards();
  assert.equal(moveCount(), next.optimalMoves); assert.equal(get('win-dialog').open, true);

  // An unavailable daily API leaves the current puzzle intact.
  const beforeOutage = boardSignature(), movesBeforeOutage = moveCount();
  const offline = click('mode-daily'); await reply(pendingDaily(), {}, 503); await offline; await boards();
  assert.equal(get('daily-status').textContent, 'Daily puzzle unavailable. Try again.');
  assert.equal(boardSignature(), beforeOutage, 'An outage never replaces the board with a locally generated puzzle');
  assert.equal(moveCount(), movesBeforeOutage);
  assert.equal(get('score-form').hidden, true);
  assert.ok([...timers.values()].some(timer => timer.delay === 60_000), 'The requested daily puzzle retries its server API');
  const requestCount = requests.length; documentMock.hidden = true; await documentMock.dispatch('visibilitychange'); assert.equal(requests.length, requestCount);
  documentMock.hidden = false; const resumed = documentMock.dispatch('visibilitychange');
  assert.equal(new URL(pendingDaily().url, 'https://example.test').searchParams.get('date'), '2026-10-18', 'Recovery refreshes the preserved puzzle date');
  await reply(pendingDaily(), metadata('2026-10-18', dailyBounds('2026-10-18').closesAt + 10)); await resumed; await boards();
  assert.equal(get('daily-status').textContent, '');
  assert.equal(boardSignature(), beforeOutage, 'A metadata refresh preserves progress after the outage');
  await click('mode-campaign'); await boards();
  assert.equal(get('share-score').parentElement, get('replay-actions'), 'Leaving daily restores main Share to the replay row');
  assert.equal(get('share-result').parentElement, get('result-replay-actions'), 'Leaving daily restores result Share to Advanced');
  assert.equal(get('result-replay-actions').parentElement, get('result-advanced-features'));
  assert.equal(get('daily-replay-actions').hidden, true);
  assert.equal(get('daily-result-actions').hidden, true);
  await windowMock.dispatch('pagehide'); assert.equal(timers.size, 0, 'Leaving the page cancels refresh/replay/request timers');
  // Generated witnesses are valid independent of the UI and play helper.
  assert.ok(isSolved(puzzle.solution.reduce(applyMove, cloneCircuit(puzzle.circuit))));
});
