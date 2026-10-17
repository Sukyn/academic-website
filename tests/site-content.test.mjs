import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
async function moduleSource(path) {
  const url = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier) =>
    `from ${JSON.stringify(specifier.startsWith('.') ? new URL(`${specifier}.ts`, url).href : import.meta.resolve(specifier))}`);
}
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const bibtexModule = dataUrl(await moduleSource('../src/lib/bibtex.ts'));
const { parseBibtexToPubs } = await import(bibtexModule);
const { renderInlineMath } = await import(dataUrl(await moduleSource('../src/lib/inlineMath.ts')));
const { webUrl } = await import('../src/lib/links.ts');

test('the actual bibliography preserves exact citations and case-insensitive metadata', async () => {
  const source = await read('../src/content/publications.bibtex');
  const pubs = parseBibtexToPubs(source);
  assert.equal(pubs.length, 3);
  for (const pub of pubs) {
    assert.equal(pub.year, 2026);
    assert.equal(pub.authors, 'Colin Blake');
    assert(pub.citation.startsWith('@'));
    assert(source.includes(pub.citation));
    assert.equal(parseBibtexToPubs(pub.citation)[0].id, pub.id);
    assert.equal(pub.url, webUrl(pub.url));
  }
});

test('bibliography formatting keeps organisations, suffixes, nested titles, and stable year order', () => {
  const pubs = parseBibtexToPubs(`
@COMMENT{Cataloguing note}
@PREAMBLE{"Ignored metadata"}
@article{older, TITLE={{{Nested Title}}}, AUTHOR={{Research, Science and Development} and Blake, Jr., Colin and Last, First}, YEAR={2024}, JOURNAL={Journal}, URL={javascript:alert(1)}}
@misc{unknown, title={Undated}, year={not-a-number}}
@article{newer, title={New}, year={2026}, doi={10.1234/example}}
@article{same-year, title={Same}, year={2026}}
`);
  assert.deepEqual(pubs.map(pub => pub.id), ['newer', 'same-year', 'older', 'unknown']);
  assert.equal(pubs[2].title, 'Nested Title');
  assert.equal(pubs[2].authors, 'Research, Science and Development, Colin Blake, Jr., First Last');
  assert.equal(pubs[2].venue, 'Journal');
  assert.equal(pubs[2].url, undefined);
  assert.equal(pubs[0].url, 'https://doi.org/10.1234/example');
  assert.equal(pubs[3].year, undefined);
});

