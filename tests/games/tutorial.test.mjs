import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorial } from '../../src/lib/games/tutorial.js';

function fixture(context, actions = [() => {}, () => {}], options = {}) {
  const nodes = new Map(), listeners = new Map(), calls = [];
  let blocked = false;
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: false, hidden: false, attrs: new Map(), listeners: new Map(),
      addEventListener(type, handler) { this.listeners.set(type, handler); },
      click() { return this.listeners.get('click')?.(); },
      setAttribute(key, value) { this.attrs.set(key, value); }, removeAttribute(key) { this.attrs.delete(key); },
      closest(selector) {
        if (selector === '#tutorial-panel' && id.startsWith('tutorial-')) return get('tutorial-panel');
        return selector.split(',').some(part => part.trim() === `#${id}` ||
          part.trim() === '.game-controls button' && /^(gate-|undo$)/.test(id) ||
          part.trim() === 'canvas' && id === 'canvas') ? this : null;
      },
      scrollIntoView() { calls.push(`reveal:${id}`); },
    });
    return nodes.get(id);
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: selector => get(selector.slice(1)),
    querySelectorAll: () => [get('gate-0'), get('gate-1'), get('undo')],
    addEventListener(type, action, capture) { assert.equal(capture === true || capture?.capture, true); listeners.set(type, action); },
  } });
  context.after(() => original ? Object.defineProperty(globalThis, 'document', original) : delete globalThis.document);
  const guide = createTutorial({ get, intro: 'A harder example.', controls: '.game-controls button', isBlocked: () => blocked,
    onReset() { calls.push('reset'); assert.equal(guide.active, true); assert.equal(guide.executing, true); guide.render(); },
    onLeave() { calls.push('leave'); },
    steps: actions.map((action, index) => ({ text: `Reason ${index}`, target: `#gate-${index}`,
      prepare() { calls.push(`prepare:${index}`); assert.equal(guide.executing, true); guide.render(); },
      action() { calls.push(`move:${index}`); assert.equal(guide.executing, true); return action(); },
    })),
    ...options,
  });
  const dispatch = (type, target, properties = {}) => {
    const event = { type, target, ...properties, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listeners.get(type)?.(event); return event;
  };
  return { guide, get, calls, dispatch,
    /** @param {boolean} value */
    set blocked(value) { blocked = value; },
    capture: target => dispatch('click', target) };
}

test('render and reveal hooks receive each read-only target after preparation and animation', async context => {
  const rendered = [], revealed = [];
  const { guide, get, calls } = fixture(context, [() => Promise.resolve(true), () => {}], {
    onRender: focus => rendered.push(focus && { focus, disabled: focus.disabled, highlighted: focus.attrs.has('data-tutorial-focus') }),
    revealTarget: focus => revealed.push(focus),
  });
  guide.enter(); assert.equal(rendered.at(-1), null); assert.deepEqual(revealed, []);
  guide.start();
  assert.deepEqual(rendered.at(-1), { focus: get('gate-0'), disabled: true, highlighted: true });
  assert.deepEqual(revealed, [get('gate-0')]);
  await guide.next();
  assert.deepEqual(rendered.at(-1), { focus: get('gate-1'), disabled: true, highlighted: true });
  assert.deepEqual(revealed, [get('gate-0'), get('gate-1')]);
  await guide.next(); assert.equal(rendered.at(-1), null);
  assert.deepEqual(revealed, [get('gate-0'), get('gate-1')], 'Completion has no stale target to scroll');
  assert.deepEqual(calls.filter(call => call.startsWith('reveal:')), ['reveal:tutorial-panel'],
    'Custom reveal handles the diagrams; the completed guide reveals Play levels');
  guide.leave(); assert.equal(rendered.at(-1), null);
});

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
  assert.equal(get('gate-0').disabled, true); assert.equal(get('gate-1').disabled, true);
  assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), true);
  await guide.next();
  assert.equal(get('tutorial-text').textContent, 'Reason 1');
  assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), false);
  assert.equal(get('gate-1').disabled, true);
  await guide.next();
  assert.equal(guide.finished, true); assert.equal(get('tutorial-next').hidden, true);
  assert.equal(get('tutorial-text').textContent, '');
  assert.equal(get('tutorial-levels').hidden, false);
  assert.equal(get('gate-1').disabled, true);
  await guide.next(); assert.deepEqual(calls.filter(call => call.startsWith('move:')), ['move:0', 'move:1']);
  get('tutorial-start').click();
  assert.equal(guide.finished, false); assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2');
});

