import test from 'node:test';
import assert from 'node:assert/strict';
import { bindNodeDragging } from '../../src/lib/zx-calculus/drag.js';

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type, event = {}) { for (const handler of listeners.get(type) ?? []) { handler(event); if (event.stopped) break; } },
    listenerCount() { return [...listeners.values()].reduce((sum, handlers) => sum + handlers.size, 0); },
  };
}

function setup({ allowed = true, disabled = false, pointerType = 'mouse' } = {}) {
  const callbacks = new Map(), moves = [], endings = [], captures = [], captured = new Set();
  let nextFrame = 0;
  const view = { ...events(), requestAnimationFrame(callback) { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { callbacks.delete(id); } };
  const doc = { ...events(), defaultView: view, hidden: false };
  const node = { dataset: { node: '4' }, disabled, closest: selector => selector === '[data-node]' ? node : null,
    setPointerCapture(id) { captures.push(['set', id]); captured.add(id); }, hasPointerCapture: id => captured.has(id),
    releasePointerCapture(id) { captures.push(['release', id]); captured.delete(id); } };
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 400 } },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200 }) };
  const container = { ...events(), ownerDocument: doc, contains: target => target === node,
    querySelector: selector => selector === '.zx-svg' ? svg : null };
  const helper = bindNodeDragging(container, { canDrag: () => allowed, getPosition: () => ({ x: 100, y: 80 }),
    onMove: (id, point) => moves.push({ id, ...point }), onEnd: (id, result) => endings.push({ id, ...result }) });
  const fire = (type, changes = {}) => {
    const event = { target: node, button: 0, isPrimary: true, pointerType, pointerId: 1, clientX: 20, clientY: 30, detail: 1,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...changes };
    container.emit(type, event); return event;
  };
  return { helper, container, node, doc, view, moves, endings, captures, callbacks, svg, fire,
    allow(value) { allowed = value; },
    tick() { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(); } };
}

test('a small pointer movement preserves the ordinary node selection click', () => {
  const dom = setup();
  dom.fire('pointerdown');
  assert.deepEqual(dom.captures, [['set', 1]]);
  assert.equal(dom.helper.active, false);
  assert.equal(dom.fire('pointermove', { clientX: 24, clientY: 32 }).prevented, undefined);
  dom.fire('pointerup', { clientX: 24, clientY: 32 });
  assert.deepEqual(dom.moves, []); assert.deepEqual(dom.endings, []);
  assert.deepEqual(dom.captures, [['set', 1], ['release', 1]]);
  assert.equal(dom.fire('click').stopped, undefined);
  dom.helper.dispose();
});

test('drag moves are coalesced, mapped into diagram coordinates and suppress only their click', () => {
  const dom = setup();
  dom.fire('pointerdown');
  assert.equal(dom.fire('pointermove', { clientX: 26, clientY: 30 }).prevented, true);
  dom.fire('pointermove', { clientX: 30, clientY: 40 });
  assert.equal(dom.helper.active, true); assert.equal(dom.callbacks.size, 1); assert.deepEqual(dom.moves, []);
  dom.tick();
  assert.deepEqual(dom.moves, [{ id: 4, x: 120, y: 100 }]);
  dom.fire('pointermove', { clientX: 35, clientY: 45 });
  dom.fire('pointerup', { clientX: 40, clientY: 50 });
  assert.deepEqual(dom.moves.at(-1), { id: 4, x: 140, y: 120 });
  assert.equal(dom.callbacks.size, 0); assert.equal(dom.helper.active, false);
  assert.deepEqual(dom.endings, [{ id: 4, cancelled: false }]);
  assert.equal(dom.fire('click', { detail: 0 }).stopped, undefined, 'Keyboard activation remains available.');
  assert.equal(dom.fire('click').stopped, true);
  assert.equal(dom.fire('click').stopped, undefined, 'The suppression is consumed once.');
  dom.helper.dispose();
});

test('drag coordinates stay inside the bounded positive canvas', () => {
  const dom = setup(); dom.fire('pointerdown');
  dom.fire('pointermove', { clientX: -1000, clientY: -1000 }); dom.tick();
  assert.deepEqual(dom.moves.at(-1), { id: 4, x: 36, y: 36 });
  dom.fire('pointerup', { clientX: 10000, clientY: 10000 });
  assert.deepEqual(dom.moves.at(-1), { id: 4, x: 2400, y: 1600 });
  dom.helper.dispose();
});

test('cancel and dispose invalidate queued work and release pointer capture', () => {
  const dom = setup(); dom.fire('pointerdown'); dom.fire('pointermove', { clientX: 40 });
  const stale = [...dom.callbacks.values()][0];
  dom.helper.cancel(); stale();
  assert.equal(dom.helper.active, false); assert.equal(dom.callbacks.size, 0); assert.deepEqual(dom.moves, []);
  assert.deepEqual(dom.endings, [{ id: 4, cancelled: true }]);
  assert.deepEqual(dom.captures.at(-1), ['release', 1]);
  dom.fire('pointerdown'); dom.fire('pointermove', { clientX: 40 });
  stale(); assert.equal(dom.callbacks.size, 1, 'A stale callback cannot overwrite the new gesture’s scheduled frame.');
  dom.helper.dispose(); dom.helper.dispose(); dom.tick();
  assert.equal(dom.container.listenerCount() + dom.view.listenerCount() + dom.doc.listenerCount(), 0);
  assert.deepEqual(dom.moves, []); assert.equal(dom.endings.length, 2);
  dom.fire('pointerdown'); assert.equal(dom.helper.active, false);
});

test('blocked, disabled, secondary, non-primary and empty-space gestures do not begin drags', () => {
  for (const options of [{ allowed: false }, { disabled: true }, {}]) {
    const dom = setup(options);
    const changes = options.allowed === false || options.disabled ? [{}] :
      [{ button: 2 }, { isPrimary: false }, { target: { closest: () => null } }, { clientX: NaN }];
    for (const change of changes) { dom.fire('pointerdown', change); dom.fire('pointermove', { clientX: 50 }); }
    assert.deepEqual(dom.captures, []); assert.deepEqual(dom.moves, []); dom.helper.dispose();
  }
});

test('touch follows the same threshold and other pointers cannot interrupt it', () => {
  const dom = setup({ pointerType: 'touch' }); dom.fire('pointerdown');
  dom.fire('pointermove', { pointerId: 2, clientX: 100 });
  assert.equal(dom.helper.active, false);
  dom.fire('pointermove', { clientX: 26 }); dom.tick();
  dom.fire('pointerup', { pointerId: 2 }); assert.equal(dom.helper.active, true);
  dom.fire('pointercancel');
  assert.equal(dom.helper.active, false); assert.deepEqual(dom.endings, [{ id: 4, cancelled: true }]);
  dom.helper.dispose();
});

test('a newly blocked or hidden page cancels the gesture before a queued layout change', () => {
  for (const cause of ['blocked', 'hidden', 'lost', 'blur', 'resize']) {
    const dom = setup(); dom.fire('pointerdown'); dom.fire('pointermove', { clientX: 40 });
    if (cause === 'blocked') { dom.allow(false); dom.tick(); }
    else if (cause === 'hidden') { dom.doc.hidden = true; dom.doc.emit('visibilitychange'); }
    else if (cause === 'lost') dom.fire('lostpointercapture');
    else dom.view.emit(cause);
    dom.tick();
    assert.equal(dom.helper.active, false, cause); assert.deepEqual(dom.moves, [], cause);
    assert.deepEqual(dom.endings, [{ id: 4, cancelled: true }], cause); dom.helper.dispose();
  }
});
