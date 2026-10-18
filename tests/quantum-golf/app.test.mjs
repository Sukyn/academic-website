import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { website, websiteFile } from '../../tools/quantum-golf/website.mjs';
import { expandGameControls } from '../games/markup.mjs';
import { replayWorkers } from '../games/replay-worker-fixture.mjs';
const { applyGate, traceDistance, START_STATE } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { dailyPuzzle, dailyBounds, dailyDate, DAILY_START, DAILY_TIME_ZONE } = await import(websiteFile('src/lib/quantum-golf/daily.js'));

test('campaign, random and daily rounds: scoring, replay, sharing, races and midnight rollover', async (context) => {
  const downloads = [];
  class MockElement {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.listeners = new Map();
      this.captureListeners = new Map();
      this.attrs = {};
      this.dataset = new Proxy({}, {
        get: (_, name) => this.attrs['data-' + name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())],
        set: (_, name, value) => { this.setAttribute('data-' + name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; },
      });
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
    addEventListener(name, callback, capture = false) {
      const listeners = capture === true ? this.captureListeners : this.listeners;
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    }
    dispatch(name, extra = {}) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...extra };
      const path = [this];
      if (name === 'click') {
        for (let parent = this.parentElement; parent; parent = parent.parentElement) path.push(parent);
      }
      const callbacks = [];
      if (name === 'click') for (const callback of globalThis.document.captureListeners.get(name) || []) {
        callbacks.push(callback(event));
        if (event.stopped) return Promise.all(callbacks);
      }
      for (const node of path) {
        event.currentTarget = node;
        for (const callback of node.listeners.get(name) || []) callbacks.push(callback(event));
      }
      const result = Promise.all(callbacks);
      if (name === 'cancel' && this.tagName === 'DIALOG' && !event.defaultPrevented) this.close();
      return result;
    }
    matches(selector) {
      const simple = (node, token) => {
        if (token.startsWith('#')) return node.getAttribute('id') === token.slice(1);
        if (token.startsWith('.')) return node.classList.contains(token.slice(1));
        const match = token.match(/^([a-z]+)?(?:\[([\w-]+)\])?$/i);
        return Boolean(match && (!match[1] || node.tagName === match[1].toUpperCase()) &&
          (!match[2] || node.getAttribute(match[2]) !== null));
      };
      return selector.split(',').some(part => {
        const tokens = part.trim().split(/\s+/);
        if (!simple(this, tokens.pop())) return false;
        let node = this.parentElement;
        while (tokens.length) {
          const token = tokens.pop();
          while (node && !simple(node, token)) node = node.parentElement;
          if (!node) return false;
          node = node.parentElement;
        }
        return true;
      });
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { delete this.attrs[name]; }
    get lastElementChild() { return this.children.at(-1) ?? null; }
    appendChild(child) {
      if (child.tagName === '#DOCUMENT-FRAGMENT') {
        for (const node of [...child.children]) this.appendChild(node);
        child.children = [];
      } else {
        child.remove();
        child.parentElement = this;
        this.children.push(child);
      }
      return child;
    }
    append(...children) { for (const child of children) this.appendChild(child); }
    remove() {
      const siblings = this.parentElement?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this._text = '';
      this.children = [];
      for (const child of children) this.appendChild(child);
    }
    get textContent() { return this._text + this.children.map((child) => child.textContent ?? child).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    showModal() { this.open = true; this.showCount++; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
    focus() {}
    select() { this.selected = true; }
    reportValidity() { return true; }
    querySelector(selector) {
      if (selector.startsWith('.')) {
        const descendants = [...this.children];
        while (descendants.length) {
          const node = descendants.shift();
          if (node.classList.contains(selector.slice(1))) return node;
          descendants.push(...node.children);
        }
        return null;
      }
      return submitButton;
    }
    click() {
      if (this.tagName === 'A') downloads.push({ href: this.href, download: this.download });
      return this.dispatch('click');
    }
  }

  // Expand the actual shared Astro templates so renamed or removed controls
  // still fail this controller test after presentation components are reused.
  let html = await readFile(new URL('src/pages/games/quantum-golf.astro', website), 'utf8');
  const component = async name => (await readFile(new URL(`src/components/games/${name}.astro`, website), 'utf8'))
    .replace(/^---[\s\S]*?---/, '');
  for (const name of ['GameModeMenu', 'GameToolbar', 'GameLeaderboard', 'GameJsonActions']) {
    html = html.replace(new RegExp(`<${name}\\b[^>]*\\/>`), await component(name));
  }
  html = await expandGameControls(html, component);
  const dialogs = html.match(/<GameDialogs\b[^>]*>([\s\S]*?)<\/GameDialogs>/);
  assert.ok(dialogs, 'Golf uses the shared result, rules and share overlays');
  const rules = dialogs[1].match(/<Fragment slot="rules">([\s\S]*?)<\/Fragment>/)?.[1] ?? '';
  const actions = dialogs[1].match(/<button slot="result-actions"[\s\S]*?<\/button>/)?.[0] ?? '';
  html = html.replace(dialogs[0], (await component('GameDialogs'))
    .replace('<GamePuzzleJsonDialog />', await component('GamePuzzleJsonDialog'))
    .replace('<slot name="rules" />', rules).replace('<slot name="result-actions" />', actions));
  html = await expandGameControls(html, component);
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
  assert.match(advancedMarkup[2], /\bid="share-score"/);
  assert.match(resultAdvancedMarkup[2], /\bid="share-result"/);
  assert.match(html, /id="share-dialog"[^>]*aria-labelledby="share-title"/);
  assert.doesNotMatch(html, /\bid="native-share-gif"/, 'The unused native share control is removed');
  const shareSource = await readFile(new URL('src/lib/games/replay-share.js', website), 'utf8');
  assert.doesNotMatch(shareSource, /navigator\.(?:share|canShare)\b/, 'Sharing does not invoke the native share API');
  for (const id of ['share-score', 'share-result', 'replay-actions', 'result-replay-actions']) {
    assert.equal([...html.matchAll(new RegExp(`\\bid="${id}"`, 'g'))].length, 1, `#${id} has a single instance`);
  }
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
    element.setAttribute('id', match[2]);
  }
  // Retain ID-bearing parents so moving one group updates the real controls.
  const ancestors = [];
  for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
    const tag = match[2].toLowerCase();
    if (match[1]) {
      const index = ancestors.findLastIndex(parent => parent.tag === tag);
      if (index >= 0) ancestors.length = index;
      continue;
    }
    const parent = ancestors.at(-1)?.node;
    const node = elements.get(match[3].match(/\bid="([^"]+)"/)?.[1]) ?? new MockElement(tag.toUpperCase());
    node.className = match[3].match(/\bclass="([^"]*)"/)?.[1] ?? '';
    if (parent) parent.appendChild(node);
    if (!['input', 'img', 'br', 'hr', 'link', 'meta'].includes(tag)) {
      ancestors.push({ tag, node });
    }
  }
  const get = (id) => {
    assert.ok(elements.has(id), `Real page must include #${id}`);
    return elements.get(id);
  };
  const submitButton = new MockElement('BUTTON');
  const body = new MockElement('BODY');
  const doc = new MockElement('DOCUMENT');
  doc.body = body;
  doc.documentElement = new MockElement('HTML');
  doc.getElementById = get;
  doc.querySelectorAll = selector => {
    const all = new Set(), visit = node => { if (all.has(node)) return; all.add(node); node.children.forEach(visit); };
    for (const node of elements.values()) visit(node);
    return [...all].filter(node => node.matches(selector));
  };
  doc.querySelector = selector => {
    if (selector === 'dialog[open]') return [...elements.values()].find(node => node.tagName === 'DIALOG' && node.open) ?? null;
    const [id, child] = selector.split(/\s+/);
    const node = get(id.slice(1));
    return child ? node.querySelector(child) : node;
  };
  let createdButtons = 0;
  doc.createElement = (tag) => {
    if (tag === 'button') createdButtons++;
    return new MockElement(tag.toUpperCase());
  };
  doc.createDocumentFragment = () => new MockElement('#DOCUMENT-FRAGMENT');
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  let reducedMotion = true;
  const browser = new MockElement('WINDOW');
  browser.location = { search: '' };
  browser.matchMedia = () => ({ matches: reducedMotion });
  globalThis.window = browser;
  let clipboardSupported = true, pngClipboardSupported = true, clipboardFailure = null, clipboardDelay = null;
  const clipboardWrites = [];
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  const mockNavigator = { clipboard: { write: async items => {
    clipboardWrites.push(items);
    if (clipboardFailure) throw clipboardFailure;
    if (clipboardDelay) await clipboardDelay;
  } } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockNavigator });
  globalThis.ClipboardItem = class {
    static supports(type) { return type === 'image/gif' ? clipboardSupported : type === 'image/png' && pngClipboardSupported; }
    constructor(items) { this.items = items; }
  };
  browser.navigator = mockNavigator;
  browser.ClipboardItem = globalThis.ClipboardItem;
  browser.isSecureContext = true;
  const nicknameStorage = new Map(), storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const localStorage = {
    getItem: key => nicknameStorage.get(key) ?? null,
    setItem: (key, value) => nicknameStorage.set(key, String(value)),
    removeItem: key => nicknameStorage.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
  browser.localStorage = localStorage;
  context.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
  });
  const originalComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ getPropertyValue: name => ({
    '--color-bg': '#18231e', '--color-text': '#ccd7ce', '--color-heading': '#edf4ee',
  })[name] ?? '' });
  const objectURLs = new Map(), revokedURLs = [];
  const originalCreateURL = URL.createObjectURL, originalRevokeURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => {
    assert.ok(blob instanceof Blob);
    const url = `blob:quantum-golf-${objectURLs.size + 1}`;
    objectURLs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = url => revokedURLs.push(url);
  const { ReplayWorker, gifs: gifRequests, images: imageRequests } = replayWorkers();
  context.after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    if (clipboardDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', clipboardDescriptor);
    else delete globalThis.ClipboardItem;
    URL.createObjectURL = originalCreateURL;
    URL.revokeObjectURL = originalRevokeURL;
    globalThis.getComputedStyle = originalComputedStyle;
  });
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
  globalThis.Worker = class extends ReplayWorker {
    constructor(url, options) {
      super(url, options); this.messages = [];
      this.exporting = url.pathname.endsWith('/quantum-golf-gif-worker.js');
      if (!this.exporting) workers.push(this);
    }
    postMessage(message) { if (this.exporting) super.postMessage(message); else this.messages.push(message); }
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
    .replace(/from (['"])(\.\.\/lib\/(?:quantum-golf|games)\/[^'"]+)\1/g, (_, _quote, path) => `from '${new URL(path, scriptURL).href}'`)
    .replace(/new URL\((['"])(\.\/quantum-golf(?:-gif)?-worker\.js)\1, import\.meta\.url\)/g, (_, _quote, path) => `new URL('${new URL(path, scriptURL).href}')`);
  await import(`data:text/javascript;base64,${Buffer.from(`${instrumented}\n//# sourceURL=${fileURLToPath(scriptURL)}`).toString('base64')}`);

  const click = (id) => get(id).dispatch('click');
  const strokes = () => sphere.model.sequence.length;
  const winning = () => get('status').textContent === 'In the hole!';
  const dialog = get('win-dialog');
  const rulesDialog = get('rules-dialog');
  const shareDialog = get('share-dialog');
  async function beginShare(id = 'share-score') {
    const before = gifRequests.length, imagesBefore = imageRequests.length;
    const completion = click(id);
    await settle();
    assert.equal(gifRequests.length, before, 'Opening sharing does not encode a GIF');
    assert.equal(imageRequests.length, imagesBefore + 1, 'Opening sharing renders a static final-state image');
    assert.equal(get('download-gif').disabled, false);
    assert.equal(get('share-preview').hidden, true);
    assert.equal(get('copy-gif').disabled, true);
    const image = imageRequests.at(-1);
    image.completion = completion;
    image.blob = new Blob([`Final image ${imagesBefore}: ${image.round.label}; ${image.round.sequence}`], { type: 'image/png' });
    return image;
  }
  async function startShare(id = 'share-score') {
    const before = gifRequests.length;
    const image = await beginShare(id);
    image.resolve(image.blob);
    await image.completion;
    await settle();
    assert.equal(gifRequests.length, before, 'Preparing the image never starts GIF generation');
    assert.equal(get('share-preview').hidden, false);
    assert.equal(objectURLs.get(get('share-preview').src), image.blob);
    assert.equal(get('copy-gif').textContent, 'Copy image');
    const pngCopyAvailable = Boolean(mockNavigator.clipboard && globalThis.ClipboardItem &&
      (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png')));
    assert.equal(get('copy-gif').disabled, !pngCopyAvailable, 'The static image can be copied before downloading a replay');
    const completion = click('download-gif');
    await settle();
    assert.equal(gifRequests.length, before + 1);
    const request = gifRequests.at(-1);
    assert.equal(request.round, image.round, 'Both exports use the same immutable round snapshot');
    assert.equal(request.worker.request.imageOnly, false, 'The animation does not render another static image');
    request.imageBlob = image.blob;
    request.completion = completion;
    return request;
  }
  async function completeShare(request, blob = new Blob(['GIF89a'], { type: 'image/gif' })) {
    request.resolve(blob);
    await request.completion;
    await settle();
    return blob;
  }
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

  assert.equal(get('mode-tutorial').getAttribute('aria-pressed'), 'true');
  assert.equal(get('tutorial-panel').hidden, false);
  assert.equal(get('leaderboard-section').hidden, true);
  assert.equal(get('campaign-controls').hidden, true);
  assert.equal(requests.length, 0, 'The default tutorial does not fetch leaderboards');
  assert.equal(workers.length, 0, 'The fixed walkthrough does not run a solver');
  click('gate-h'); click('restart');
  await doc.dispatch('keydown', { key: 't', target: get('sphere') });
  assert.equal(strokes(), 0, 'Manual controls cannot skip tutorial steps');
  assert.equal(frames.size, 0);
  await click('tutorial-start');
  assert.equal(get('gate-t').disabled, false);
  assert.equal(get('gate-h').disabled, true);
  assert.equal(get('gate-t').getAttribute('data-tutorial-focus'), '');
  const firstGuidedGate = click('gate-t'); flushFrames(); await firstGuidedGate; await settle();
  assert.equal(sphere.model.sequence, 'T', 'Clicking the highlighted gate advances exactly once');
  for (let step = 1; step < 10; step++) {
    const next = click('tutorial-next'); flushFrames(); await next;
  }
  assert.equal(sphere.model.sequence, 'THTHTHTTTT');
  samePoint(sphere.model.target, LEVELS[7].target);
  assert.equal(winning(), true);
  assert.equal(get('tutorial-heading').textContent, 'Tutorial complete');
  assert.equal(dialog.open, false, 'A guided win does not open the normal result popup');
  await get('score-form').dispatch('submit');
  assert.equal(requests.length, 0, 'Tutorial completion cannot fetch or submit a score');

  await click('tutorial-start');
  const tutorialDailyLoad = click('mode-daily'), tutorialDailyRequest = requests.at(-1);
  assert.match(tutorialDailyRequest.url, /^\/api\/daily\?/);
  assert.equal(get('tutorial-panel').hidden, false, 'The current guide stays visible while Daily loads');
  assert.equal(get('tutorial-next').disabled, true);
  assert.equal(get('tutorial-start').disabled, true);
  assert.equal(get('gate-t').disabled, true);
  await click('tutorial-next'); click('gate-t');
  assert.equal(strokes(), 0, 'Loading cannot silently skip a guided move');
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 10');
  await reply(tutorialDailyRequest, {}, 503); await tutorialDailyLoad;
  assert.equal(get('mode-tutorial').getAttribute('aria-pressed'), 'true');
  assert.equal(get('tutorial-panel').hidden, false);
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 10');
  assert.equal(get('tutorial-next').disabled, false);
  assert.equal(get('gate-t').disabled, false, 'A failed Daily request restores the same tutorial step');
  const resumedStep = click('tutorial-next'); flushFrames(); await resumedStep;
  assert.equal(sphere.model.sequence, 'T');
  reducedMotion = false;
  const movingStep = click('tutorial-next');
  const movingDailyLoad = click('mode-daily'), movingDailyRequest = requests.at(-1);
  assert.notEqual(movingDailyRequest, tutorialDailyRequest, 'Daily navigation remains usable during guided animation');
  await reply(movingDailyRequest, {}, 503); await movingDailyLoad;
  flushFrames(); await movingStep;
  assert.equal(sphere.model.sequence, 'TH');
  assert.equal(get('tutorial-heading').textContent, 'Step 3 of 10');
  assert.equal(get('tutorial-panel').hidden, false);
  assert.equal(requests.length, 2, 'Tutorial outage handling makes only the two requested Daily calls');
  assert.equal(workers.length, 0);
  // Start the normal-round request audit below with its own transport history.
  requests.length = 0;

  reducedMotion = false;
  await click('tutorial-start');
  const hiddenStep = click('tutorial-next'), hiddenFrame = frames.values().next().value;
  await browser.dispatch('pagehide');
  assert.equal(frames.size, 0);
  hiddenFrame(performance.now() + 1000); await hiddenStep;
  assert.equal(strokes(), 0, 'A cancelled animation cannot commit a tutorial gate');
  await browser.dispatch('pageshow', { persisted: true });
  assert.equal(get('mode-tutorial').getAttribute('aria-pressed'), 'true');
  assert.equal(get('tutorial-heading').textContent, 'Guided example');
  assert.equal(requests.length, 0, 'Returning to a tutorial still avoids score requests');
  await click('tutorial-start');
  const abandonedStep = click('tutorial-next'), abandonedFrame = frames.values().next().value;
  await click('mode-campaign');
  abandonedFrame(performance.now() + 1000); await abandonedStep;
  assert.equal(frames.size, 0);
  assert.equal(get('tutorial-panel').hidden, true);
  assert.equal(requests.length, 1, 'Entering Levels loads only the selected campaign leaderboard');
  reducedMotion = true;

  assert.equal(strokes(), 0);
  assert.equal(get('advanced-features').open, false);
  assert.equal(get('result-advanced-features').open, false);
  assert.equal(get('replay').textContent, 'See the replay');
  assert.equal(get('replay-result').textContent, 'See the replay');
  assert.equal(get('replay-actions').parentElement.classList.contains('advanced-panel'), true);
  assert.equal(get('result-replay-actions').parentElement, get('result-advanced-features'));
  assert.equal(get('daily-replay-actions').hidden, true);
  assert.equal(get('daily-result-actions').hidden, true);
  assert.equal(get('share-score').hidden, true);
  assert.equal(get('share-result').hidden, true);
  await click('share-score');
  assert.equal(gifRequests.length, 0, 'An unfinished circuit cannot be shared');
  assert.equal(get('mode-campaign').getAttribute('aria-pressed'), 'true');
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'false');
  assert.equal(get('mode-daily').getAttribute('aria-pressed'), 'false');
  assert.equal(get('campaign-controls').hidden, false);
  assert.equal(get('daily-heading').hidden, true);
  assert.equal(get('custom-json-actions').hidden, true);
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
  // Reset and Undo must replace a cancelled public ranking request, even if
  // the first response has not arrived and the player has never submitted.
  const initialBoard = requests[0];
  click('restart');
  const resetBoard = requests.at(-1);
  assert.notEqual(resetBoard, initialBoard);
  assert.equal(initialBoard.options.signal.aborted, true);
  click('gate-h'); flushFrames(); click('undo');
  const undoBoard = requests.at(-1);
  assert.notEqual(undoBoard, resetBoard);
  assert.equal(resetBoard.options.signal.aborted, true);
  await reply(initialBoard, board([player(1, 'Old initial ranks', 2)]));
  await reply(resetBoard, board([player(1, 'Old reset ranks', 2)]));
  assert.equal(get('leaderboard-body').children.length, 1, 'Late public ranks cannot replace the current request');
  assert.equal(strokes(), 0);
  samePoint(sphere.model.state, START_STATE);
  await reply(undoBoard, board([player(1, '<b>Ada</b>', 2)]));
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

  // Sharing is optional and local: it must not submit or mutate this attempt.
  assert.equal(get('share-score').hidden, false);
  assert.equal(get('share-result').hidden, false);
  const beforeSharingRequests = requests.length;
  const firstShare = await startShare('share-result');
  const firstSnapshot = firstShare.round;
  assert.equal(firstSnapshot.label, 'Level : 1');
  assert.equal(firstSnapshot.sequence, firstSolution);
  assert.equal(firstSnapshot.optimalMoves, 1);
  assert.deepEqual(firstSnapshot.target, LEVELS[0].target);
  assert.notEqual(firstSnapshot.target, sphere.model.target, 'The exporter receives its own target snapshot');
  assert.equal(firstSnapshot.epsilon, LEVELS[0].epsilon);
  assert.equal(firstShare.worker.terminated, false);
  assert.equal(firstShare.worker.request.imageOnly, false, 'GIF encoding is independent of the ready PNG preview');
  assert.equal(shareDialog.open, true);
  assert.equal(dialog.open, true, 'Closing sharing returns to the existing result popup');
  const beforeRepeatedShare = gifRequests.length;
  await click('share-score');
  assert.equal(gifRequests.length, beforeRepeatedShare, 'A repeated action cannot start another encoder in the open share dialog');
  assert.equal(get('copy-gif').disabled, false, 'The image remains copyable while its replay is being generated');
  assert.equal(get('download-gif').disabled, true);
  for (const key of ['h', 't', 'Backspace', 'r', 'n', 'ArrowLeft']) {
    await doc.dispatch('keydown', { key, target: key === 'ArrowLeft' ? get('sphere') : get('close-share') });
  }
  assert.equal(strokes(), 1);
  assert.equal(frames.size, 0);
  const sharedBlob = await completeShare(firstShare);
  assert.equal(get('share-status').textContent, '', 'A completed GIF has no extra helper text');
  const firstPreviewURL = get('share-preview').src, firstGifURL = downloads.at(-1).href;
  const firstGifFile = objectURLs.get(firstGifURL);
  assert.equal(objectURLs.get(firstPreviewURL), firstShare.imageBlob, 'The preview keeps the static final state after GIF generation');
  assert.notEqual(firstPreviewURL, firstGifURL);
  assert.equal(firstGifFile.type, 'image/gif');
  assert.deepEqual(await firstGifFile.arrayBuffer(), await sharedBlob.arrayBuffer());
  assert.equal(get('share-preview').hidden, false);
  assert.equal(downloads.at(-1).href, firstGifURL, 'The download starts as soon as encoding finishes');
  assert.match(downloads.at(-1).download, /level-1.*\.gif$/);
  assert.equal(get('download-gif').hidden, false);
  assert.equal(get('copy-gif').disabled, false);
  assert.equal(get('copy-gif').textContent, 'Copy the GIF', 'GIF-capable browsers keep the animated copy action');
  assert.equal(clipboardWrites.length, 0, 'GIF generation never writes the clipboard by itself');
  const firstCopy = click('copy-gif');
  assert.equal(clipboardWrites.length, 1);
  await firstCopy;
  assert.equal(clipboardWrites[0][0].items['image/gif'], firstGifFile, 'Copy uses the GIF itself');
  assert.equal(get('share-status').textContent, 'GIF copied.');
  assert.equal(requests.length, beforeSharingRequests, 'Sharing has no leaderboard side effect');
  assert.equal(sphere.model.sequence, firstSolution);
  samePoint(sphere.model.state, LEVELS[0].target);
  click('close-share');
  assert.equal(shareDialog.open, false);
  assert.equal(dialog.open, true);
  assert.ok(revokedURLs.includes(firstPreviewURL) && revokedURLs.includes(firstGifURL), 'Closing sharing releases both export URLs');

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
  for (const [status, message] of [
    [408, 'Submission timed out. Try again.'],
    [413, 'Submission is too large.'],
    [415, 'Send a JSON submission.'],
    [429, 'Too many submissions. Try again shortly.'],
  ]) {
    const limited = get('score-form').dispatch('submit');
    await reply(requests.at(-1), { error: message }, status);
    await limited;
    assert.equal(get('score-status').textContent, message);
    assert.equal(get('submit-score').disabled, false, `HTTP ${status} allows another attempt`);
    assert.equal(get('score-form').hidden, false);
    assert.equal(winning(), true);
    assert.equal(strokes(), firstSolution.length, 'Submission failures preserve the complete result');
  }
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
  assert.equal(nicknameStorage.get('games.nickname.v1'), 'Ada', 'The first validated registration remembers its canonical nickname.');
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
  const savedSequence = sphere.model.sequence, savedState = [...sphere.model.state];
  await browser.dispatch('pagehide');
  await browser.dispatch('pageshow', { persisted: true });
  const restoredBoard = requests.at(-1);
  assert.equal(new URL(restoredBoard.url, 'https://example.test').searchParams.get('player'), String(own.id));
  await reply(restoredBoard, board(windowEntries, own, 40));
  assert.equal(sphere.model.sequence, savedSequence, 'Restoring a saved round preserves its circuit');
  samePoint(sphere.model.state, savedState);
  assert.equal(dialog.open, true, 'Restoration preserves the result dialog');
  assert.equal(get('score-form').hidden, true, 'Restoration keeps a saved round submitted');
  click('try-again');
  assert.equal(dialog.open, false);
  assert.equal(winning(), false);
  assert.equal(strokes(), 0);
  samePoint(sphere.model.target, LEVELS[0].target);

  // A remembered nickname automatically registers the next solved attempt.
  // Closing its result while saving must leave it closed after success.
  finishLevel(0);
  const closedPost = requests.at(-1);
  assert.equal(closedPost.options.method, 'POST');
  assert.deepEqual(JSON.parse(closedPost.options.body), { level: 1, name: 'Ada', sequence: firstSolution });
  assert.equal(get('score-form').hidden, true, 'Automatic registration skips the repeated name form.');
  assert.equal(get('next-level').disabled, true);
  assert.equal(get('result-next').disabled, true, 'A pending registration cannot be skipped accidentally.');
  const beforeAutomaticDuplicate = requests.length;
  await get('score-form').dispatch('submit');
  click('show-results');
  assert.equal(requests.length, beforeAutomaticDuplicate, 'A pending automatic save cannot be posted twice.');
  click('close-win');
  assert.equal(dialog.open, false);
  const smallOwn = player(9, 'Ada');
  await reply(closedPost, board(Array.from({ length: 9 }, (_, index) => index === 8 ? smallOwn : player(index + 1)), smallOwn, 9));
  assert.equal(dialog.open, false, 'A completed save must not reopen a dialog the player closed');
  assert.equal(get('next-level').disabled, false);
  click('show-results');
  assert.equal(dialog.open, true);
  assert.equal(get('win-results').hidden, false);
  assert.deepEqual(displayedRanks('result-leaderboard-body'), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'Fewer than ten people displays everyone');
  const reopenedGet = requests.at(-1);
  assert.equal(new URL(reopenedGet.url, 'https://www.colin-blake.eu').searchParams.get('player'), '9', 'Reopening Scores asks for the submitted player context');

  // Reset while the personal leaderboard is loading. Its late response must
  // not restore the previous round's saved result or prevent another save.
  click('try-again');
  await click('nickname-forget');
  assert.equal(nicknameStorage.has('games.nickname.v1'), false, 'Forgetting restores manual registration on later wins.');
  assert.equal(reopenedGet.options.signal.aborted, true);
  await reply(reopenedGet, board([smallOwn], smallOwn, 9));

  finishLevel(0);
  assert.equal(get('score-form').hidden, false, 'A late personal GET cannot replace the next round\'s entry form');
  assert.equal(get('win-results').hidden, true);
  assert.equal(get('player-name').disabled, false);
  get('player-name').value = 'Ada';
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
  get('player-name').value = 'Ada';
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
  get('player-name').value = 'Ada';
  const finalSubmission = get('score-form').dispatch('submit');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { level: LEVELS.length, name: 'Ada', sequence: finalSolution });
  const finalPlayer = player(1, 'Ada', LEVELS.at(-1).optimalMoves);
  await reply(requests.at(-1), board([finalPlayer], finalPlayer));
  await finalSubmission;
  assert.equal(dialog.open, true);
  assert.equal(get('win-results').hidden, false);
  click('result-next');
  await click('nickname-forget');
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true', 'Completing the final campaign level leads to Random / Custom');
  assert.equal(get('campaign-controls').hidden, true);
  assert.equal(dialog.open, false, 'Next closes the finished campaign dialog');
  assert.equal(get('epsilon').disabled, false);
  assert.equal(get('free-controls').hidden, false);
  assert.equal(get('custom-json-actions').hidden, false);
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

  for (const data of [null, {}, { status: 'optimal', optimalMoves: NaN }, { status: 'optimal', optimalMoves: -1 },
    { status: 'limit', checkedDepth: NaN }, { status: 'unknown', checkedDepth: 2 }]) {
    click('new-hole');
    const search = workers.at(-1);
    assert.doesNotThrow(() => search.respond(data));
    assert.equal(search.terminated, true);
    assert.equal(get('best-count').textContent, 'Optimum unavailable', 'Malformed solver replies do not retain a pending label or invent a benchmark');
    assert.equal(get('gate-h').disabled, false);
  }
  for (const failure of ['onerror', 'onmessageerror']) {
    click('new-hole');
    const search = workers.at(-1);
    let prevented = false;
    search[failure]({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true, 'Worker failures are handled without a page error');
    assert.equal(search.terminated, true);
    assert.equal(get('best-count').textContent, 'Optimum unavailable');
    assert.equal(get('gate-h').disabled, false);
    search.respond({ status: 'optimal', optimalMoves: 99 });
    assert.equal(get('best-count').textContent, 'Optimum unavailable', 'A late reply cannot revive a failed solver');
  }

  // Custom JSON exchanges only target geometry and epsilon. Native overlays
  // suspend game shortcuts, and rejected imports leave the round unchanged.
  const jsonTarget = [...sphere.model.target], jsonEpsilon = sphere.model.epsilon;
  await click('share-json');
  assert.equal(get('puzzle-json-dialog').open, true);
  assert.equal(get('puzzle-json-text').readOnly, true);
  const exportedJson = JSON.parse(get('puzzle-json-text').value);
  assert.deepEqual(exportedJson, { target: jsonTarget, epsilon: jsonEpsilon });
  for (const key of ['h', 't', 'r', 'n', 'Backspace']) await doc.dispatch('keydown', { key, target: get('puzzle-json-close') });
  assert.equal(frames.size, 0);
  samePoint(sphere.model.target, jsonTarget);
  await click('puzzle-json-copy');
  assert.equal(get('puzzle-json-status').textContent, 'Copy the selected JSON.');
  assert.equal(get('puzzle-json-text').selected, true, 'Unavailable clipboard keeps the JSON manually copyable.');
  await click('puzzle-json-close');
  await click('input-json');
  assert.equal(get('puzzle-json-text').readOnly, false);
  for (const source of ['{', JSON.stringify({ target: [0, 1], epsilon: .2 }),
    JSON.stringify({ target: [0, 0, 0], epsilon: .2 }), JSON.stringify({ target: [0, 1, 0], epsilon: .8 })]) {
    get('puzzle-json-text').value = source;
    await get('puzzle-json-form').dispatch('submit');
    assert.equal(get('puzzle-json-dialog').open, true);
    assert.ok(get('puzzle-json-status').textContent);
    samePoint(sphere.model.target, jsonTarget);
    assert.equal(sphere.model.epsilon, jsonEpsilon);
  }
  get('puzzle-json-text').value = JSON.stringify({ target: [0, -2, 0], epsilon: .125 });
  await get('puzzle-json-form').dispatch('submit');
  assert.equal(get('puzzle-json-dialog').open, false);
  samePoint(sphere.model.target, [0, -1, 0]);
  samePoint(sphere.model.state, START_STATE);
  assert.equal(sphere.model.epsilon, .125);
  assert.equal(strokes(), 0);
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true');
  assert.equal(get('leaderboard-section').hidden, true);
  assert.equal(get('score-form').hidden, true);
  await click('share-json');
  assert.deepEqual(JSON.parse(get('puzzle-json-text').value), { target: [0, -1, 0], epsilon: .125 });
  await click('puzzle-json-close');

  // Busy handlers cannot queue gates, reset the round, or move its target.
  place(90, 270);
  const firstTarget = [...sphere.model.target];
  click('gate-h');
  assert.equal(get('gate-h').disabled, true);
  assert.equal(get('show-rules').disabled, true);
  click('show-rules');
  assert.equal(rulesDialog.open, false, 'An animation finishes before Rules can open');
  assert.equal(get('epsilon').disabled, true);
  assert.equal(get('share-json').disabled, true);
  assert.equal(get('input-json').disabled, true);
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
  assert.equal(get('share-score').hidden, true);
  assert.equal(get('share-result').hidden, true);
  const beforeRandomShare = gifRequests.length;
  await click('share-result');
  assert.equal(gifRequests.length, beforeRandomShare, 'Unranked custom holes do not produce ranked score cards');
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
  for (const modifier of ['ctrlKey', 'metaKey']) {
    doc.dispatch('keydown', { key: 'h', target: body }); flushFrames();
    doc.dispatch('keydown', { key: 'z', [modifier]: true, target: get('target-theta') });
    assert.equal(strokes(), 1, 'Undo shortcuts leave editable fields alone');
    doc.dispatch('keydown', { key: 'z', [modifier]: true, shiftKey: true, target: body });
    assert.equal(strokes(), 1, 'Redo is not interpreted as undo');
    doc.dispatch('keydown', { key: 'z', [modifier]: true, target: body });
    assert.equal(strokes(), 0, 'Ctrl/Cmd+Z uses the same undo action as the button');
  }

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

  // A first Daily request cancelled by navigation cannot leave the restored
  // page locked, even before daily metadata has ever been received.
  const beforeRestoreSequence = sphere.model.sequence, beforeRestoreTarget = [...sphere.model.target];
  const interruptedDailyLoad = click('mode-daily'), interruptedDaily = pendingDaily();
  const interruptedSearch = workers.at(-1);
  assert.equal(get('best-count').textContent, 'Finding optimum…');
  assert.equal(get('gate-h').disabled, true);
  await browser.dispatch('pagehide');
  assert.equal(interruptedDaily.options.signal.aborted, true);
  assert.equal(interruptedSearch.terminated, true);
  interruptedSearch.respond({ status: 'optimal', optimalMoves: 99 });
  assert.equal(get('best-count').textContent, 'Optimum unavailable', 'An interrupted search cannot keep a pending label or accept a late optimum');
  await browser.dispatch('pageshow', { persisted: true });
  assert.equal(get('best-count').textContent, 'Optimum unavailable');
  assert.equal(get('gate-h').disabled, false, 'A BFCache return unlocks the preserved round');
  assert.equal(get('restart').disabled, false);
  await reply(interruptedDaily, metadata('2026-10-14')); await interruptedDailyLoad;
  assert.equal(sphere.model.sequence, beforeRestoreSequence);
  samePoint(sphere.model.target, beforeRestoreTarget);
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true', 'A cancelled Daily selection cannot resurrect after returning');

  // The first Daily request can fail before a server clock or archive exists.
  const firstDailyLoad = click('mode-daily');
  await reply(pendingDaily(), {}, 503);
  await firstDailyLoad;
  const cancelledRetry = [...timers.values()].find(timer => timer.delay === 60_000);
  assert.ok(cancelledRetry, 'Initial outages schedule a retry without dailyInfo');
  click('mode-random');
  assert.equal(timers.has(cancelledRetry), false, 'Selecting another mode cancels delayed Daily navigation');
  const firstDailyRetry = click('mode-daily');
  await reply(pendingDaily(), {}, 503);
  await firstDailyRetry;
  const initialRetry = [...timers.values()].find(timer => timer.delay === 60_000);
  timers.delete(initialRetry);
  reducedMotion = false;
  click('gate-t');
  const beforeBusyRetry = requests.length;
  initialRetry.callback();
  assert.equal(requests.length, beforeBusyRetry, 'A scheduled Daily retry waits for an active gate');
  const deferredRetry = [...timers.values()].find(timer => timer.delay === 1_000);
  assert.ok(deferredRetry);
  flushFrames();
  reducedMotion = true;
  timers.delete(deferredRetry);
  const recovering = deferredRetry.callback();
  assert.ok(pendingDaily(), 'The retry makes a request even before dailyInfo exists');
  await reply(pendingDaily(), metadata('2026-10-14'));
  await recovering;
  assert.equal(get('mode-daily').getAttribute('aria-pressed'), 'true', 'Recovery selects the originally requested Daily puzzle');
  click('mode-random');

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
  assert.equal(get('replay-actions').parentElement, get('daily-replay-actions'));
  assert.equal(get('result-replay-actions').parentElement, get('daily-result-actions'));
  assert.equal(get('daily-replay-actions').hidden, false, 'Daily replay controls are outside Advanced');
  assert.equal(get('daily-result-actions').hidden, false);
  assert.equal(get('result-advanced-features').hidden, true, 'Daily results do not have an empty Advanced disclosure');
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
  assert.equal(get('share-result').hidden, false, 'Past daily attempts can be shared without entering their closed leaderboard');
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
  clipboardSupported = false;
  const dailyShare = await startShare('share-result');
  assert.equal(dailyShare.round.label, 'Daily puzzle : 14 Oct 2026');
  assert.equal(dailyShare.round.sequence, dailySolution);
  assert.equal(dailyShare.round.optimalMoves, dailyPuzzle(today).optimalMoves);
  dailyShare.progress(0.5);
  assert.ok(get('share-status').textContent);
  const dailyBlob = await completeShare(dailyShare);
  assert.equal(get('share-status').textContent, '', 'An unsupported GIF clipboard also leaves the ready card without helper text');
  assert.equal(get('copy-gif').disabled, false, 'Browsers without GIF clipboard support can copy the final traced image');
  assert.equal(get('copy-gif').textContent, 'Copy image');
  assert.equal(get('download-gif').hidden, false);
  assert.match(downloads.at(-1).download, /2026-10-14.*\.gif$/);
  const copiesBeforeUnsupported = clipboardWrites.length;
  const finalImageCopy = click('copy-gif');
  assert.equal(clipboardWrites.length, copiesBeforeUnsupported + 1, 'The clipboard write begins within the button gesture');
  await finalImageCopy;
  const dailyImage = clipboardWrites.at(-1)[0].items['image/png'];
  assert.equal(dailyImage, dailyShare.imageBlob, 'Copy image uses the PNG prepared when sharing opened');
  assert.deepEqual(await dailyImage.arrayBuffer(), await dailyShare.imageBlob.arrayBuffer());
  assert.equal(clipboardWrites.at(-1)[0].items['image/gif'], undefined);
  assert.equal(get('share-status').textContent, 'Image copied.');
  clipboardFailure = new DOMException('Image clipboard permission denied', 'NotAllowedError');
  await click('copy-gif');
  assert.doesNotMatch(get('share-status').textContent, /copied/i);
  assert.match(get('share-status').textContent, /download/i, 'Image clipboard failure leaves the animation downloadable');
  clipboardFailure = null;
  const dailyPreviewURL = get('share-preview').src, dailyGifURL = downloads.at(-1).href;
  assert.notEqual(dailyPreviewURL, dailyGifURL, 'Image-copy previews show the final state while the download remains animated');
  assert.equal(objectURLs.get(dailyPreviewURL), dailyShare.imageBlob, 'The preview displays exactly the image being copied');
  const dailyGifFile = objectURLs.get(dailyGifURL);
  assert.equal(dailyGifFile.type, 'image/gif', 'The downloadable animation remains a GIF when copying uses PNG');
  assert.deepEqual(await dailyGifFile.arrayBuffer(), await dailyBlob.arrayBuffer());
  get('download-gif').click();
  assert.equal(downloads.at(-1).href, dailyGifURL);
  assert.equal(gifRequests.at(-1), dailyShare, 'Another download reuses the completed GIF');
  click('close-share');
  assert.ok(revokedURLs.includes(dailyPreviewURL) && revokedURLs.includes(dailyGifURL), 'Closing releases the separate PNG preview and GIF download');

  // Engines without the optional MIME capability probe use PNG, the standard
  // image clipboard format, and do not assume that animated GIFs are accepted.
  const supports = ClipboardItem.supports;
  delete ClipboardItem.supports;
  const unprobedShare = await startShare('share-result');
  await completeShare(unprobedShare);
  assert.equal(get('copy-gif').textContent, 'Copy image');
  assert.equal(get('copy-gif').disabled, false);
  await click('copy-gif');
  assert.equal(clipboardWrites.at(-1)[0].items['image/png'], unprobedShare.imageBlob);
  click('close-share');
  ClipboardItem.supports = supports;

  pngClipboardSupported = false;
  const noImageClipboardShare = await startShare('share-result');
  assert.equal(noImageClipboardShare.worker.request.imageOnly, false);
  await completeShare(noImageClipboardShare);
  assert.equal(get('copy-gif').disabled, true, 'Unsupported image formats leave the GIF download available');
  const copiesBeforeNoImage = clipboardWrites.length;
  await click('copy-gif');
  assert.equal(clipboardWrites.length, copiesBeforeNoImage);
  assert.equal(get('download-gif').hidden, false);
  click('close-share');
  pngClipboardSupported = true;

  const clipboard = mockNavigator.clipboard;
  delete mockNavigator.clipboard;
  const noClipboardShare = await startShare('share-result');
  assert.equal(noClipboardShare.worker.request.imageOnly, false);
  await completeShare(noClipboardShare);
  assert.equal(get('copy-gif').disabled, true, 'Clipboard API absence does not create a broken copy action');
  await click('copy-gif');
  assert.equal(clipboardWrites.length, copiesBeforeNoImage);
  assert.equal(get('download-gif').hidden, false);
  click('close-share');
  mockNavigator.clipboard = clipboard;

  delete globalThis.ClipboardItem;
  const noClipboardItemShare = await startShare('share-result');
  assert.equal(noClipboardItemShare.worker.request.imageOnly, false);
  await completeShare(noClipboardItemShare);
  assert.equal(get('copy-gif').disabled, true, 'Missing ClipboardItem also disables copying without breaking the export');
  await click('copy-gif');
  assert.equal(clipboardWrites.length, copiesBeforeNoImage);
  assert.equal(get('download-gif').hidden, false);
  click('close-share');
  globalThis.ClipboardItem = browser.ClipboardItem;

  clipboardSupported = true;
  get('player-name').value = 'Ada';
  const dailySubmission = get('score-form').dispatch('submit');
  const dailyPost = requests.at(-1);
  assert.deepEqual(JSON.parse(dailyPost.options.body), { date: today, name: 'Ada', sequence: dailySolution });
  const dailyPlayer = player(1, 'Ada', dailyPuzzle(today).optimalMoves);
  await reply(dailyPost, board([dailyPlayer], dailyPlayer), 201);
  await dailySubmission;
  assert.equal(get('win-results').hidden, false);
  assert.equal(get('nickname-form').hidden, false);
  assert.equal(get('nickname-value').value, 'Ada');
  assert.equal(get('result-advanced-features').hidden, false, 'Daily results keep saved nickname management accessible.');
  assert.equal(get('replay-actions').parentElement, get('daily-replay-actions'));
  assert.equal(get('result-replay-actions').parentElement, get('daily-result-actions'), 'Daily replay actions stay outside nickname management.');
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
  get('result-advanced-features').open = true;
  await click('nickname-forget');
  assert.equal(get('nickname-form').hidden, true);
  assert.equal(get('result-advanced-features').hidden, true, 'Daily Advanced can hide once its saved nickname is forgotten.');
  assert.equal(get('result-replay-actions').parentElement, get('daily-result-actions'));
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
  assert.equal(get('result-replay-actions').parentElement, get('result-advanced-features'));
  assert.equal(get('result-advanced-features').hidden, false);
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
  const outageRetry = [...timers.values()].find(timer => timer.delay === 60_000);
  click('mode-campaign');
  assert.equal(timers.has(outageRetry), false);
  get('daily-date').value = '2026-10-13';
  const archivedOutage = get('daily-date').dispatch('change');
  await reply(pendingDaily(), {}, 503);
  await archivedOutage;
  const archivedRetry = [...timers.values()].find(timer => timer.delay === 60_000);
  timers.delete(archivedRetry);
  const recoveringArchive = archivedRetry.callback();
  assert.equal(new URL(pendingDaily().url, 'https://www.colin-blake.eu').searchParams.get('date'), '2026-10-13', 'Retries preserve the requested archive date');
  await reply(pendingDaily(), metadata('2026-10-13', rolloverAt + 100));
  await recoveringArchive;
  assert.match(get('daily-title').textContent, /13 Oct 2026/);
  assert.match(get('daily-note').textContent, /Practice.*closed/);

  // Reviewing and replaying a finished round never changes the circuit being
  // scored, even when the leaderboard returns an earlier, better personal score.
  await click('nickname-forget');
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

  // Sharing an inspected attempt exports its full circuit and this attempt's
  // score, while leaving the sphere, review position and saved board intact.
  click('close-win');
  await click('nickname-forget');
  await gateButtons()[2].dispatch('click');
  const inspectedPoint = [...sphere.model.state];
  const inspectedBoard = get('result-leaderboard-body').textContent;
  const reviewedShare = await startShare();
  assert.equal(reviewedShare.round.label, 'Level : 2');
  assert.equal(reviewedShare.round.sequence, reviewedWord);
  assert.equal(reviewedShare.round.optimalMoves, 1);
  assert.equal(dialog.open, false);
  for (const key of ['h', 't', 'Backspace', 'r', 'n', 'ArrowLeft']) {
    await doc.dispatch('keydown', { key, target: key === 'ArrowLeft' ? get('sphere') : get('close-share') });
  }
  assert.equal(frames.size, 0, 'Sharing blocks the game shortcuts even with the result popup closed');
  assert.equal(sphere.model.sequence, reviewedWord.slice(0, 3));
  samePoint(sphere.model.state, inspectedPoint);
  await completeShare(reviewedShare);
  clipboardFailure = new DOMException('Clipboard permission denied', 'NotAllowedError');
  await click('copy-gif');
  assert.doesNotMatch(get('share-status').textContent, /copied/i);
  assert.match(get('share-status').textContent, /download/i, 'A rejected clipboard operation keeps a usable download');
  assert.equal(get('download-gif').hidden, false);
  clipboardFailure = null;
  click('close-share');
  assert.equal(get('result-leaderboard-body').textContent, inspectedBoard);
  assert.equal(get('review-note').textContent, 'Step 3 / 9');
  assert.equal(sphere.model.sequence, reviewedWord.slice(0, 3));
  samePoint(sphere.model.state, inspectedPoint);

  const failedShare = await startShare();
  failedShare.reject(new Error('Encoder failed'));
  await failedShare.completion;
  assert.equal(get('copy-gif').disabled, false, 'A failed animation leaves the static image copyable');
  assert.equal(objectURLs.get(get('share-preview').src), failedShare.imageBlob);
  assert.equal(get('download-gif').disabled, false, 'A failed export can be retried without closing');
  assert.match(get('share-status').textContent, /could|failed|unable|unavailable/i);
  click('close-share');

  clipboardSupported = false;
  const cancelledImage = await beginShare();
  click('close-share');
  assert.equal(cancelledImage.worker.terminated, true);
  const cancelledShare = await startShare();
  const URLsBeforeStaleImage = objectURLs.size;
  cancelledImage.resolve(cancelledImage.blob);
  await cancelledImage.completion;
  assert.equal(objectURLs.size, URLsBeforeStaleImage, 'A cancelled image render cannot replace a later preview');
  assert.equal(objectURLs.get(get('share-preview').src), cancelledShare.imageBlob);
  click('close-share');
  assert.equal(cancelledShare.worker.terminated, true);
  const replacementShare = await startShare();
  const replacementStatus = get('share-status').textContent;
  cancelledShare.progress(0.9);
  assert.equal(get('share-status').textContent, replacementStatus, 'Old progress cannot overwrite a later export');
  const URLsBeforeStaleExport = objectURLs.size;
  await completeShare(cancelledShare);
  assert.equal(objectURLs.size, URLsBeforeStaleExport, 'Cancelled generation cannot allocate a stale preview');
  assert.equal(get('copy-gif').disabled, false, 'A cancelled animation cannot disable the replacement image');
  const replacementBlob = await completeShare(replacementShare);
  assert.equal(objectURLs.get(get('share-preview').src), replacementShare.imageBlob);
  assert.deepEqual(await objectURLs.get(downloads.at(-1).href).arrayBuffer(), await replacementBlob.arrayBuffer());
  let finishPendingCopy;
  clipboardDelay = new Promise(resolve => { finishPendingCopy = resolve; });
  const pendingCopy = click('copy-gif');
  assert.equal(clipboardWrites.at(-1)[0].items['image/png'], replacementShare.imageBlob, 'A cancelled export cannot replace the current snapshot');
  click('close-share');
  const laterShare = await startShare();
  await completeShare(laterShare);
  const laterStatus = get('share-status').textContent;
  finishPendingCopy();
  await pendingCopy;
  clipboardDelay = null;
  assert.equal(get('share-status').textContent, laterStatus, 'A previous clipboard completion cannot update another export');
  click('close-share');
  clipboardSupported = true;
  const escapedShare = await startShare();
  const URLsBeforeEscape = objectURLs.size;
  await shareDialog.dispatch('cancel');
  assert.equal(shareDialog.open, false);
  assert.equal(escapedShare.worker.terminated, true, 'The native Escape close aborts encoding too');
  await completeShare(escapedShare);
  assert.equal(objectURLs.size, URLsBeforeEscape);
  click('show-results');
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

  // Reset and mode changes abort local encoding before a stale result can
  // become the next round's preview or clipboard contents.
  selectLevel(1);
  finishLevel(0);
  clipboardSupported = false;
  const readyResetShare = await startShare();
  await completeShare(readyResetShare);
  const resetPreviewURL = get('share-preview').src, resetGifURL = downloads.at(-1).href;
  assert.notEqual(resetPreviewURL, resetGifURL);
  click('restart');
  assert.equal(shareDialog.open, false);
  assert.ok(revokedURLs.includes(resetPreviewURL) && revokedURLs.includes(resetGifURL), 'Reset releases both completed export URLs');
  clipboardSupported = true;
  finishLevel(0);
  const resetShare = await startShare();
  const URLsBeforeReset = objectURLs.size;
  click('restart');
  assert.equal(resetShare.worker.terminated, true);
  assert.equal(shareDialog.open, false);
  await completeShare(resetShare);
  assert.equal(objectURLs.size, URLsBeforeReset);
  assert.equal(strokes(), 0);
  assert.equal(winning(), false);
  finishLevel(0);
  const modeShare = await startShare();
  const URLsBeforeModeChange = objectURLs.size;
  click('mode-random');
  assert.equal(modeShare.worker.terminated, true);
  assert.equal(shareDialog.open, false);
  await completeShare(modeShare);
  assert.equal(objectURLs.size, URLsBeforeModeChange);
  assert.equal(get('mode-random').getAttribute('aria-pressed'), 'true');
  assert.equal(winning(), false);

  // Long rounds create one node per gate, preserve earlier controls, and undo
  // only the final node. H pairs keep this campaign target outside the hole.
  selectLevel(1);
  const beforeLongRound = createdButtons;
  click('gate-h');
  flushFrames();
  const firstGateButton = get('sequence').children[0];
  for (let move = 1; move < 1358; move++) {
    click('gate-h');
    flushFrames();
    assert.equal(get('sequence').children[0], firstGateButton, 'Appending a gate preserves existing controls');
  }
  assert.equal(strokes(), 1358);
  assert.equal(createdButtons - beforeLongRound, 1358);
  assert.equal(get('sequence').children.at(-1).getAttribute('data-step'), '1358');
  assert.equal(get('sequence').children.at(-1).getAttribute('aria-label'), 'Step 1358: H');
  assert.equal(get('sequence').listeners.get('click').length, 1, 'A single listener handles the whole gate sequence');
  assert.ok(get('sequence').children.every(button => !button.listeners.has('click')), 'Long circuits do not allocate a listener per gate');
  await get('sequence').dispatch('click');
  firstGateButton.disabled = true;
  await firstGateButton.dispatch('click');
  assert.equal(get('review-controls').hidden, true, 'Background and disabled-button clicks do not inspect a step');
  firstGateButton.disabled = false;
  const nested = new MockElement('BUTTON'), wrapper = new MockElement('DIV');
  nested.setAttribute('data-step', '1');
  wrapper.appendChild(nested);
  get('sequence').appendChild(wrapper);
  await nested.dispatch('click');
  assert.equal(get('review-controls').hidden, true, 'Nested unrelated buttons are not gate controls');
  wrapper.remove();
  const decoration = new MockElement('SPAN');
  firstGateButton.appendChild(decoration);
  await decoration.dispatch('click');
  assert.equal(get('review-note').textContent, 'Step 1 / 1358', 'Clicks on button contents inspect the owning gate');
  samePoint(sphere.model.state, applyGate(START_STATE, 'H'));
  decoration.remove();
  click('resume-round');
  click('undo');
  assert.equal(get('sequence').children.length, 1357);
  assert.equal(get('sequence').children[0], firstGateButton);
  click('restart');
  assert.equal(get('sequence').children.length, 0);

  // A nickname saved in another game is refreshed without storing player IDs.
  nicknameStorage.set('games.nickname.v1', '  Grace  ');
  click('restart');
  assert.equal(get('nickname-value').value, 'Grace');
  get('nickname-value').value = '  Emmy   Noether  ';
  await get('nickname-form').dispatch('submit');
  assert.equal(nicknameStorage.get('games.nickname.v1'), 'Emmy Noether');
  assert.equal(get('nickname-status').textContent, 'Nickname saved.');
  selectLevel(2);
  const editedWord = finishLevel(1), automaticPost = requests.at(-1);
  assert.deepEqual(JSON.parse(automaticPost.options.body), { level: 2, name: 'Emmy Noether', sequence: editedWord });
  assert.equal(get('score-form').hidden, true);
  assert.equal(get('next-level').disabled, true);
  await reply(automaticPost, { error: 'Unavailable' }, 503);
  assert.equal(get('score-form').hidden, false, 'Failed automatic registration restores a manual retry.');
  assert.equal(get('player-name').value, 'Emmy Noether');
  assert.equal(get('submit-score').disabled, false);
  const afterAutomaticFailure = requests.length;
  click('close-win'); click('show-results');
  assert.equal(requests.length, afterAutomaticFailure, 'Reopening a failed result does not create a retry loop.');
  const manualRetry = get('score-form').dispatch('submit'), retryPost = requests.at(-1);
  assert.deepEqual(JSON.parse(retryPost.options.body), { level: 2, name: 'Emmy Noether', sequence: editedWord });
  const rememberedPlayer = player(1, 'Emmy Noether', editedWord.length);
  await reply(retryPost, board([rememberedPlayer], rememberedPlayer)); await manualRetry;
  assert.equal(get('next-level').disabled, false);
  click('try-again'); finishLevel(1);
  const forgottenPost = requests.at(-1);
  get('result-advanced-features').open = true;
  await click('nickname-forget');
  assert.equal(nicknameStorage.has('games.nickname.v1'), false);
  await reply(forgottenPost, board([rememberedPlayer], rememberedPlayer));
  assert.equal(nicknameStorage.has('games.nickname.v1'), false, 'Late success cannot remember a forgotten nickname.');
  click('try-again'); finishLevel(1);
  assert.equal(get('score-form').hidden, false);
  assert.equal(get('player-name').value, '');
  assert.equal(requests.at(-1).options.method, undefined, 'A forgotten identity leaves the next win unregistered.');

  await click('mode-tutorial'); await click('tutorial-start');
  reducedMotion = false;
  const switchedStep = click('tutorial-next'), switchedFrame = frames.values().next().value;
  await loadPuzzle('2026-10-14', Date.parse('2026-10-14T12:00:00Z'), true);
  switchedFrame(performance.now() + 1000); await switchedStep;
  assert.equal(get('mode-daily').getAttribute('aria-pressed'), 'true');
  assert.equal(get('tutorial-panel').hidden, true, 'Only a valid Daily response leaves the guide');
  assert.equal(strokes(), 0, 'Successful Daily selection cancels the pending tutorial animation');
  samePoint(sphere.model.state, START_STATE);
});