test('metadata and animation refreshes retain the current explanation and its gate icons', async context => {
  const texts = [];
  const { guide, get } = fixture(context, [() => Promise.resolve(true), () => {}], {
    renderText(node, text) { texts.push(text); node.textContent = text; },
  });
  guide.enter(); guide.render(); guide.render();
  assert.deepEqual(texts, ['A harder example.']);
  guide.start(); guide.render();
  assert.deepEqual(texts, ['A harder example.', 'Reason 0']);
  await guide.next(); guide.render();
  assert.deepEqual(texts, ['A harder example.', 'Reason 0', 'Reason 1']);
  assert.equal(get('tutorial-text').textContent, 'Reason 1');
  guide.start();
  assert.deepEqual(texts, ['A harder example.', 'Reason 0', 'Reason 1', 'Reason 0']);
});

test('only Next advances the demonstration and rapid input cannot skip an animated move', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get, capture, calls } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start();
  capture(get('gate-0'));
  assert.equal(guide.executing, false); assert.equal(calls.includes('move:0'), false);
  const advancing = get('tutorial-next').click();
  assert.equal(guide.executing, true); assert.equal(get('tutorial-next').disabled, true);
  await guide.next();
  assert.deepEqual(calls.filter(call => call.startsWith('move:')), ['move:0']);
  resolve(); await advancing;
  assert.equal(guide.executing, false); assert.equal(get('tutorial-heading').textContent, 'Step 2 of 2');
});

test('game pointer input and hotkeys are blocked while tutorial controls retain native keyboard actions', context => {
  const { guide, get, dispatch, calls } = fixture(context);
  guide.enter(); guide.start();
  for (const type of ['pointerdown', 'pointermove', 'click', 'contextmenu']) {
    for (const target of [get('gate-0'), get('undo'), get('canvas')]) {
      const event = dispatch(type, target);
      assert.equal(event.prevented, true, type + ' cannot manipulate the game');
      assert.equal(event.stopped, true);
    }
  }
  const wheel = dispatch('wheel', get('canvas'));
  assert.equal(wheel.stopped, true, 'Wheel cannot zoom the demo camera');
  assert.equal(wheel.prevented, false, 'The page keeps native wheel scrolling');
  for (const target of [get('gate-0'), get('tutorial-next'), get('mode-campaign')]) {
    const event = dispatch('keydown', target);
    assert.equal(event.stopped, true, 'Game shortcut handlers cannot receive tutorial keystrokes');
    assert.equal(event.prevented, false, 'Tab and button/link activation keep their native action');
  }
  assert.equal(dispatch('click', get('tutorial-next')).stopped, false);
  assert.equal(dispatch('click', get('mode-campaign')).stopped, false);
  assert.equal(calls.includes('move:0'), false);
  guide.leave();
  assert.equal(dispatch('click', get('gate-0')).stopped, false);
  assert.equal(dispatch('keydown', get('gate-0')).stopped, false);
});

test('reference tabs retain keyboard navigation without enabling game shortcuts during a tutorial', async context => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { guide, get, dispatch } = fixture(context, [() => pending, () => {}]);
  const tab = get('memo-tab'), gameTab = get('gate-0');
  for (const node of [tab, gameTab]) {
    const closest = node.closest.bind(node);
    node.closest = selector => selector === '[role="tablist"]' ? node : closest(selector);
  }
  guide.enter(); guide.start();
  const check = () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      assert.equal(dispatch('keydown', tab, { key }).stopped, false, 'Reference navigation reaches its tab handler');
      assert.equal(dispatch('keydown', gameTab, { key }).stopped, true, 'Game tabs stay blocked');
    }
    for (const key of ['r', 'h', 'Backspace', 'Escape', '1'])
      assert.equal(dispatch('keydown', tab, { key }).stopped, true, 'Reference focus cannot trigger a game shortcut');
  };
  check();
  const advancing = guide.next();
  assert.equal(guide.executing, true);
  check();
  finish(); await advancing;
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

test('Restart cancels an in-progress step and its old animation cannot advance the fresh example', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start(); const advancing = guide.next();
  assert.equal(get('tutorial-start').disabled, false, 'Restart remains available during animation');
  guide.start();
  resolve(); await advancing;
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2'); assert.equal(guide.finished, false);
});