test('malformed and trailing-comment bibliography inputs terminate and report clear errors', () => {
  // Keep the dependency's historic end-of-comment infinite-loop regression bounded.
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { parseBibtexToPubs } = await import(${JSON.stringify(bibtexModule)});
    assert.equal(parseBibtexToPubs('@misc{a,title={A}}% trailing comment').length, 1);
    for (const input of ['@article{broken', '@article{a,title={unterminated}', '@article{a,title="unterminated}', '@STRING{foo={bar}}']) {
      assert.throws(() => parseBibtexToPubs(input), /Invalid publication BibTeX/);
    }
  `], { timeout: 6000, encoding: 'utf8' });
  assert.ifError(probe.error);
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(parseBibtexToPubs(''), []);
});

test('publication web links reject executable schemes, credentials, malformed URLs, and controls', () => {
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', '//example.org', 'https://', 'https://user:pass@example.org', 'https://exa\nmple.org']) {
    assert.equal(webUrl(unsafe), undefined, unsafe);
  }
  assert.equal(webUrl(' https://example.org/paper?x=1&y=2#cite '), 'https://example.org/paper?x=1&y=2#cite');
  assert.equal(webUrl('http://example.org'), 'http://example.org');
  assert.equal(webUrl(), undefined);
});

test('inline math escapes text, handles three delimiter styles, and exposes MathML', () => {
  assert.equal(renderInlineMath('<img src=x onerror="alert(1)"> & \'text\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;');
  for (const input of ['$x^2$', '$$x^2$$', '\\(x^2\\)']) {
    const result = renderInlineMath(input);
    assert(result.includes('katex-html'));
    assert(result.includes('katex-mathml'));
    assert(result.includes('<math'));
  }
  assert.equal(renderInlineMath('Cost \\$5; unfinished $x & y'), 'Cost $5; unfinished $x &amp; y');
  assert.equal(renderInlineMath('Text \\(unfinished'), 'Text \\(unfinished');
  assert.equal(renderInlineMath('empty $$ $$'), 'empty ');
  assert.equal(renderInlineMath(''), '');
});

test('hostile and malformed inline math stays inert without throwing', () => {
  for (const input of ['$\\href{javascript:alert(1)}{click}$', '$\\htmlClass{evil}{x}$', '$\\unknowncommand{x}$', '$\\frac{$', '$<script>alert(1)</script>$']) {
    const result = renderInlineMath(input);
    assert(!/<script\b/i.test(result));
    assert(!/href=["']javascript:/i.test(result));
    assert(!/class=["']evil["']/i.test(result));
  }
  const result = renderInlineMath(`${'plain <&> '.repeat(10_000)}$x$ ending`);
  assert.equal((result.match(/katex-html/g) ?? []).length, 1);
  assert(result.endsWith(' ending'));
});

function events(object = {}) {
  const handlers = new Map();
  return Object.assign(object, {
    addEventListener(name, callback, options = {}) {
      const entries = handlers.get(name) ?? [];
      entries.push({ callback, once: options.once });
      handlers.set(name, entries);
    },
    removeEventListener(name, callback) {
      handlers.set(name, (handlers.get(name) ?? []).filter(entry => entry.callback !== callback));
    },
    emit(name, event = {}) {
      for (const entry of [...(handlers.get(name) ?? [])]) {
        if (entry.once) this.removeEventListener(name, entry.callback);
        entry.callback({ type: name, ...event });
      }
    },
    listenerCount(name) { return (handlers.get(name) ?? []).length; },
  });
}

test('shared content dialogs open nested triggers and close only on a close button or backdrop', async () => {
  class Element {
    constructor(attributes = {}, parent = null) { this.attributes = attributes; this.parent = parent; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    closest(selector) {
      if (selector === 'dialog' && this instanceof Dialog) return this;
      if (selector.startsWith('[') && Object.hasOwn(this.attributes, selector.slice(1, -1))) return this;
      return this.parent?.closest(selector) ?? null;
    }
  }
  class HTMLElement extends Element {}
  class Dialog extends HTMLElement {
    open = false;
    openCount = 0;
    showModal() { this.open = true; this.openCount += 1; }
    close() { this.open = false; }
    getBoundingClientRect() { return { left: 10, right: 100, top: 10, bottom: 100 }; }
  }
  const dialog = new Dialog();
  const trigger = new HTMLElement({ 'data-content-dialog': 'detail' });
  const child = new Element({}, trigger);
  const document = events({ getElementById: id => id === 'detail-dialog' ? dialog : null });
  const sandbox = vm.createContext({ window: {}, document, Element, HTMLElement, HTMLDialogElement: Dialog });
  const source = await moduleSource('../src/scripts/dialogs.ts');
  vm.runInContext(source, sandbox);
  assert.equal(document.listenerCount('click'), 1);
  const click = (target, coordinates = {}) => document.emit('click', { target, preventDefault() {}, ...coordinates });
  click(child);
  click(child);
  assert.equal(dialog.openCount, 1);
  click(dialog, { clientX: 50, clientY: 50 });
  assert.equal(dialog.open, true);
  click(dialog, { clientX: 0, clientY: 50 });
  assert.equal(dialog.open, false);
  click(child);
  click(new Element({}, new HTMLElement({ 'data-modal-close': '' }, dialog)));
  assert.equal(dialog.open, false);
  click(new HTMLElement({ 'data-content-dialog': 'missing' }));
  click({});
  assert.equal(dialog.openCount, 2);
});

async function wallpaperFixture({ idleSupported = true, hidden = false } = {}) {
  let gradientCount = 0;
  let paintCount = 0;
  let nextId = 0;
  const timers = new Map();
  const idleJobs = new Map();
  const context = new Proxy({
    createLinearGradient() { gradientCount += 1; return { addColorStop() {} }; },
    clearRect() { paintCount += 1; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  class Canvas { getContext() { return context; } }
  const canvas = new Canvas();
  const document = events({ hidden, querySelector: () => canvas });
  let viewportWidth = 1280, viewportHeight = 800;
  const viewportReads = { width: 0, height: 0 };
  const window = events({
    devicePixelRatio: 3,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  Object.defineProperties(window, {
    innerWidth: { get() { viewportReads.width++; return viewportWidth; }, set(value) { viewportWidth = value; } },
    innerHeight: { get() { viewportReads.height++; return viewportHeight; }, set(value) { viewportHeight = value; } },
  });
  if (idleSupported) {
    window.requestIdleCallback = callback => { const id = ++nextId; idleJobs.set(id, callback); return id; };
    window.cancelIdleCallback = id => idleJobs.delete(id);
  }
  const sandbox = vm.createContext({ window, document, HTMLCanvasElement: Canvas,
    Path2D: class { moveTo() {} lineTo() {} },
  });
  vm.runInContext(await read('../src/scripts/wallpaper.js'), sandbox);
  function flushIdle() {
    const callbacks = [...idleJobs.values()];
    idleJobs.clear();
    for (const callback of callbacks) callback();
  }
  function tick() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id);
    timer.callback();
  }
  return { window, document, canvas, timers, idleJobs, flushIdle, tick,
    viewportReads: () => ({ ...viewportReads }),
    counts: () => ({ gradients: gradientCount, paints: paintCount }) };
}

test('wallpaper defers its initial viewport reads until idle and reads each dimension once per paint', async () => {
  const fixture = await wallpaperFixture();
  assert.deepEqual(fixture.viewportReads(), { width: 0, height: 0 });
  fixture.window.emit('pageshow');
  fixture.window.innerWidth = 900;
  fixture.window.innerHeight = 600;
  fixture.window.emit('resize');
  assert.equal(fixture.idleJobs.size, 1);
  assert.deepEqual(fixture.viewportReads(), { width: 0, height: 0 }, 'Initial scheduling must not force content layout');
  fixture.flushIdle();
  assert.deepEqual(fixture.viewportReads(), { width: 1, height: 1 });
  assert.equal(fixture.canvas.width, 900);
  assert.equal(fixture.canvas.height, 600);
  fixture.window.emit('resize');
  assert.equal(fixture.idleJobs.size, 0, 'The unchanged viewport fast path is retained');
  fixture.window.innerWidth = 1000;
  fixture.window.emit('resize');
  const before = fixture.viewportReads();
  fixture.flushIdle();
  assert.deepEqual(fixture.viewportReads(), { width: before.width + 1, height: before.height + 1 });
  assert.equal(fixture.canvas.width, 1000);
});

test('wallpaper paints once after content and stays static across page and visibility events', async () => {
  const fixture = await wallpaperFixture();
  assert.deepEqual(fixture.counts(), { gradients: 0, paints: 0 });
  assert.equal(fixture.idleJobs.size, 1);
  fixture.window.emit('pageshow');
  assert.equal(fixture.idleJobs.size, 1);
  fixture.flushIdle();
  assert.equal(fixture.canvas.width, fixture.window.innerWidth, 'Decoration needs no extra high-DPI raster work');
  assert.equal(fixture.canvas.height, fixture.window.innerHeight);
  assert.deepEqual(fixture.counts(), { gradients: 4, paints: 1 });
  for (let index = 0; index < 8; index += 1) {
    fixture.window.emit('pageshow');
    fixture.document.emit('visibilitychange');
  }
  assert.equal(fixture.timers.size + fixture.idleJobs.size, 0, 'No recurring background work');
  assert.deepEqual(fixture.counts(), { gradients: 4, paints: 1 });
});

test('wallpaper coalesces viewport changes into one static repaint at the latest size', async () => {
  const fixture = await wallpaperFixture();
  fixture.flushIdle();
  fixture.window.innerWidth = 1000;
  fixture.window.emit('resize');
  fixture.window.innerWidth = 900;
  fixture.window.innerHeight = 600;
  fixture.window.emit('resize');
  assert.equal(fixture.idleJobs.size, 1);
  assert.equal(fixture.counts().paints, 1);
  fixture.flushIdle();
  assert.equal(fixture.canvas.width, 900);
  assert.equal(fixture.canvas.height, 600);
  assert.deepEqual(fixture.counts(), { gradients: 8, paints: 2 });
  fixture.window.emit('resize');
  assert.equal(fixture.idleJobs.size, 0, 'Unchanged dimensions do not repaint');
  assert.equal(fixture.counts().paints, 2);
});

test('wallpaper defers hidden work and recovers an interrupted first paint on pageshow', async () => {
  const fixture = await wallpaperFixture({ hidden: true });
  assert.equal(fixture.idleJobs.size, 0);
  fixture.document.hidden = false;
  fixture.document.emit('visibilitychange');
  assert.equal(fixture.idleJobs.size, 1);
  fixture.window.emit('pagehide');
  assert.equal(fixture.idleJobs.size, 0);
  fixture.window.emit('pageshow');
  fixture.document.hidden = true;
  fixture.flushIdle();
  assert.equal(fixture.counts().paints, 0);
  fixture.document.hidden = false;
  fixture.document.emit('visibilitychange');
  fixture.flushIdle();
  assert.equal(fixture.counts().paints, 1);
  assert.equal(fixture.timers.size, 0);
  fixture.document.hidden = true;
  fixture.window.innerWidth = 1000;
  fixture.window.emit('resize');
  assert.equal(fixture.idleJobs.size, 0);
  fixture.document.hidden = false;
  fixture.document.emit('visibilitychange');
  fixture.flushIdle();
  assert.equal(fixture.counts().paints, 2);
  fixture.window.innerWidth = 900;
  fixture.window.emit('resize');
  fixture.window.emit('pagehide');
  assert.equal(fixture.timers.size + fixture.idleJobs.size, 0);
});

test('wallpaper restores a changed viewport without registering duplicate event handlers', async () => {
  const fixture = await wallpaperFixture();
  fixture.flushIdle();
  fixture.window.emit('pagehide');
  fixture.window.innerWidth = 900;
  fixture.window.emit('pageshow', { persisted: true });
  assert.equal(fixture.idleJobs.size, 1);
  fixture.flushIdle();
  assert.equal(fixture.canvas.width, 900);
  assert.equal(fixture.counts().paints, 2);
  for (const name of ['resize', 'pagehide', 'pageshow']) assert.equal(fixture.window.listenerCount(name), 1);
  assert.equal(fixture.document.listenerCount('visibilitychange'), 1);
});

test('wallpaper paints once without idle-callback support', async () => {
  const fallback = await wallpaperFixture({ idleSupported: false });
  assert.equal([...fallback.timers.values()][0].delay, 25);
  assert.equal(fallback.counts().paints, 0);
  assert.deepEqual(fallback.viewportReads(), { width: 0, height: 0 });
  fallback.tick();
  assert.deepEqual(fallback.viewportReads(), { width: 1, height: 1 });
  assert.equal(fallback.counts().paints, 1);
  assert.equal(fallback.timers.size, 0);
});

async function scratchFixture({ failedSources = [], tainted = false } = {}) {
  const context = new Proxy({
    getImageData() {
      if (tainted) throw new Error('SecurityError');
      return { data: new Uint8ClampedArray(32) };
    },
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  class Element {}
  class ImageElement extends Element {
    constructor(src = '') { super(); events(this); this._src = src; this.complete = true; this.naturalWidth = 240; this.naturalHeight = 240; }
    get src() { return this._src; }
    set src(value) { this._src = value; queueMicrotask(() => this.emit(failedSources.includes(value) ? 'error' : 'load')); }
    getAttribute() { return this._src; }
    getBoundingClientRect() { return { width: 176, height: 176, left: 0, top: 0 }; }
  }
  class Canvas extends Element {
    constructor() { super(); events(this); this.style = {}; }
    getContext() { return context; }
    getBoundingClientRect() { return { width: 176, height: 176, left: 0, top: 0 }; }
  }
  const image = new ImageElement('/first.jpg');
  const canvas = new Canvas();
  const root = new Element();
  root.dataset = { scratchSources: JSON.stringify(['/first.jpg', '/second.jpg', '/third.jpg']) };
  root.querySelector = selector => selector === 'img' ? image : canvas;
  const document = events({ querySelectorAll: () => [root], createElement: () => new Canvas() });
  const timers = [];
  const window = { devicePixelRatio: 1, setTimeout: callback => timers.push(callback) };
  const sandbox = vm.createContext({ window, document, HTMLImageElement: ImageElement,
    HTMLCanvasElement: Canvas, HTMLElement: Element, Image: ImageElement, queueMicrotask });
  const source = await read('../src/scripts/scratch-profile.js');
  vm.runInContext(source, sandbox);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  return { root, image, canvas, timers, settle };
}

test('scratch portrait retains its last successful image when the next asset fails', async () => {
  const { root, image, canvas } = await scratchFixture({ failedSources: ['/second.jpg'] });
  assert.equal(image.src, '/first.jpg');
  assert.equal(root.dataset.ready, undefined);
  assert.equal(root.dataset.revealed, 'true');
  assert.equal(canvas.style.pointerEvents, 'none');
});

test('scratch portrait ignores secondary clicks and recovers from unreadable canvas data', async () => {
  const { root, image, canvas } = await scratchFixture({ tainted: true });
  assert.equal(image.src, '/second.jpg');
  assert.equal(root.dataset.ready, 'true');
  canvas.emit('pointerdown', { button: 2, clientX: 50, clientY: 50 });
  canvas.emit('pointerup');
  assert.equal(root.dataset.revealed, undefined);
  canvas.emit('pointerdown', { button: 0, clientX: 50, clientY: 50 });
  assert.doesNotThrow(() => canvas.emit('pointerup'));
  assert.equal(root.dataset.revealed, 'true');
  assert.equal(root.dataset.ready, undefined);
});

test('scratch portrait advances normally and a later request failure keeps the current portrait', async () => {
  const { root, image, canvas, timers, settle } = await scratchFixture({ failedSources: ['/third.jpg'] });
  assert.equal(image.src, '/second.jpg');
  canvas.emit('pointerdown', { button: 0, clientX: 50, clientY: 50 });
  canvas.emit('pointerup');
  assert.equal(timers.length, 1);
  timers[0]();
  await settle();
  assert.equal(image.src, '/second.jpg');
  assert.equal(root.dataset.ready, undefined);
});
