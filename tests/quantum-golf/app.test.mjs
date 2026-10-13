import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { website, websiteFile } from '../../tools/quantum-golf/website.mjs';
const { applyGate, traceDistance, START_STATE } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));

test('campaign ranking and infinite rounds: fixed holes, server scores, solver races and gameplay', async (context) => {
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
    setAttribute(name, value) { this.attrs[name] = value; }
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
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new MockElement(match[1].toUpperCase());
    element.value = match[0].match(/\bvalue="([^"]+)"/)?.[1] || '';
    element.textContent = html.slice(match.index + match[0].length).match(/^([^<]*)</)?.[1].trim() || '';
    element.hidden = /\bhidden\b/.test(match[0]);
    element.disabled = /\bdisabled\b/.test(match[0]);
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
  globalThis.document = doc;
  let reducedMotion = true;
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
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
    constructor(_canvas, options) { this.model = { showTrace: true }; this.options = options; sphere = this; }
    setState(next) { this.model = { ...this.model, ...next }; }
    cameraTo(point) {
      this.cameraTarget = point;
      this.cameraFrames = [];
      return progress => this.cameraFrames.push(progress);
    }
    rotateBy() {}
  };

  const scriptURL = new URL('src/scripts/quantum-golf.js', website);
  const original = await readFile(scriptURL, 'utf8');
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
  function finishLevel(index) {
    const hole = LEVELS[index];
    // Offline campaign verification can exceed the interactive worker budget.
    const solution = solveShortest(hole.target, hole.epsilon, { maxDepth: hole.optimalMoves, maxNodes: 2_000_000 });
    assert.equal(solution.status, 'optimal');
    for (const gate of solution.sequence) {
      click(`gate-${gate.toLowerCase()}`);
      flushFrames();
    }
    return solution.sequence;
  }

  assert.equal(strokes(), 0);
  assert.equal(winning(), false);
  samePoint(sphere.model.state, START_STATE);
  assert.equal(get('toggle-trace').getAttribute('aria-pressed'), 'true');
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
  assert.equal(get('next-level').disabled, false);
  const finalSubmission = get('score-form').dispatch('submit');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { level: LEVELS.length, name: 'Ada', sequence: finalSolution });
  const finalPlayer = player(1, 'Ada', LEVELS.at(-1).optimalMoves);
  await reply(requests.at(-1), board([finalPlayer], finalPlayer));
  await finalSubmission;
  assert.equal(dialog.open, true);
  assert.equal(get('win-results').hidden, false);
  click('result-next');
  assert.equal(get('level').value, 'infinite', 'Completing the final campaign level leads to Infinite mode');
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
  assert.equal(get('level').value, 'infinite', 'A busy gate cannot switch campaign mode');
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
  assert.equal(dialog.open, false, 'Infinite-mode wins do not open the campaign nickname dialog');
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
  assert.equal(get('sequence').textContent, 'T T');

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
});
