import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { website, websiteFile } from '../../tools/quantum-golf/website.mjs';
const { applyGate, traceDistance, START_STATE } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { dailyPuzzle, dailyBounds, dailyDate, DAILY_START, DAILY_TIME_ZONE } = await import(websiteFile('src/lib/quantum-golf/daily.js'));

test('campaign, random and daily rounds: scoring, navigation, races and midnight rollover', async (context) => {
  class MockElement {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.listeners = new Map();
      this.attrs = {};
      this.children = [];
      this.hidden = false;
      this.open = false;
      this.showCount = 0;
      this.className = '';
      this.value = '';
      this.disabled = false;
      this._text = '';
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
      };
    }
    addEventListener(name, callback) {
      this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
    }
    dispatch(name, extra = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      const result = Promise.all((this.listeners.get(name) || []).map((callback) => callback(event)));
      if (name === 'cancel' && this.tagName === 'DIALOG' && !event.defaultPrevented) this.close();
      return result;
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    get textContent() { return this._text + this.children.map((child) => child.textContent ?? child).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    showModal() { this.open = true; this.showCount++; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
    focus() {}
    reportValidity() { return true; }
    querySelector() { return submitButton; }
  }

  // Use the real Astro markup so renamed or removed controls fail the test.
  const html = await readFile(new URL('src/pages/games/quantum-golf.astro', website), 'utf8');
  const advancedMarkup = html.match(/(<details\b[^>]*\bid="advanced-features"[^>]*>)([\s\S]*?)<\/details>/);
  assert.ok(advancedMarkup, 'Advanced controls use a native disclosure');
  assert.doesNotMatch(advancedMarkup[1], /\sopen(?:[\s=>])/, 'Advanced controls start collapsed');
  for (const id of ['replay', 'view-target', 'toggle-follow', 'view-left', 'view-right', 'view-up', 'view-down', 'zoom-in', 'zoom-out']) {
    assert.match(advancedMarkup[2], new RegExp(`\\bid="${id}"`), `#${id} belongs to Advanced`);
  }
  assert.doesNotMatch(html, /\bid="replay-start"/, 'Start is removed from the page');
  const resultAdvancedMarkup = html.match(/(<details\b[^>]*\bid="result-advanced-features"[^>]*>)([\s\S]*?)<\/details>/);
  assert.ok(resultAdvancedMarkup, 'Result Replay uses a native disclosure');
  assert.doesNotMatch(resultAdvancedMarkup[1], /\sopen(?:[\s=>])/, 'Result advanced controls start collapsed');
  assert.match(resultAdvancedMarkup[2], /\bid="replay-result"/);
  assert.doesNotMatch(html, /\bid="undo-result"/, 'Undo remains on the game instead of the popup');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new MockElement(match[1].toUpperCase());
    element.value = match[0].match(/\bvalue="([^"]+)"/)?.[1] || '';
    element.textContent = html.slice(match.index + match[0].length).match(/^([^<]*)</)?.[1].trim() || '';
    element.hidden = /\bhidden\b/.test(match[0]);
    element.disabled = /\bdisabled\b/.test(match[0]);
    element.open = /\sopen(?:[\s=>])/.test(match[0]);
    for (const attr of match[0].matchAll(/\b(aria-[\w-]+)="([^"]*)"/g)) element.setAttribute(attr[1], attr[2]);
    elements.set(match[2], element);
  }
  const get = (id) => {
    assert.ok(elements.has(id), `Real page must include #${id}`);
    return elements.get(id);
  };
  const submitButton = new MockElement('BUTTON');
  const body = new MockElement('BODY');
  const doc = new MockElement('DOCUMENT');
  doc.getElementById = get;
  doc.createElement = (tag) => new MockElement(tag.toUpperCase());
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  let reducedMotion = true;
  const browser = new MockElement('WINDOW');
  browser.matchMedia = () => ({ matches: reducedMotion });
  globalThis.window = browser;
  let monotonic = 0;
  const originalPerformance = globalThis.performance;
  globalThis.performance = { now: () => monotonic };
  const requests = [];
  globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => {
    requests.push({ url: String(url), options, resolve, reject });
  });
  const timers = new Map();
  const originalTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    timers.set(timer, timer);
    return timer;
  };
  globalThis.clearTimeout = timer => timers.delete(timer);
  context.after(() => {
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.performance = originalPerformance;
  });
  const workers = [];
  globalThis.Worker = class {
    onmessage = null;
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    respond(data) { this.onmessage?.({ data }); }
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  async function reply(request, data, status = 200) {
    request.replied = true;
    request.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
    await settle();
  }

  let nextFrame = 1;
  const frames = new Map();
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  function flushFrames() {
    let count = 0;
    while (frames.size) {
      assert.ok(count++ < 100, 'Animation should settle');
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(performance.now() + 1000);
    }
  }
  let sphere;
  globalThis.__BlochSphereMock = class {
    constructor(_canvas, options) {
      this.model = { showTrace: true };
      this.options = options;
      this.cameraCalls = [];
      this.focusCalls = [];
      this.rotateCalls = [];
      this.zoomCalls = [];
      sphere = this;
    }
    setState(next) { this.model = { ...this.model, ...next }; }
    cameraTo(point) {
      this.cameraCalls.push(point);
      this.cameraTarget = point;
      this.cameraFrames = [];
      return progress => this.cameraFrames.push(progress);
    }
    focus(point) { this.focusCalls.push(point); }
    rotateBy(...delta) { this.rotateCalls.push(delta); }
    zoomBy(scale) { this.zoomCalls.push(scale); }
  };

  const scriptURL = new URL('src/scripts/quantum-golf.js', website);
  const original = await readFile(scriptURL, 'utf8');
  assert.doesNotMatch(original, /\breplay-start\b/, 'The removed Start control has no controller handler');
  const instrumented = original
    .replace("import { BlochSphere } from '../lib/quantum-golf/sphere.js';", 'const BlochSphere = globalThis.__BlochSphereMock;')
    .replace(/from (['"])(\.\.\/lib\/quantum-golf\/[^'"]+)\1/g, (_, _quote, path) => `from '${new URL(path, scriptURL).href}'`)
    .replace(/new URL\((['"])(\.\/quantum-golf-worker\.js)\1, import\.meta\.url\)/g, (_, _quote, path) => `new URL('${new URL(path, scriptURL).href}')`);
  await import(`data:text/javascript;base64,${Buffer.from(`${instrumented}\n//# sourceURL=${fileURLToPath(scriptURL)}`).toString('base64')}`);

  const click = (id) => get(id).dispatch('click');
  const strokes = () => sphere.model.sequence.length;
  const winning = () => get('status').textContent === 'In the hole!';
  const dialog = get('win-dialog');
  const rulesDialog = get('rules-dialog');
  const player = (rank, name = `Player ${rank}`, moves = 1) => ({ id: rank, name, moves, rank });
  const board = (entries = [], currentPlayer = null, total = entries.length) => ({ total, entries, currentPlayer });
  const displayedRanks = (id) => get(id).children.slice(1).map((row) => Number(row.children[0].textContent));
  function selectLevel(value) {
    get('level').value = String(value);
    get('level').dispatch('change');
  }
  function place(theta, phi) {
    get('target-theta').value = String(theta);
    get('target-phi').value = String(phi);
    get('coordinate-form').dispatch('submit');
  }
  function epsilon(value) {
    get('epsilon').value = String(value);
    get('epsilon').dispatch('input');
  }
  function samePoint(actual, expected) {
    assert.ok(traceDistance(actual, expected) < 1e-12);
  }
  function finishHole(hole) {
    // Offline campaign verification can exceed the interactive worker budget.
    const solution = solveShortest(hole.target, hole.epsilon, { maxDepth: hole.optimalMoves, maxNodes: 2_000_000 });
    assert.equal(solution.status, 'optimal');
    for (const gate of solution.sequence) {
      click(`gate-${gate.toLowerCase()}`);
      flushFrames();
    }
    return solution.sequence;
  }
  const finishLevel = index => finishHole(LEVELS[index]);

  assert.equal(strokes(), 0);
  assert.equal(get('advanced-features').open, false);
  assert.equal(get('result-advanced-features').open, false);
  assert.equal(get('replay').textContent, 'See the replay');
  assert.equal(get('replay-result').textContent, 'See the replay');
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'false');
  assert.equal(get('mode-daily').getAttribute('aria-pressed'), 'false');
  assert.equal(get('campaign-controls').hidden, false);
  assert.equal(get('daily-heading').hidden, true);
  assert.equal(get('daily-archive').hidden, true);
  assert.equal(winning(), false);
  samePoint(sphere.model.state, START_STATE);
  assert.equal(get('toggle-trace').getAttribute('aria-pressed'), 'true');
  assert.equal(get('toggle-follow').getAttribute('aria-pressed'), 'true');
  assert.equal(sphere.model.showTrace, true);
  assert.equal(sphere.model.sequence, '');
  click('toggle-trace');
  assert.equal(get('toggle-trace').getAttribute('aria-pressed'), 'false');
  assert.equal(sphere.model.showTrace, false);
  click('toggle-trace');
  assert.equal(get('toggle-trace').getAttribute('aria-pressed'), 'true');
  assert.equal(sphere.model.showTrace, true);
  assert.ok(traceDistance(sphere.model.target, START_STATE) > sphere.model.epsilon);

  // Rules uses its own native modal and leaves the round untouched.
  assert.equal(get('show-rules').textContent, 'Rules');
  assert.equal(rulesDialog.getAttribute('aria-labelledby'), 'rules-title');
  assert.match(html, /\|\+⟩ = \(\|0⟩ \+ \|1⟩\)\/√2/);
  assert.match(html, /approximate synthesis of a quantum state/);
  click('show-rules');
  assert.equal(rulesDialog.open, true);
  assert.equal(dialog.open, false);
  for (const key of ['h', 't', 'Backspace', 'r', 'n', 'ArrowLeft']) {
    await doc.dispatch('keydown', { key, target: key === 'ArrowLeft' ? get('sphere') : get('close-rules') });
  }
  assert.equal(frames.size, 0);
  assert.equal(strokes(), 0);
  samePoint(sphere.model.state, START_STATE);
  click('close-rules');
  assert.equal(rulesDialog.open, false);
  click('show-rules');
  await rulesDialog.dispatch('cancel');
  assert.equal(rulesDialog.open, false);
  assert.equal(winning(), false);

  // Ranked holes lock both target and epsilon, including synthetic calls to
  // disabled controls. Reset and undo preserve the exact campaign rules.
  assert.equal(get('level').value, '1');
  samePoint(sphere.model.target, LEVELS[0].target);
  assert.equal(sphere.model.epsilon, LEVELS[0].epsilon);
  assert.equal(get('epsilon').disabled, true);
  assert.equal(get('previous-level').disabled, true);
  assert.equal(get('next-level').disabled, true);
  click('next-level');
  assert.equal(get('level').value, '1', 'Next level requires finishing the current hole');
  assert.equal(get('free-controls').hidden, true);
  assert.equal(dialog.open, false);
  assert.equal(get('show-results').hidden, true);
  const initialRequests = requests.length;
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, initialRequests, 'Unfinished rounds cannot submit scores');
  epsilon(0.4);
  place(0, 0);
  sphere.options.onPick([0, 1, 0]);
  click('new-hole');
  click('pick-target');
  assert.equal(sphere.model.pickMode, false);
  assert.equal(sphere.model.epsilon, LEVELS[0].epsilon);
  samePoint(sphere.model.target, LEVELS[0].target);
  assert.equal(strokes(), 0);
  assert.ok(requests.length > 0, 'Campaign opens its shared score list');
  await reply(requests[0], board([player(1, '<b>Ada</b>', 2)]));
  const rows = get('leaderboard-body').children;
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].children[0].textContent, '—', 'The optimum is a reference, not a human rank');
  assert.equal(rows[0].children[1].textContent, 'Optimal');
  assert.equal(rows[0].children[2].textContent, '1');
  assert.equal(rows[1].children.some((cell) => cell.textContent === '<b>Ada</b>'), true, 'Visitor names are literal text');
  assert.equal(rows[0].textContent.includes('HT'), false, 'The optimum row exposes only its count');

  const firstSolution = finishLevel(0);
  assert.equal(winning(), true);
  samePoint(sphere.cameraTarget, LEVELS[0].target);
  assert.equal(sphere.cameraFrames.at(-1), 1, 'Reduced motion centers the camera in the same frame');
  assert.equal(dialog.open, true);
  assert.equal(get('win-title').textContent, 'GG');
  assert.equal(get('win-summary').textContent, 'Optimal solution in 1 move.');
  assert.equal(get('score-form').hidden, false);
  assert.equal(get('win-results').hidden, true);
  assert.equal(get('show-results').hidden, false);

  // Modal keyboard input must leave the game behind it alone. Escape uses the
  // native dialog cancel event, keeping the completed round available.
  for (const key of ['h', 't', 'Backspace', 'r', 'n', 'ArrowLeft']) {
    await doc.dispatch('keydown', { key, target: key === 'ArrowLeft' ? get('sphere') : get('close-win') });
  }
  assert.equal(frames.size, 0);
  assert.equal(strokes(), 1);
  assert.equal(winning(), true);
  samePoint(sphere.model.target, LEVELS[0].target);
  await doc.dispatch('keydown', { key: 'Escape', target: get('close-win') });
  await dialog.dispatch('cancel');
  assert.equal(dialog.open, false);
  assert.equal(winning(), true);
  const firstShowCount = dialog.showCount;
  epsilon(0.4);
  assert.equal(dialog.open, false, 'Updating an already won round must not reopen a dismissed dialog');
  assert.equal(dialog.showCount, firstShowCount);
  click('show-results');
  assert.equal(dialog.open, true);
  const beforeInvalidName = requests.length;
  get('player-name').value = '   ';
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, beforeInvalidName);
  assert.ok(get('score-status').textContent, 'An invalid name gives feedback');
  get('player-name').value = 'Ada';
  const submitted = get('score-form').dispatch('submit');
  const post = requests.at(-1);
  assert.equal(post.options.method, 'POST');
  assert.deepEqual(JSON.parse(post.options.body), { level: 1, name: 'Ada', sequence: firstSolution });
  const duringSave = requests.length;
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, duringSave, 'A pending save cannot be submitted twice');
  await reply(post, { error: 'Please try again.' }, 503);
  await submitted;
  assert.equal(winning(), true);
  assert.equal(dialog.open, true);
  assert.equal(get('score-form').hidden, false);
  assert.equal(get('win-results').hidden, true);
  assert.equal(get('submit-score').disabled, false, 'A failed save allows retry');
  assert.equal(get('score-status').textContent, 'Scores temporarily unavailable.', 'Internal server messages remain generic');
  const rejectedSubmission = get('score-form').dispatch('submit');
  await reply(requests.at(-1), { error: 'Use a name of 1 to 24 characters.' }, 400);
  await rejectedSubmission;
  assert.equal(get('score-status').textContent, 'Use a name of 1 to 24 characters.', 'Validation errors explain how to retry');
  assert.equal(get('submit-score').disabled, false);
  const stalledSubmission = get('score-form').dispatch('submit');
  const stalledPost = requests.at(-1);
  const stalledTimer = [...timers.values()].at(-1);
  assert.equal(stalledTimer.delay, 15_000);
  stalledPost.options.signal.addEventListener('abort', () => stalledPost.reject(new Error('Aborted')));
  stalledTimer.callback();
  await stalledSubmission;
  assert.equal(stalledPost.options.signal.aborted, true, 'A stalled request is cancelled');
  assert.equal(timers.has(stalledTimer), false, 'Request timers are released on failure');
  assert.equal(get('submit-score').disabled, false, 'A timed-out save allows retry');
  assert.equal(winning(), true, 'A timed-out save preserves the completed round');
  const retry = get('score-form').dispatch('submit');
  const retryTimer = [...timers.values()].at(-1);
  const own = player(19, 'Ada');
  const windowRanks = [1, 2, 3, 4, 5, 17, 18, 19, 20, 21];
  const windowEntries = windowRanks.map((rank) => rank === 19 ? own : player(rank));
  await reply(requests.at(-1), board(windowEntries, own, 40));
  await retry;
  assert.equal(timers.has(retryTimer), false, 'Successful responses release their timeout');
  assert.equal(dialog.open, true);
  assert.equal(get('score-form').hidden, true);
  assert.equal(get('win-results').hidden, false);
  assert.equal(get('result-actions').hidden, false);
  assert.equal(get('result-next').hidden, false);
  assert.match(get('player-rank').textContent, /19/);
  assert.match(get('player-rank').textContent, /40/);
  assert.deepEqual(displayedRanks('result-leaderboard-body'), windowRanks);
  assert.deepEqual(displayedRanks('leaderboard-body'), windowRanks);
  const ownRow = get('result-leaderboard-body').children.find((row) => row.classList.contains('current-player'));
  assert.ok(ownRow, 'The submitted player is highlighted');
  assert.equal(ownRow.children[0].textContent, '19', 'Sparse windows keep the global ordinal rank');
  assert.equal(ownRow.children[1].textContent, 'Ada (you)');
  assert.match(get('leaderboard-body').textContent, /Ada/);
  assert.equal(get('submit-score').disabled, true);
  const beforeDuplicate = requests.length;
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, beforeDuplicate, 'A round cannot submit twice');
  click('try-again');
  assert.equal(dialog.open, false);
  assert.equal(winning(), false);
  assert.equal(strokes(), 0);
  samePoint(sphere.model.target, LEVELS[0].target);

  // A user may close while saving. The server response updates the remembered
  // result, and only the explicit Scores button opens that result afterward.
  finishLevel(0);
  const closedSubmission = get('score-form').dispatch('submit');
  const closedPost = requests.at(-1);
  click('close-win');
  assert.equal(dialog.open, false);
  const smallOwn = player(9, 'Ada');
  await reply(closedPost, board(Array.from({ length: 9 }, (_, index) => index === 8 ? smallOwn : player(index + 1)), smallOwn, 9));
  await closedSubmission;
  assert.equal(dialog.open, false, 'A completed save must not reopen a dialog the player closed');
  click('show-results');
  assert.equal(dialog.open, true);
  assert.equal(get('win-results').hidden, false);
  assert.deepEqual(displayedRanks('result-leaderboard-body'), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'Fewer than ten people displays everyone');
  const reopenedGet = requests.at(-1);
  assert.equal(new URL(reopenedGet.url, 'https://www.colin-blake.eu').searchParams.get('player'), '9', 'Reopening Scores asks for the submitted player context');

  // Reset while the personal leaderboard is loading. Its late response must
  // not restore the previous round's saved result or prevent another save.
  click('try-again');
  assert.equal(reopenedGet.options.signal.aborted, true);
  await reply(reopenedGet, board([smallOwn], smallOwn, 9));

  finishLevel(0);
  assert.equal(get('score-form').hidden, false, 'A late personal GET cannot replace the next round\'s entry form');
  assert.equal(get('win-results').hidden, true);
  assert.equal(get('player-name').disabled, false);
  const resetSubmission = get('score-form').dispatch('submit');
  const resetPost = requests.at(-1);
  assert.equal(resetPost.options.method, 'POST', 'The next round can submit a new score');
  click('close-win');
  click('restart');
  assert.equal(dialog.open, false);
  await reply(resetPost, board(windowEntries, own, 40));
  await resetSubmission;
  assert.equal(dialog.open, false);
  assert.equal(winning(), false);
  assert.equal(get('score-status').textContent, '', 'A reset discards stale save feedback');

  selectLevel(2);
  const staleGet = requests.at(-1);
  samePoint(sphere.model.target, LEVELS[1].target);
  assert.equal(sphere.model.epsilon, LEVELS[1].epsilon);
  assert.equal(strokes(), 0);
  finishLevel(1);
  assert.equal(winning(), true);
  const staleSubmission = get('score-form').dispatch('submit');
  const stalePost = requests.at(-1);
  assert.equal(stalePost.options.method, 'POST');
  click('close-win');
  selectLevel(3);
  const latestGet = requests.at(-1);
  await reply(latestGet, board([player(1, 'Current', 3)]));
  await reply(stalePost, board([player(1, 'Late score', 2)], player(1, 'Late score', 2)));
  await staleSubmission;
  await reply(staleGet, board([player(1, 'Stale', 2)]));
  assert.match(get('leaderboard-body').textContent, /Current/);
  assert.doesNotMatch(get('leaderboard-body').textContent, /Stale/);
  assert.doesNotMatch(get('leaderboard-body').textContent, /Late score/);
  assert.equal(get('score-status').textContent, '');
  assert.equal(dialog.open, false, 'Stale POST after a level switch cannot reopen the modal');

  selectLevel(4);
  await reply(requests.at(-1), { error: 'Unavailable' }, 503);
  assert.equal(get('leaderboard-body').children.length, 1, 'The fixed benchmark survives a leaderboard outage');
  assert.equal(get('leaderboard-body').children[0].children[2].textContent, String(LEVELS[3].optimalMoves));
  assert.ok(get('leaderboard-status').textContent);
  assert.equal(get('gate-h').disabled, false, 'A score outage leaves the game playable');

  // Infinite mode retains freely chosen holes and epsilon. Old worker replies
  // cannot replace the benchmark after changing a target.
  selectLevel(LEVELS.length);
  const finalSolution = finishLevel(LEVELS.length - 1);
  assert.equal(winning(), true);
  assert.equal(get('win-summary').textContent, `Optimal solution in ${LEVELS.at(-1).optimalMoves} moves.`);
  assert.equal(get('next-level').disabled, false);
  const finalSubmission = get('score-form').dispatch('submit');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { level: LEVELS.length, name: 'Ada', sequence: finalSolution });
  const finalPlayer = player(1, 'Ada', LEVELS.at(-1).optimalMoves);
  await reply(requests.at(-1), board([finalPlayer], finalPlayer));
  await finalSubmission;
  assert.equal(dialog.open, true);
  assert.equal(get('win-results').hidden, false);
  click('result-next');
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true', 'Completing the final campaign level leads to Random / Custom');
  assert.equal(get('campaign-controls').hidden, true);
  assert.equal(dialog.open, false, 'Next closes the finished campaign dialog');
  assert.equal(get('epsilon').disabled, false);
  assert.equal(get('free-controls').hidden, false);
  assert.equal(get('leaderboard-section').hidden, true);
  assert.equal(get('show-results').hidden, true);
  assert.ok(workers.length > 0);
  const staleWorker = workers.at(-1);
  place(90, 45);
  const currentWorker = workers.at(-1);
  assert.notEqual(currentWorker, staleWorker);
  currentWorker.respond({ status: 'optimal', optimalMoves: 2, sequence: 'HT', checkedDepth: 1, visited: 4 });
  assert.match(get('best-count').textContent, /2/);
  assert.doesNotMatch(get('best-count').textContent, /HT/);
  staleWorker.respond({ status: 'optimal', optimalMoves: 99, sequence: 'H'.repeat(99), checkedDepth: 98, visited: 100 });
  assert.doesNotMatch(get('best-count').textContent, /99/);
  click('new-hole');
  workers.at(-1).respond({ status: 'error' });
  assert.equal(get('best-count').textContent, 'Optimum unavailable');
  assert.doesNotMatch(get('best-count').textContent, /NaN/);
  assert.equal(get('gate-h').disabled, false, 'Solver failure leaves the game playable');

  // Busy handlers cannot queue gates, reset the round, or move its target.
  place(90, 270);
  const firstTarget = [...sphere.model.target];
  click('gate-h');
  assert.equal(get('gate-h').disabled, true);
  assert.equal(get('show-rules').disabled, true);
  click('show-rules');
  assert.equal(rulesDialog.open, false, 'An animation finishes before Rules can open');
  assert.equal(get('epsilon').disabled, true);
  assert.equal(submitButton.disabled, true);
  click('gate-h');
  click('new-hole');
  click('restart');
  click('undo');
  selectLevel(2);
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true', 'A busy gate cannot switch campaign mode');
  assert.equal(get('campaign-controls').hidden, true);
  sphere.options.onPick([0, 1, 0]);
  flushFrames();
  assert.equal(strokes(), 1);
  assert.equal(get('show-rules').disabled, false);
  samePoint(sphere.model.state, applyGate(START_STATE, 'H'));
  samePoint(sphere.model.target, firstTarget);
  // T fixes the north pole but still costs a stroke.
  click('gate-t');
  flushFrames();
  assert.equal(strokes(), 2);
  samePoint(sphere.model.state, [0, 0, 1]);
  click('undo');
  click('undo');
  assert.equal(strokes(), 0);

  // A known one-gate target finishes the round; undo reopens play, and reset
  // clears the sequence while preserving the target and hole size.
  place(0, 0);
  reducedMotion = false;
  const earlierTimestamp = performance.now() - 1;
  click('gate-h');
  // Browsers may deliver this frame's timestamp before the click handler's
  // performance.now(). The animation must stay at its start and then finish.
  const [firstFrame, animate] = frames.entries().next().value;
  frames.delete(firstFrame);
  assert.doesNotThrow(() => animate(earlierTimestamp));
  assert.equal(sphere.cameraFrames.at(-1), 0, 'An early frame leaves camera movement at its start');
  samePoint(sphere.model.state, START_STATE);
  assert.equal(strokes(), 0);
  assert.equal(get('gate-h').disabled, true);
  assert.equal(frames.size, 1);
  const [partialFrame, partialAnimate] = frames.entries().next().value;
  frames.delete(partialFrame);
  partialAnimate(performance.now() + 150);
  const animatedPoint = sphere.model.state;
  assert.ok(traceDistance(animatedPoint, START_STATE) > 0.1, 'The gate has moved before Trace is toggled');
  assert.equal(sphere.model.sequence, '', 'The animated gate is not committed early');
  assert.equal(sphere.model.animation.gate, 'H');
  click('toggle-trace');
  assert.equal(sphere.model.showTrace, false);
  assert.equal(sphere.model.state, animatedPoint, 'Disabling Trace preserves the animated point');
  click('toggle-trace');
  assert.equal(sphere.model.showTrace, true);
  assert.equal(sphere.model.state, animatedPoint, 'Enabling Trace must not snap to the last committed state');
  flushFrames();
  reducedMotion = true;
  assert.equal(strokes(), 1);
  assert.equal(sphere.model.sequence, 'H');
  assert.equal(sphere.model.animation, null, 'A completed gate clears its partial trace');
  assert.equal(winning(), true);
  assert.equal(dialog.open, true, 'Random wins offer replay and another attempt');
  assert.equal(get('score-form').hidden, true, 'Random rounds cannot submit ranked scores');
  assert.equal(get('win-practice').hidden, true, 'Random wins do not claim a closed daily leaderboard');
  click('close-win');
  assert.equal(get('gate-h').disabled, true);
  samePoint(sphere.model.state, [0, 0, 1]);
  click('gate-t');
  flushFrames();
  assert.equal(strokes(), 1);
  click('undo');
  assert.equal(winning(), false);
  assert.equal(strokes(), 0);
  assert.equal(get('gate-h').disabled, false);
  click('gate-t');
  flushFrames();
  click('restart');
  samePoint(sphere.model.state, START_STATE);
  samePoint(sphere.model.target, [0, 0, 1]);
  assert.equal(strokes(), 0);
  assert.equal(get('sequence').textContent, '');

  // Changing ε re-evaluates the win without discarding progress.
  place(90, 90);
  click('gate-t');
  flushFrames();
  const afterT = [...sphere.model.state];
  assert.equal(winning(), false);
  epsilon(0.4);
  assert.equal(winning(), true);
  assert.equal(strokes(), 1);
  samePoint(sphere.model.state, afterT);
  epsilon(0.03);
  assert.equal(winning(), false);
  assert.equal(get('gate-t').disabled, false);
  assert.equal(strokes(), 1);
  click('gate-t');
  flushFrames();
  assert.equal(winning(), true);
  assert.equal(strokes(), 2);
  samePoint(sphere.model.state, applyGate(applyGate(START_STATE, 'T'), 'T'));
  assert.equal(get('sequence').children.filter(child => child.tagName === 'BUTTON').map(button => button.textContent).join(''), 'TT');
  click('close-win');

  // A custom hole may already contain |+⟩; a fresh random hole never does.
  place(90, 0);
  assert.equal(winning(), true);
  assert.equal(strokes(), 0);
  assert.equal(get('undo').disabled, true);
  click('new-hole');
  assert.equal(winning(), false);
  assert.ok(traceDistance(sphere.model.target, START_STATE) > sphere.model.epsilon);

  click('pick-target');
  assert.equal(sphere.model.pickMode, true);
  assert.equal(get('gate-h').disabled, true);
  sphere.options.onPick([0, 1, 0]);
  assert.equal(sphere.model.pickMode, false);
  assert.equal(get('pick-target').attrs['aria-pressed'], 'false');
  samePoint(sphere.model.target, [0, 1, 0]);
  assert.equal(strokes(), 0);
  click('pick-target');
  click('new-hole');
  assert.equal(sphere.model.pickMode, false);

  // Keyboard shortcuts leave form input alone and ignore held-key repeats.
  place(90, 180);
  doc.dispatch('keydown', { key: 'h', target: get('target-theta') });
  doc.dispatch('keydown', { key: 'h', target: body, repeat: true });
  assert.equal(frames.size, 0);
  doc.dispatch('keydown', { key: 'h', target: body });
  flushFrames();
  assert.equal(strokes(), 1);
  doc.dispatch('keydown', { key: 'Backspace', target: body });
  assert.equal(strokes(), 0);

  // H also has stationary states away from the poles.
  for (const gate of ['T', 'H', 'T', 'T']) {
    click(`gate-${gate.toLowerCase()}`);
    flushFrames();
  }
  samePoint(sphere.model.state, [Math.SQRT1_2, 0, Math.SQRT1_2]);
  click('gate-h');
  flushFrames();
  assert.equal(strokes(), 5);
  samePoint(sphere.model.state, [Math.SQRT1_2, 0, Math.SQRT1_2]);

  function metadata(date, serverNow = Date.parse('2026-10-14T12:00:00Z')) {
    const today = dailyDate(serverNow), bounds = dailyBounds(date);
    return { today, startDate: DAILY_START, date, timeZone: DAILY_TIME_ZONE, serverNow,
      ...bounds, nextChangeAt: dailyBounds(today).closesAt, puzzle: dailyPuzzle(date),
      acceptingScores: date === today && serverNow >= bounds.opensAt && serverNow < bounds.closesAt };
  }
  const requestPath = request => new URL(request.url, 'https://www.colin-blake.eu').pathname;
  const pendingDaily = () => requests.findLast(request => requestPath(request) === '/api/daily' && !request.replied);
  async function loadPuzzle(date, serverNow, todayButton = false) {
    const before = requests.length;
    get('daily-date').value = date;
    const loading = todayButton ? click('mode-daily') : get('daily-date').dispatch('change');
    const request = pendingDaily();
    assert.ok(request, 'Daily navigation requests server metadata');
    await reply(request, metadata(date, serverNow));
    await loading;
    const scores = requests.slice(before).find(request => requestPath(request) === '/api/leaderboard');
    if (scores) {
      const query = new URL(scores.url, 'https://www.colin-blake.eu').searchParams;
      assert.equal(query.get('date'), date);
      assert.equal(query.has('level'), false, 'Daily scores never use campaign level IDs');
      await reply(scores, board());
    }
  }

  // A late daily response cannot override the user's newer menu choice.
  const randomSequence = sphere.model.sequence, randomTarget = [...sphere.model.target];
  const staleDailyLoad = click('mode-daily');
  const staleDaily = pendingDaily();
  assert.equal(get('gate-h').disabled, true, 'Pending metadata locks the current round');
  click('mode-random');
  assert.equal(staleDaily.options.signal.aborted, true, 'Selecting the active Random mode cancels a pending Daily load');
  await reply(staleDaily, metadata('2026-10-14'));
  await staleDailyLoad;
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true');
  assert.equal(sphere.model.sequence, randomSequence);
  samePoint(sphere.model.target, randomTarget);

  await loadPuzzle('2026-10-14', undefined, true);
  assert.equal(get('mode-daily').getAttribute('aria-pressed'), 'true');
  assert.equal(get('campaign-controls').hidden, true);
  assert.equal(get('daily-heading').hidden, false);
  assert.match(get('daily-title').textContent, /14 Oct 2026/);
  assert.match(get('daily-note').textContent, /midnight.*Paris/);
  assert.equal(get('hole-controls').hidden, true);
  assert.equal(get('free-controls').hidden, true);
  assert.equal(get('daily-date').disabled, false);
  assert.deepEqual(get('daily-date').children.map(option => option.value), ['2026-10-14', '2026-10-13']);
  assert.equal(get('daily-date').children[0].textContent, 'Today');
  samePoint(sphere.model.target, dailyPuzzle('2026-10-14').target);
  assert.ok(dailyPuzzle('2026-10-14').optimalMoves >= 8 && dailyPuzzle('2026-10-14').optimalMoves <= 12);
  assert.equal(get('leaderboard-body').children[0].children[2].textContent,
    String(dailyPuzzle('2026-10-14').optimalMoves));
  click('gate-h');
  flushFrames();
  const dailyProgress = [...sphere.model.state];
  const beforeDisclosure = requests.length;
  click('daily-toggle');
  assert.equal(get('daily-archive').hidden, false);
  assert.equal(get('daily-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(requests.length, beforeDisclosure, 'Opening a loaded archive does not replace the round');
  await loadPuzzle('2026-10-14', undefined, true);
  assert.equal(strokes(), 1, 'Reopening the same daily puzzle preserves progress');
  samePoint(sphere.model.state, dailyProgress);

  // Past puzzles retain their leaderboard but their win is practice only.
  await loadPuzzle('2026-10-13');
  assert.match(get('daily-note').textContent, /Practice.*closed/);
  const archived = dailyPuzzle('2026-10-13');
  finishHole(archived);
  assert.equal(dialog.open, true);
  assert.equal(get('win-title').textContent, 'GG');
  assert.equal(get('win-practice').hidden, false);
  assert.equal(get('score-form').hidden, true);
  assert.equal(get('result-actions').hidden, false);
  assert.equal(get('result-next').hidden, true);
  const beforePracticeSubmit = requests.length;
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, beforePracticeSubmit, 'Archived puzzles cannot submit scores');
  click('try-again');
  assert.equal(dialog.open, false);
  assert.equal(strokes(), 0);
  samePoint(sphere.model.target, archived.target);

  const today = '2026-10-14', beforeMidnight = dailyBounds(today).closesAt - 5000;
  await loadPuzzle(today, beforeMidnight);
  const originalDateNow = Date.now;
  context.after(() => { Date.now = originalDateNow; });
  Date.now = () => Date.parse('2036-01-01T12:00:00Z');
  const dailySolution = finishHole(dailyPuzzle(today));
  assert.equal(get('score-form').hidden, false, 'A wrong browser wall clock cannot close server-authorized scoring');
  get('player-name').value = 'Ada';
  const dailySubmission = get('score-form').dispatch('submit');
  const dailyPost = requests.at(-1);
  assert.deepEqual(JSON.parse(dailyPost.options.body), { date: today, name: 'Ada', sequence: dailySolution });
  const dailyPlayer = player(1, 'Ada', dailyPuzzle(today).optimalMoves);
  await reply(dailyPost, board([dailyPlayer], dailyPlayer), 201);
  await dailySubmission;
  assert.equal(get('win-results').hidden, false);
  assert.equal(get('win-practice').hidden, true);
  assert.equal(get('result-next').hidden, true);
  assert.equal(get('result-actions').hidden, false);
  assert.match(get('player-rank').textContent, /Your rank: 1/);
  Date.now = originalDateNow;
  click('try-again');

  // The server remains authoritative when midnight occurs during a save.
  finishHole(dailyPuzzle(today));
  const expiredSubmission = get('score-form').dispatch('submit');
  const expiredPost = requests.at(-1);
  await reply(expiredPost, { error: 'This daily leaderboard is closed.' }, 409);
  await expiredSubmission;
  assert.equal(get('score-form').hidden, true);
  assert.equal(get('win-practice').hidden, false);
  assert.match(get('score-status').textContent, /closed/);
  const closedRefresh = pendingDaily();
  assert.equal(new URL(closedRefresh.url, 'https://www.colin-blake.eu').searchParams.get('date'), today);
  await reply(closedRefresh, metadata(today, dailyBounds('2026-10-15').opensAt + 50));
  assert.equal(sphere.model.sequence, dailySolution, 'A rejected score and metadata refresh preserve the winning circuit');
  assert.equal(get('daily-date').children[0].value, '2026-10-15');
  const afterClosing = requests.length;
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, afterClosing, 'Closed daily scoring stays disabled');
  click('try-again');

  // An open tab crosses Paris midnight without losing its circuit. The new
  // Today option appears, while the selected old date becomes practice.
  const nextDate = '2026-10-15', rolloverAt = dailyBounds(nextDate).closesAt;
  await loadPuzzle(nextDate, rolloverAt - 1000, true);
  click('gate-t');
  flushFrames();
  const beforeRollover = [...sphere.model.state], beforeRolloverSequence = sphere.model.sequence;
  const rolloverTimer = [...timers.values()].find(timer => timer.delay === 1050);
  assert.ok(rolloverTimer, 'Rollover timer uses the server deadline and monotonic elapsed time');
  monotonic += 1050;
  timers.delete(rolloverTimer);
  rolloverTimer.callback();
  assert.match(get('daily-note').textContent, /Practice.*closed/);
  assert.equal(sphere.model.sequence, beforeRolloverSequence);
  samePoint(sphere.model.state, beforeRollover);
  await reply(pendingDaily(), metadata(nextDate, rolloverAt + 50));
  assert.equal(get('daily-date').children[0].value, '2026-10-16');
  assert.equal(get('daily-date').value, nextDate);
  assert.equal(sphere.model.sequence, beforeRolloverSequence);
  samePoint(sphere.model.state, beforeRollover);
  const beforeHidden = requests.length;
  doc.visibilityState = 'hidden';
  await doc.dispatch('visibilitychange');
  assert.equal(requests.length, beforeHidden);
  doc.visibilityState = 'visible';
  const visibilityRefresh = doc.dispatch('visibilitychange');
  await reply(pendingDaily(), metadata(nextDate, rolloverAt + 100));
  await visibilityRefresh;
  assert.equal(sphere.model.sequence, beforeRolloverSequence, 'Resuming a tab refreshes its date without resetting progress');
  await loadPuzzle('2026-10-16', rolloverAt + 100, true);
  assert.equal(strokes(), 0);
  assert.match(get('daily-note').textContent, /midnight.*Paris/);
  assert.equal(get('daily-date').value, '2026-10-16');
  click('mode-campaign');
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');
  assert.equal(get('campaign-controls').hidden, false);
  assert.equal(get('level').value, String(LEVELS.length), 'Returning to Campaign restores its last selected level');
  const cancelledCampaignLoad = click('mode-daily');
  const campaignDaily = pendingDaily();
  click('mode-campaign');
  assert.equal(campaignDaily.options.signal.aborted, true, 'Selecting the active Campaign mode cancels a pending Daily load');
  await reply(campaignDaily, metadata('2026-10-16', rolloverAt + 100));
  await cancelledCampaignLoad;
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');
  const failedDailyLoad = click('mode-daily');
  await reply(pendingDaily(), { error: 'Internal details' }, 503);
  await failedDailyLoad;
  assert.match(get('daily-status').textContent, /unavailable.*Try again/);
  assert.doesNotMatch(get('daily-status').textContent, /Internal details/);
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');
  assert.equal(get('gate-h').disabled, false, 'Daily API outages leave the previous round playable');

  // Reviewing and replaying a finished round never changes the circuit being
  // scored, even when the leaderboard returns an earlier, better personal score.
  selectLevel(2);
  const reviewedWord = 'TTTTTTTTH';
  for (const gate of reviewedWord) { click(`gate-${gate.toLowerCase()}`); flushFrames(); }
  assert.equal(winning(), true);
  assert.equal(get('win-summary').textContent, '9 moves : optimum+8');
  const fullPoint = [...sphere.model.state];
  const gateButtons = () => get('sequence').children.filter(child => child.tagName === 'BUTTON');
  const displayedWord = () => gateButtons().map(button => button.textContent).join('');
  assert.equal(displayedWord(), reviewedWord);
  assert.equal(gateButtons()[2].getAttribute('data-step'), '3');
  click('close-win');
  const beforeReviewWin = dialog.showCount;
  get('advanced-features').open = false;
  await gateButtons()[2].dispatch('click');
  assert.equal(get('advanced-features').open, true, 'Clicking a gate exposes review controls');
  assert.equal(get('review-controls').hidden, false);
  samePoint(sphere.model.state, [...reviewedWord.slice(0, 3)].reduce(applyGate, START_STATE));
  assert.equal(sphere.model.sequence, reviewedWord.slice(0, 3));
  assert.equal(get('review-note').textContent, 'Step 3 / 9');
  assert.equal(gateButtons()[2].getAttribute('aria-current'), 'step');
  assert.equal(get('gate-h').disabled, true, 'Inspection cannot append a gate to a displayed prefix');
  assert.equal(winning(), true, 'The completed round remains won while inspecting an earlier state');
  assert.equal(dialog.showCount, beforeReviewWin, 'Inspecting states does not open a new GG dialog');
  click('show-results');
  assert.equal(get('score-form').hidden, false, 'A winning circuit can still be scored after inspection');
  get('player-name').value = 'Inspector';
  const reviewedSubmission = get('score-form').dispatch('submit');
  const reviewedPost = requests.at(-1);
  assert.deepEqual(JSON.parse(reviewedPost.options.body), { level: 2, name: 'Inspector', sequence: reviewedWord });
  const previousBest = player(1, 'Inspector', 1);
  await reply(reviewedPost, board([previousBest], previousBest));
  await reviewedSubmission;
  assert.equal(get('win-summary').textContent, '9 moves : optimum+8', 'The summary describes this round, not the saved personal best');
  const beforeReplayWin = dialog.showCount;
  get('advanced-features').open = false;
  click('replay-result');
  assert.equal(dialog.open, false, 'Popup Replay exposes the sphere');
  assert.equal(get('advanced-features').open, true, 'Popup Replay opens the controls beside the sphere');
  samePoint(sphere.model.state, START_STATE);
  assert.equal(get('review-note').textContent, 'Step 0 / 9');
  assert.equal(sphere.model.sequence, '', 'Replay starts its trace at the initial state');
  assert.equal(displayedWord(), reviewedWord, 'Replay preserves the complete circuit');
  assert.equal(frames.size, 1);
  flushFrames();
  samePoint(sphere.model.state, fullPoint);
  assert.equal(sphere.model.sequence, reviewedWord);
  assert.equal(displayedWord(), reviewedWord);
  assert.equal(get('review-note').textContent, 'Step 9 / 9');
  assert.equal(dialog.showCount, beforeReplayWin, 'Replay does not create a second result');
  click('resume-round');
  assert.equal(get('review-controls').hidden, true);
  samePoint(sphere.model.state, fullPoint);
  click('show-results');
  assert.equal(get('win-results').hidden, false, 'Replay retains the submitted player and leaderboard');
  click('close-win');

  // The return control cancels an in-flight replay without committing its
  // partial gate. Undo always removes the actual circuit's final gate.
  reducedMotion = false;
  click('replay');
  const [replayFrame, replayAnimate] = frames.entries().next().value;
  frames.delete(replayFrame);
  replayAnimate(performance.now() + 150);
  assert.ok(frames.size > 0);
  assert.equal(displayedWord(), reviewedWord);
  click('resume-round');
  assert.equal(frames.size, 0, 'Leaving review cancels its scheduled animation');
  samePoint(sphere.model.state, fullPoint);
  assert.equal(sphere.model.sequence, reviewedWord);
  reducedMotion = true;
  await gateButtons()[1].dispatch('click');
  click('undo');
  assert.equal(get('review-controls').hidden, true);
  assert.equal(displayedWord(), reviewedWord.slice(0, -1), 'Undo acts on the real circuit, not the inspected prefix');
  samePoint(sphere.model.state, START_STATE);
  assert.equal(winning(), false);
  click('gate-h');
  flushFrames();
  assert.equal(dialog.open, true);
  assert.equal(get('score-form').hidden, false, 'Undo discards the old result and enables a fresh score');
  click('close-win');
  click('undo');
  assert.equal(dialog.open, false);
  assert.equal(strokes(), 8);
  assert.equal(winning(), false);

  // Following is optional; direct camera controls work independently of the
  // circuit and target. Turning following back on restores gate centering.
  click('replay');
  assert.equal(frames.size, 1);
  click('mode-random');
  assert.equal(frames.size, 0, 'Changing mode cancels replay frames from the previous round');
  assert.equal(get('review-controls').hidden, true);
  place(90, 180);
  const beforeManualSequence = sphere.model.sequence;
  click('view-target');
  samePoint(sphere.focusCalls.at(-1), sphere.model.target);
  for (const id of ['view-left', 'view-right', 'view-up', 'view-down']) click(id);
  assert.deepEqual(sphere.rotateCalls.slice(-4), [[-30, 0], [30, 0], [0, -30], [0, 30]]);
  click('zoom-in');
  click('zoom-out');
  assert.equal(sphere.zoomCalls.at(-2), 1.2);
  assert.equal(sphere.zoomCalls.at(-1), 1 / 1.2);
  assert.equal(sphere.model.sequence, beforeManualSequence);
  const previousCameraCalls = sphere.cameraCalls.length;
  click('toggle-follow');
  assert.equal(get('toggle-follow').getAttribute('aria-pressed'), 'false');
  click('gate-h');
  flushFrames();
  assert.equal(sphere.cameraCalls.length, previousCameraCalls, 'A gate leaves the camera alone when following is disabled');
  click('toggle-follow');
  assert.equal(get('toggle-follow').getAttribute('aria-pressed'), 'true');
  click('gate-t');
  flushFrames();
  assert.equal(sphere.cameraCalls.length, previousCameraCalls + 1);

  // Inspecting a gate ends target picking before the sphere can accept another
  // pick, keeping the current target and actual circuit unchanged.
  const beforePickingReviewTarget = [...sphere.model.target];
  const beforePickingReviewWord = displayedWord();
  click('pick-target');
  assert.equal(sphere.model.pickMode, true);
  await gateButtons()[0].dispatch('click');
  assert.equal(sphere.model.pickMode, false);
  assert.equal(get('pick-target').getAttribute('aria-pressed'), 'false');
  assert.equal(get('pick-target').disabled, true);
  assert.equal(get('review-controls').hidden, false);
  assert.equal(displayedWord(), beforePickingReviewWord);
  samePoint(sphere.model.target, beforePickingReviewTarget);
  click('resume-round');

  // Precision shrinks the current hole and starts another attempt, without
  // changing its target. It stops at the slider's minimum instead of looping.
  place(0, 0);
  epsilon(0.4);
  const precisionTarget = [...sphere.model.target];
  assert.equal(get('toggle-precision').getAttribute('aria-pressed'), 'false');
  click('toggle-precision');
  assert.equal(get('toggle-precision').getAttribute('aria-pressed'), 'true');
  assert.equal(get('epsilon').disabled, true);
  assert.equal(get('pick-target').disabled, true);
  epsilon(0.03);
  place(90, 90);
  click('new-hole');
  assert.equal(sphere.model.epsilon, 0.4, 'Precision keeps its difficulty fixed until the next win');
  samePoint(sphere.model.target, precisionTarget);
  let precisionRounds = 0;
  while (sphere.model.epsilon > 0.03) {
    assert.ok(precisionRounds++ < 20, 'Precision must reach its minimum in a bounded number of wins');
    click('gate-h');
    flushFrames();
    assert.equal(winning(), true);
    assert.equal(get('precision-next').hidden, false);
    assert.equal(get('precision-result').hidden, false);
    const oldEpsilon = sphere.model.epsilon;
    click(precisionRounds % 2 ? 'precision-result' : 'precision-next');
    assert.equal(dialog.open, false);
    assert.ok(sphere.model.epsilon < oldEpsilon);
    assert.ok(sphere.model.epsilon >= 0.03);
    assert.ok(Math.abs(sphere.model.epsilon / 0.005 - Math.round(sphere.model.epsilon / 0.005)) < 1e-10);
    assert.equal(strokes(), 0);
    samePoint(sphere.model.state, START_STATE);
    samePoint(sphere.model.target, precisionTarget);
  }
  assert.equal(sphere.model.epsilon, 0.03);
  click('gate-h');
  flushFrames();
  assert.equal(get('precision-next').hidden, true);
  assert.equal(get('precision-result').hidden, true);
  click('close-win');
  click('toggle-precision');
  assert.equal(get('toggle-precision').getAttribute('aria-pressed'), 'false');
});