test('cancelling an animation leaves its tutorial step ready to retry', async context => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { guide, get, calls } = fixture(context, [() => pending, () => {}]);
  guide.enter(); guide.start(); const advancing = guide.next();
  resolve(false); await advancing;
  assert.equal(guide.executing, false);
  assert.equal(get('tutorial-heading').textContent, 'Step 1 of 2');
  assert.equal(get('gate-0').disabled, true);
  assert.equal(get('tutorial-next').disabled, false);
  assert.equal(calls.includes('prepare:1'), false);
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

test('bubble explanations can reveal a separate visual referent instead of their action button', context => {
  const { guide, calls } = fixture(context, [() => {}], {
    getAnchor: () => document.querySelector('#diagram'),
  });
  guide.enter(); guide.start();
  assert.deepEqual(calls.filter(call => call.startsWith('reveal:')), ['reveal:diagram']);
});

test('an explanation never puts the game highlight on Next step', async context => {
  const { guide, get } = fixture(context, [], { steps: [
    { text: 'Observe the diagram.', target: '#tutorial-next', action() {} },
  ] });
  guide.enter(); guide.start(); guide.render();
  assert.equal(get('tutorial-next').attrs.has('data-tutorial-focus'), false);
  assert.equal(get('tutorial-next').disabled, false);
  await get('tutorial-next').click();
  assert.equal(guide.finished, true);
});

test('a selected gate group reveals its first glyph rather than the rule button', context => {
  const { guide, calls } = fixture(context, [() => {}], {
    getAnchor: () => [document.querySelector('#first-gate'), document.querySelector('#second-gate')],
  });
  guide.enter(); guide.start();
  assert.deepEqual(calls.filter(call => call.startsWith('reveal:')), ['reveal:first-gate']);
});

test('steps can resolve their gate group after preparation instead of targeting the action button', context => {
  const { guide, calls, get } = fixture(context, [], { steps: [{ text: 'Cancel these gates.', target: '#gate-0',
    anchor: () => [document.querySelector('#glyph-a'), document.querySelector('#glyph-b')], action() {},
  }] });
  guide.enter(); guide.start();
  assert.deepEqual(calls.filter(call => call.startsWith('reveal:')), ['reveal:glyph-a']);
  assert.equal(get('gate-0').disabled, true);
});

test('revealing a clipped group centers both gates in their shared horizontal scroller', context => {
  const { guide, get } = fixture(context, [], { steps: [{ text: 'Use both gates.', target: '#gate-0',
    anchor: () => [get('glyph-a'), get('glyph-b')], action() {},
  }] });
  const scroller = { scrollWidth: 500, clientWidth: 200, clientLeft: 1, scrollLeft: 0, parentElement: null,
    contains: () => true, getBoundingClientRect: () => ({ left: 99 }) };
  for (const [id, left] of [['glyph-a', 250], ['glyph-b', 350]]) Object.assign(get(id), {
    parentElement: scroller, ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowX: 'auto' }) } },
    getBoundingClientRect: () => ({ left, top: 200, width: 44, height: 44 }),
  });
  guide.enter(); guide.start();
  assert.equal(scroller.scrollLeft, 122);
  get('glyph-a').getBoundingClientRect = () => ({ left: 120, top: 200, width: 44, height: 44 });
  get('glyph-b').getBoundingClientRect = () => ({ left: 220, top: 200, width: 44, height: 44 });
  guide.start();
  assert.equal(scroller.scrollLeft, 122, 'An already-visible group keeps its horizontal position');
});

test('Exit tutorial is available during a worked step and uses campaign navigation', context => {
  const { guide, get } = fixture(context);
  let exits = 0;
  get('mode-campaign').addEventListener('click', () => { guide.leave(); exits++; });
  guide.enter(); assert.equal(get('tutorial-close').hidden, true);
  guide.start(); assert.equal(get('tutorial-close').hidden, false);
  get('tutorial-close').click();
  assert.equal(exits, 1); assert.equal(guide.active, false); assert.equal(get('tutorial-panel').hidden, true);
});

test('pending mode requests pause Start and Next while game controls stay read-only', async context => {
  const state = fixture(context), { guide, get, calls, capture } = state;
  guide.enter(); state.blocked = true; guide.render(); guide.start();
  assert.equal(get('tutorial-start').disabled, true); assert.equal(calls.includes('prepare:0'), false);
  state.blocked = false; guide.start();
  state.blocked = true; guide.render();
  assert.equal(get('gate-0').disabled, true); assert.equal(get('tutorial-next').disabled, true);
  capture(get('gate-0')); await guide.next();
  assert.equal(calls.includes('move:0'), false);
  state.blocked = false; guide.render();
  assert.equal(get('gate-0').disabled, true); await guide.next();
  assert.equal(get('tutorial-heading').textContent, 'Step 2 of 2');
});

test('leaving restores each control’s prior state, including controls games never update', context => {
  const { guide, get } = fixture(context);
  get('undo').disabled = true;
  guide.enter(); guide.start(); guide.render(); guide.render(); guide.leave();
  assert.equal(get('undo').disabled, true); assert.equal(get('gate-0').disabled, false);
  assert.equal(get('gate-1').disabled, false); assert.equal(get('gate-0').attrs.has('data-tutorial-focus'), false);
});
