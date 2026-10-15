import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorial } from '../../src/lib/games/tutorial.js';

function fixture(context, actions = [() => {}, () => {}]) {
  const nodes = new Map(), listeners = new Map(), calls = [];
  let blocked = false;
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: false, hidden: false, attrs: new Map(), listeners: new Map(),
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      click() { return this.listeners.get('click')?.(); },
      setAttribute(key, value) { this.attrs.set(key, value); }, removeAttribute(key) { this.attrs.delete(key); },
      closest(selector) { return selector === `#${id}` ? this : null; },
      scrollIntoView() { calls.push(`reveal:${id}`); },
    });
    return nodes.get(id);
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => get(selector.slice(1)),
    querySelectorAll: () => [get('gate-0'), get('gate-1'), get('undo')],
    addEventListener(type, action, capture) { assert.equal(capture, true); listeners.set(type, action); },
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  const guide = createTutorial({ get, intro: 'A harder example.', controls: '.game-controls button', isBlocked: () => blocked,
    onReset() { calls.push('reset'); assert.equal(guide.active, true); assert.equal(guide.executing, true); guide.render(); },
    onLeave() { calls.push('leave'); },
    steps: actions.map((action, index) => ({ text: `Reason ${index}`, target: `#gate-${index}`,
      prepare() { calls.push(`prepare:${index}`); assert.equal(guide.executing, true); guide.render(); },
      action() { calls.push(`move:${index}`); assert.equal(guide.executing, true); return action(); },
    })),
  });
  return { guide, get, calls,
    /** @param {boolean} value */
    set blocked(value) { blocked = value; },
    capture: target => {
    const event = { target, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get('click')(event); return event;
  } };
}

test('preview waits for Start; each explanation prepares and highlights only its own move', async context => {
  const { guide, get, calls } = fixture(context);
  guide.enter();
  assert.equal(guide.active, true); assert.equal(guide.finished, false);
  assert.equal(get('tutorial-text').textContent, 'A harder example.');
  assert.equal(get('tutorial-start').textContent, 'Start tutorial');
  assert.equal(get('tutorial-next').hidden, true);
  assert.equal(get('gate-0').disabled, true); assert.equal(get('undo').disabled, true);
  await guide.next(); assert.equal(calls.includes('move:0'), false);
  get('tutorial-start').click();
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2');
  assert.equal(get('gate-0').disabled, false); assert.equal(get('gate-1').disabled, true);
  assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), true);
  await guide.next();
  assert.equal(get('tutorial-text').textContent, 'Reason 1');
  assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), false);
  assert.equal(get('gate-1').disabled, false);
  await guide.next();
  assert.equal(guide.finished, true); assert.equal(get('tutorial-next').hidden, true);
  assert.equal(get('tutorial-levels').hidden, false);
  assert.equal(get('gate-1').disabled, true);
  await guide.next(); assert.deepEqual(calls.filter(call => call.startsWith('move:')), ['move:0', 'move:1']);
  get('tutorial-start').click();
  assert.equal(guide.finished, false); assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2');
});

test('native target click advances once, and rapid input cannot skip an animated move', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get, capture, calls } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start();
  assert.equal(capture(get('undo')).stopped, false);
  const event = capture(get('gate-0'));
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(guide.executing, true); assert.equal(get('tutorial-next').disabled, true);
  await guide.next(); guide.start();
  assert.deepEqual(calls.filter(call => call.startsWith('move:')), ['move:0']);
  resolve(); await pending; await Promise.resolve();
  assert.equal(guide.executing, false); assert.equal(get('tutorial-heading').textContent, 'Step 2 of 2');
});

test('leaving cancels stale continuations without locking controls or reopening the panel', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get, calls } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start(); const advancing = guide.next();
  guide.leave(); get('undo').disabled = false;
  resolve(); await advancing;
  assert.equal(guide.active, false); assert.equal(get('tutorial-panel').hidden, true);
  assert.equal(get('undo').disabled, false); assert.equal(calls.includes('prepare:1'), false);
  guide.enter(); assert.equal(get('tutorial-start').textContent, 'Start tutorial');
});

test('a previous animation cannot advance a freshly restarted example', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start(); const advancing = guide.next();
  guide.leave(); guide.enter(); guide.start();
  resolve(); await advancing;
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2'); assert.equal(guide.finished, false);
});

test('failed steps offer restart without silently advancing the worked solution', async context => {
  let fail = true;
  const { guide, get } = fixture(context, [() => { if (fail) throw new Error('test failure'); }]);
  guide.enter(); guide.start(); await guide.next();
  assert.equal(guide.finished, false); assert.match(get('tutorial-text').textContent, /Restart/);
  assert.equal(get('tutorial-next').hidden, true); assert.equal(get('tutorial-start').disabled, false);
  fail = false; guide.start(); await guide.next(); assert.equal(guide.finished, true);
});

test('Play levels delegates to the existing campaign navigation', async context => {
  const { guide, get } = fixture(context, [() => {}]);
  let changes = 0; get('mode-campaign').addEventListener('click', () => { guide.leave(); changes++; });
  guide.enter(); guide.start(); await guide.next(); get('tutorial-levels').click();
  assert.equal(changes, 1); assert.equal(guide.active, false);
});

test('pending mode requests pause Start, Next and native target clicks without losing the step', async context => {
  const state = fixture(context), { guide, get, calls, capture } = state;
  guide.enter(); state.blocked = true; guide.render(); guide.start();
  assert.equal(get('tutorial-start').disabled, true); assert.equal(calls.includes('prepare:0'), false);
  state.blocked = false; guide.start();
  state.blocked = true; guide.render();
  assert.equal(get('gate-0').disabled, true); assert.equal(get('tutorial-next').disabled, true);
  assert.equal(capture(get('gate-0')).stopped, false); await guide.next();
  assert.equal(calls.includes('move:0'), false);
  state.blocked = false; guide.render();
  assert.equal(get('gate-0').disabled, false); await guide.next();
  assert.equal(get('tutorial-heading').textContent, 'Step 2 of 2');
});

test('leaving restores each control’s prior state, including controls games never update', context => {
  const { guide, get } = fixture(context);
  get('undo').disabled = true;
  guide.enter(); guide.start(); guide.render(); guide.render(); guide.leave();
  assert.equal(get('undo').disabled, true); assert.equal(get('gate-0').disabled, false);
  assert.equal(get('gate-1').disabled, false); assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), false);
});
