import assert from 'node:assert/strict';
import test from 'node:test';
import { animateRewrite } from '../../src/lib/circuit-reduction/animation.js';
import { REWRITE_DURATION, REPLAY_REWRITE_DURATION } from '../../src/lib/circuit-reduction/transition.js';

function fixture(context, circuit, { reducedMotion = false, supported = true, failAt = Infinity } = {}) {
  const stats = { created: 0, mutations: 0, styleWrites: [], layoutReads: 0, frameRequests: 0, attempts: 0 };
  const animations = [], mediaQueries = [];
  let document;
  const layoutRead = () => { stats.layoutReads++; throw new Error('Animation must not read layout'); };
  const requestFrame = () => { stats.frameRequests++; throw new Error('Animation must not run a JavaScript frame loop'); };
  class Element {
    constructor(tag) {
      stats.created++;
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.ownerDocument = document; this.attrs = {}; this.dataset = {}; this.className = '';
      this.style = new Proxy({}, {
        get: (values, property) => values[property] ?? '',
        set: (values, property, value) => {
          stats.styleWrites.push({ node: this, property, value }); values[property] = value; return true;
        },
      });
    }
    setAttribute(name, value) { stats.mutations++; this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    removeAttribute(name) { stats.mutations++; delete this.attrs[name]; }
    appendChild(node) {
      node.remove(); stats.mutations++; node.parentElement = this; this.children.push(node); return node;
    }
    remove() {
      if (!this.parentElement) return;
      stats.mutations++;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
    }
    matches(selector) {
      if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
      const data = selector.match(/^\[data-(cell|link)="([^"]+)"\]$/);
      return Boolean(data && this.dataset[data[1]] === data[2]);
    }
    querySelector(selector) {
      const [ancestor, child] = selector.split(/\s+/);
      for (const node of this.children) {
        if (node.matches(ancestor)) {
          const found = child ? node.querySelector(child) : node;
          if (found) return found;
        }
        const found = node.querySelector(selector);
        if (found) return found;
      }
      return null;
    }
    getBoundingClientRect() { return layoutRead(); }
    replaceChildren() { throw new Error('Animation must preserve the existing circuit DOM'); }
    animate(frames, options) {
      if (++stats.attempts === failAt) throw new Error('Native animation could not start');
      let resolve, reject, settled = false;
      const animation = {
        node: this, frames: frames.map(frame => ({ ...frame })), options: { ...options }, cancellations: 0,
        finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
        complete() { if (!settled) { settled = true; resolve(); } },
        interrupt() { if (!settled) { settled = true; reject(new Error('Native animation interrupted')); } },
        cancel() { this.cancellations++; this.interrupt(); },
      };
      animations.push(animation); return animation;
    }
  }
  for (const property of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) {
    Object.defineProperty(Element.prototype, property, { get: layoutRead });
  }
  document = {
    createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
    defaultView: {
      matchMedia(query) { mediaQueries.push(query); return { matches: reducedMotion }; },
      requestAnimationFrame: requestFrame, getComputedStyle: layoutRead,
    },
  };
  for (const [name, value] of Object.entries({ document, requestAnimationFrame: requestFrame, getComputedStyle: layoutRead })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  const board = document.createElement('div'), glyphs = new Map(), links = new Map();
  if (!supported) board.animate = undefined;
  circuit.forEach((row, y) => row.forEach((cell, x) => {
    const key = `${y}:${x}`, button = document.createElement('button');
    button.dataset.cell = key; board.appendChild(button);
    if (cell !== '.') {
      const glyph = document.createElementNS('', 'svg'); glyph.className = 'gate-glyph';
      button.appendChild(glyph); glyphs.set(key, glyph);
    }
    if (cell.endsWith('U')) {
      const link = document.createElementNS('', 'line'); link.dataset.link = key;
      board.appendChild(link); links.set(key, link);
    }
  }));
  const originalNodes = [...board.children];
  stats.created = stats.mutations = 0; stats.styleWrites.length = 0;
  function assertClean() {
    assert.deepEqual(board.children, originalNodes, 'Cleanup preserves every original board node');
    assert.equal(board.dataset.rewriteAnimating, undefined);
    assert.equal(board.getAttribute('aria-busy'), null);
    assert.equal(stats.layoutReads, 0); assert.equal(stats.frameRequests, 0);
  }
  return { board, glyphs, links, animations, mediaQueries, stats, originalNodes, assertClean };
}

function geometry(frame) {
  const match = frame.transform.match(/^translateX\(([-\d.]+)px\) scale\(([-\d.]+)\)$/);
  assert.ok(match, 'Native motion uses a translate and scale transform');
  return { x: Number(match[1]), scale: Number(match[2]), opacity: frame.opacity };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const move = rule => ({ rule, row: 0, column: 0 });

test('HH cancellation uses native transform/opacity frames and preserves the board until completion', async context => {
  const before = [['Z', 'H', 'H', 'Z']], after = [['Z', '.', '.', 'Z']];
  const saved = structuredClone({ before, after });
  const state = fixture(context, before);
  const job = animateRewrite(state.board, before, after, { rule: 'cancel-h', row: 0, column: 1 });
  assert.ok(job); assert.equal(state.animations.length, 2);
  assert.equal(state.board.dataset.rewriteAnimating, 'true');
  assert.equal(state.board.getAttribute('aria-busy'), 'true');
  assert.deepEqual(state.mediaQueries, ['(prefers-reduced-motion: reduce)']);
  assert.equal(state.glyphs.get('0:1').style.visibility, 'hidden');
  assert.equal(state.glyphs.get('0:2').style.visibility, 'hidden');
  assert.equal(state.glyphs.get('0:0').style.visibility, '');
  assert.equal(state.glyphs.get('0:3').style.visibility, '');
  const overlay = state.board.children.at(-1);
  assert.equal(overlay.className, 'rewrite-overlay'); assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(state.board.children.slice(0, -1), state.originalNodes);
  for (const animation of state.animations) {
    assert.equal(animation.node.style.left, '32px'); assert.equal(animation.node.style.top, '14px');
    assert.deepEqual(animation.frames.map(frame => frame.offset), [0, .16, .3, .45, .55, .6, .7, .84, 1]);
    assert.ok(animation.frames.every(frame => Object.keys(frame).sort().join() === 'offset,opacity,transform'));
    assert.deepEqual(animation.options, { duration: REWRITE_DURATION, fill: 'both', easing: 'linear' });
  }
  const [left, right] = state.animations;
  assert.deepEqual([geometry(left.frames[0]).x, geometry(right.frames[0]).x], [64, 128]);
  assert.deepEqual(geometry(left.frames[1]), geometry(left.frames[0]), 'The matched source is held before motion');
  assert.ok(geometry(left.frames[3]).x > 64 && geometry(left.frames[3]).x < 96);
  assert.deepEqual([geometry(left.frames[5]).x, geometry(right.frames[5]).x], [96, 96], 'The pair meets before disappearing');
  assert.ok(left.frames[6].opacity > 0 && left.frames[6].opacity < 1);
  assert.deepEqual(geometry(left.frames.at(-1)), { x: 96, scale: .18, opacity: 0 });
  assert.deepEqual(geometry(right.frames.at(-1)), { x: 96, scale: .18, opacity: 0 });
  assert.deepEqual(geometry(left.frames.at(-2)), geometry(left.frames.at(-1)), 'The resulting identity settles before cleanup');
  const pendingWrites = state.stats.styleWrites.length, pendingMutations = state.stats.mutations;
  await Promise.resolve();
  assert.equal(state.stats.styleWrites.length, pendingWrites); assert.equal(state.stats.mutations, pendingMutations);
  left.complete(); await Promise.resolve();
  assert.equal(state.board.children.at(-1), overlay, 'Cleanup waits for every native sprite');
  right.complete(); assert.equal(await job.finished, true);
  assert.ok(state.animations.every(animation => animation.cancellations === 1));
  assert.equal(state.glyphs.get('0:1').style.visibility, ''); assert.equal(state.glyphs.get('0:2').style.visibility, '');
  state.assertClean(); assert.deepEqual({ before, after }, saved, 'Animation never changes saved circuit snapshots');
});

test('controlled cancellation keeps connectors and both endpoints aligned throughout the native frames', async context => {
  const before = [['ZU', 'ZU'], ['XD', 'XD']], after = [['.', '.'], ['.', '.']];
  const state = fixture(context, before), job = animateRewrite(state.board, before, after, move('cancel-cnot-down'));
  assert.ok(job); assert.equal(state.animations.length, 6);
  assert.ok([...state.links.values(), ...state.glyphs.values()].every(node => node.style.visibility === 'hidden'));
  const links = state.animations.filter(animation => animation.node.className === 'rewrite-link');
  const gates = state.animations.filter(animation => animation.node.className === 'rewrite-gate');
  assert.equal(links.length, 2); assert.equal(gates.length, 4);
  for (const link of links) {
    assert.equal(link.node.style.left, '52px'); assert.equal(link.node.style.top, '36px');
    const svg = link.node.children[0];
    assert.equal(svg.getAttribute('height'), '72'); assert.equal(svg.children[0].getAttribute('d'), 'M2 0V72');
    const endpoints = gates.filter(gate => geometry(gate.frames[0]).x === geometry(link.frames[0]).x);
    assert.deepEqual(endpoints.map(gate => gate.node.style.top).sort(), ['14px', '86px']);
    for (let index = 0; index < link.frames.length; index++) {
      for (const endpoint of endpoints) {
        const gateFrame = geometry(endpoint.frames[index]), linkFrame = geometry(link.frames[index]);
        assert.deepEqual([gateFrame.x, gateFrame.opacity], [linkFrame.x, linkFrame.opacity], 'The link and its endpoints share motion and fade timing');
        assert.equal(linkFrame.scale, 1, 'The link keeps reaching both wire centers as gates shrink');
        assert.equal(Number.parseFloat(endpoint.node.style.left) + 22, Number.parseFloat(link.node.style.left) + 2);
      }
    }
    assert.deepEqual(geometry(link.frames.at(-1)), { x: 32, scale: 1, opacity: 0 });
  }
  state.animations.forEach(animation => animation.complete()); assert.equal(await job.finished, true);
  state.assertClean();
});

test('cancellation is idempotent, reports false and restores original visibility values', async context => {
  const before = [['H', 'H']], state = fixture(context, before);
  state.glyphs.get('0:0').style.visibility = 'visible'; state.glyphs.get('0:1').style.visibility = 'collapse';
  const job = animateRewrite(state.board, before, [['.', '.']], move('cancel-h'));
  assert.ok(job); job.cancel(); assert.equal(await job.finished, false);
  assert.equal(state.glyphs.get('0:0').style.visibility, 'visible');
  assert.equal(state.glyphs.get('0:1').style.visibility, 'collapse');
  const writes = state.stats.styleWrites.length, mutations = state.stats.mutations;
  job.cancel(); state.animations.forEach(animation => animation.complete()); await tick();
  assert.equal(state.stats.styleWrites.length, writes); assert.equal(state.stats.mutations, mutations);
  assert.ok(state.animations.every(animation => animation.cancellations === 1)); state.assertClean();
});

test('a rejected native animation settles false and cleans every sprite', async context => {
  const before = [['X', 'X']], state = fixture(context, before);
  const job = animateRewrite(state.board, before, [['.', '.']], move('cancel-x'));
  assert.ok(job); state.animations[0].interrupt();
  state.animations.slice(1).forEach(animation => animation.complete());
  assert.equal(await job.finished, false);
  assert.ok(state.animations.every(animation => animation.cancellations === 1));
  assert.ok([...state.glyphs.values()].every(node => node.style.visibility === '')); state.assertClean();
});

for (const [name, options, after, rewrite] of [
  ['reduced motion', { reducedMotion: true }, [['.', '.']], move('cancel-h')],
  ['unsupported native animation', { supported: false }, [['.', '.']], move('cancel-h')],
  ['unchanged circuit', {}, [['H', 'H']], move('cancel-h')],
  ['free layout change', {}, [['.', 'H', 'H']], { rule: 'insert-column', row: 0, column: 0 }],
  ['invalid rewrite', {}, [['.', 'X']], move('cancel-h')],
]) {
  test(`${name} returns null without changing the DOM`, context => {
    const before = [['H', 'H']], state = fixture(context, before, options);
    assert.equal(animateRewrite(state.board, before, after, rewrite), null);
    assert.equal(state.animations.length, 0); assert.equal(state.stats.attempts, 0);
    assert.equal(state.stats.created, 0); assert.equal(state.stats.mutations, 0); assert.deepEqual(state.stats.styleWrites, []);
    state.assertClean();
  });
}

test('partial native startup failure restores the board and handles cancellation rejections', async context => {
  const before = [['H', 'H']], state = fixture(context, before, { failAt: 2 });
  state.glyphs.get('0:0').style.visibility = 'visible';
  assert.equal(animateRewrite(state.board, before, [['.', '.']], move('cancel-h')), null);
  assert.equal(state.stats.attempts, 2); assert.equal(state.animations.length, 1);
  assert.equal(state.animations[0].cancellations, 1);
  assert.equal(state.glyphs.get('0:0').style.visibility, 'visible'); assert.equal(state.glyphs.get('0:1').style.visibility, '');
  await tick(); state.assertClean();
});

test('reverse cancellation introduces a pair from its midpoint into the final slots', async context => {
  const before = [['.', '.']], after = [['H', 'H']], state = fixture(context, before);
  const job = animateRewrite(state.board, before, after, move('cancel-h'));
  assert.ok(job); assert.equal(state.animations.length, 2);
  const [left, right] = state.animations;
  assert.deepEqual(geometry(left.frames[0]), { x: 32, scale: .18, opacity: 0 });
  assert.deepEqual(geometry(right.frames[0]), { x: 32, scale: .18, opacity: 0 });
  assert.deepEqual([geometry(left.frames[2]).x, geometry(right.frames[2]).x], [32, 32], 'The new pair first appears at its shared midpoint');
  assert.ok(left.frames[2].opacity > 0 && left.frames[2].opacity < 1);
  assert.ok(geometry(left.frames[6]).x < 32 && geometry(right.frames[6]).x > 32, 'The visible pair separates into its slots');
  assert.deepEqual(geometry(left.frames.at(-1)), { x: 0, scale: 1, opacity: 1 });
  assert.deepEqual(geometry(right.frames.at(-1)), { x: 64, scale: 1, opacity: 1 });
  assert.deepEqual(geometry(left.frames.at(-2)), geometry(left.frames.at(-1)));
  assert.ok(state.stats.styleWrites.every(write => write.property !== 'visibility'), 'An insertion has no old glyph to hide');
  state.animations.forEach(animation => animation.complete()); assert.equal(await job.finished, true); state.assertClean();
});

test('replay uses the same native phases with a shorter complete duration', async context => {
  const before = [['H', 'H']], state = fixture(context, before);
  const job = animateRewrite(state.board, before, [['.', '.']], move('cancel-h'), { duration: REPLAY_REWRITE_DURATION });
  assert.ok(REPLAY_REWRITE_DURATION < REWRITE_DURATION);
  assert.ok(state.animations.every(animation => animation.options.duration === REPLAY_REWRITE_DURATION));
  state.animations.forEach(animation => animation.complete()); assert.equal(await job.finished, true); state.assertClean();
});

test('unchanged controlled endpoints use a static overlay sprite without native animation', async context => {
  const before = [['H', 'ZU', 'H'], ['.', 'ZD', '.']], after = [['.', 'XU', '.'], ['.', 'ZD', '.']];
  const state = fixture(context, before), job = animateRewrite(state.board, before, after, move('basis-up'));
  assert.ok(job);
  const overlay = state.board.children.at(-1), staticSprite = overlay.children.find(node => node.style.transform !== '');
  assert.ok(staticSprite); assert.equal(staticSprite.className, 'rewrite-gate');
  assert.equal(staticSprite.style.top, '86px'); assert.equal(staticSprite.style.transform, 'translateX(64px) scale(1)');
  assert.ok(state.animations.every(animation => animation.node !== staticSprite));
  assert.equal(state.glyphs.get('1:1').style.visibility, 'hidden');
  state.animations.forEach(animation => animation.complete()); assert.equal(await job.finished, true); state.assertClean();
});
