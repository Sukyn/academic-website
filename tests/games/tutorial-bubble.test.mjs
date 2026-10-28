import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorialBubble } from '../../src/lib/games/tutorial-bubble.js';

function fixture(side, menuBounds) {
  let scrollY = 555;
  const frames = [], scrolls = [], height = 844, width = 390;
  const element = () => ({
    attrs: new Map(), children: [], dataset: {},
    style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } },
    getAttribute(key) { return this.attrs.get(key) ?? null; },
    setAttribute(key, value) { this.attrs.set(key, value); }, removeAttribute(key) { this.attrs.delete(key); },
    append(...nodes) { this.children.push(...nodes); },
    get firstElementChild() { return this.children[0]; }, get lastElementChild() { return this.children.at(-1); },
  });
  const measured = (top, bottom) => {
    if (side === 'below') [top, bottom] = [height - bottom, height - top];
    const node = element();
    node.getBoundingClientRect = () => ({ left: 20, right: 370, width: 350,
      top: top + 555 - scrollY, bottom: bottom + 555 - scrollY, height: bottom - top });
    return node;
  };
  const summary = measured(265.453125, 309.453125), memo = measured(265.453125, 580.125);
  const goal = measured(182.65625, 200.65625), map = measured(419.046875, 580.125);
  const panel = element();
  panel.closest = () => menuBounds && { querySelector: () => ({ getBoundingClientRect: () => menuBounds }) };
  panel.getBoundingClientRect = () => ({ left: Number.parseFloat(panel.style.left) || 0,
    top: Number.parseFloat(panel.style.top) || 0, width: 366, height: 158.6875 });
  panel.ownerDocument = {
    createElementNS: element,
    defaultView: { innerWidth: width, innerHeight: height,
      addEventListener() {}, removeEventListener() {}, cancelAnimationFrame() {},
      requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
      scrollBy({ top }) { scrolls.push(top); scrollY += Math.round(top); },
    },
  };
  const bubble = createTutorialBubble(panel, () => ({ element: summary, avoid: [memo, goal], preferredSide: side }));
  return { bubble, panel, summary, map, scrolls, flush() {
    for (let count = 0; frames.length; count++) {
      assert.ok(count < 4, 'Revealing settles without a scroll loop');
      frames.shift()();
    }
  } };
}

test('rounded page scrolling preserves a clear speech tail when a preferred fit misses by a fraction of a pixel', () => {
  for (const side of ['above', 'below']) {
    const { bubble, panel, map, scrolls, flush } = fixture(side);
    bubble.update(true); bubble.reveal(); flush();
    assert.equal(scrolls.length, 1, 'The initial 0.03125px shortfall receives real scrolling headroom');
    assert.equal(panel.dataset.placement, side, 'The bubble stays on the speaker side of the expanded reference');
    const top = Number.parseFloat(panel.style.top);
    assert.ok(top >= 12 && top + 158.6875 <= 844 - 12, 'Strict viewport padding remains intact');
    const coordinates = panel.children[0].firstElementChild.getAttribute('d')
      .match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi).map(Number);
    const ys = coordinates.filter((_, index) => index % 2).map(y => y + top), bounds = map.getBoundingClientRect();
    assert.ok(side === 'above' ? Math.max(...ys) <= bounds.top : Math.min(...ys) >= bounds.bottom,
      'The entire curved tail stays outside the expanded reference paths');
    bubble.hide();
  }
});

test('speech bubbles leave the compact mode menu accessible when the nearest position would cover it', () => {
  const menu = { left: 20, right: 370, top: 590, bottom: 650, width: 350, height: 60 };
  const { bubble, panel, flush } = fixture('above', menu);
  bubble.update(true); flush();
  const top = Number.parseFloat(panel.style.top);
  assert.ok(top >= menu.bottom + 12, 'The menu is kept clear without changing the explanation anchor');
  assert.ok(top + 158.6875 <= 832, 'The bubble still fits the viewport');
  bubble.hide();
});

test('menu avoidance never covers the demonstration when both cannot fit', () => {
  const original = fixture('above');
  original.bubble.update(true); original.flush();
  const crowded = fixture('above', { left: 0, right: 390, top: 0, bottom: 844, width: 390, height: 844 });
  crowded.bubble.update(true); crowded.flush();
  assert.equal(crowded.panel.style.top, original.panel.style.top);
  assert.equal(crowded.panel.style.left, original.panel.style.left);
  original.bubble.hide(); crowded.bubble.hide();
});
