import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTutorialBubble, unionTutorialRects, tutorialSpeechTail } from '../../src/lib/games/tutorial-placement.js';

const overlaps = (first, second) => Math.max(0, Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left)) *
  Math.max(0, Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top));
const inside = (position, bubble, viewport) => {
  assert.ok(position.left >= viewport.left && position.top >= viewport.top);
  assert.ok(position.left + bubble.width <= viewport.left + viewport.width);
  assert.ok(position.top + bubble.height <= viewport.top + viewport.height);
};
const finitePlacement = result => {
  assert.ok(['above', 'below', 'left', 'right'].includes(result.side));
  for (const key of ['left', 'top', 'arrow']) assert.ok(Number.isFinite(result[key]), key);
};

test('desktop bubbles sit beside a focus while narrow viewports prefer below it', () => {
  const anchor = { left: 300, top: 250, width: 20, height: 20 }, bubble = { width: 180, height: 100 };
  assert.deepEqual(placeTutorialBubble(anchor, bubble, { left: 0, top: 0, width: 1000, height: 700 }),
    { left: 332, top: 210, side: 'right', arrow: 50 });
  assert.deepEqual(placeTutorialBubble({ ...anchor, left: 180 }, bubble, { left: 0, top: 0, width: 390, height: 700 }),
    { left: 100, top: 282, side: 'below', arrow: 90 });
});

test('preferred placement yields to another side when it would cover the focus or leave the viewport', () => {
  const bubble = { width: 150, height: 90 }, viewport = { left: 0, top: 0, width: 800, height: 600 };
  const center = { left: 300, top: 250, width: 30, height: 30 };
  assert.equal(placeTutorialBubble(center, bubble, viewport, { preferredSide: 'above' }).side, 'above');
  const corner = { left: 2, top: 2, width: 30, height: 30 };
  const result = placeTutorialBubble(corner, bubble, viewport, { preferredSide: 'above' });
  assert.notEqual(result.side, 'above'); inside(result, bubble, viewport);
  assert.equal(overlaps({ ...result, ...bubble }, corner), 0);
});

test('protected animation areas stay clear and the nearest fitting side keeps tails short', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 844 }, bubble = { width: 366, height: 180 };
  const graph = { left: 40, top: 240, width: 310, height: 310 };
  const vertex = { left: 60, top: 300, width: 44, height: 44 };
  const above = placeTutorialBubble(vertex, bubble, viewport, { avoid: [graph] });
  assert.equal(above.side, 'above'); inside(above, bubble, viewport);
  assert.equal(overlaps({ ...above, ...bubble }, graph), 0);
  const below = placeTutorialBubble({ ...vertex, top: 460 }, bubble, viewport, { avoid: [graph] });
  assert.equal(below.side, 'below');
  assert.equal(overlaps({ ...below, ...bubble }, graph), 0);
  const rewrite = { left: 40, top: 350, width: 240, height: 180 };
  const gate = { left: 100, top: 360, width: 44, height: 44 };
  const result = placeTutorialBubble(gate, bubble, viewport, { avoid: [rewrite] });
  assert.equal(overlaps({ ...result, ...bubble }, rewrite), 0, 'Both wires and the full commutation path stay clear');
});

test('speech tails form one closed curved shape and taper towards the actual speaker', () => {
  const viewport = { left: 0, top: 0, width: 800, height: 700 }, bubble = { width: 240, height: 140 };
  const speaker = { left: 350, top: 300, width: 30, height: 30 };
  for (const preferredSide of ['above', 'below', 'left', 'right']) {
    const placement = placeTutorialBubble(speaker, bubble, viewport, { preferredSide });
    const tail = tutorialSpeechTail(speaker, bubble, placement, viewport);
    assert.match(tail.path, /^M[^C]+C[^C]+C[^Z]+Z$/);
    const coordinates = tail.path.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi).map(Number);
    assert.equal(coordinates.length, 14); assert.ok(coordinates.every(Number.isFinite));
    const tip = { x: coordinates[6] + placement.left, y: coordinates[7] + placement.top };
    const distance = Math.hypot(Math.max(speaker.left - tip.x, 0, tip.x - speaker.left - speaker.width),
      Math.max(speaker.top - tip.y, 0, tip.y - speaker.top - speaker.height));
    assert.equal(distance, 4);
    const horizontal = preferredSide === 'above' || preferredSide === 'below';
    const normal = horizontal ? 1 : 0;
    assert.equal(coordinates[normal], coordinates[normal + 2], 'The first shoulder follows the bubble edge');
    assert.equal(coordinates[normal + 10], coordinates[normal + 12], 'The second shoulder follows the bubble edge');
    assert.ok(Object.values(tail.base).every(Number.isFinite));
  }
});

test('short speech tails have a smaller base and their curve does not flip at the viewport midpoint', () => {
  const viewport = { left: 0, top: 0, width: 800, height: 700 }, bubble = { width: 240, height: 140 };
  const placement = { left: 250, top: 100, side: 'above', arrow: 120 };
  const speaker = { left: 350, top: 252, width: 40, height: 40 };
  const short = tutorialSpeechTail(speaker, bubble, placement, viewport);
  const long = tutorialSpeechTail({ ...speaker, top: 440 }, bubble, placement, viewport);
  assert.ok(short.base.x2 - short.base.x1 < long.base.x2 - long.base.x1);
  const translate = 80;
  const moved = tutorialSpeechTail({ ...speaker, left: speaker.left + translate }, bubble,
    { ...placement, left: placement.left + translate }, viewport);
  assert.equal(moved.path, short.path, 'Translating the speaker and bubble preserves the local curve');
});

test('a bubble sits beside the two selected gates, within the circuit rather than outside the whole board', () => {
  const gates = [{ left: 75, top: 350, width: 44, height: 44 }, { left: 139, top: 350, width: 44, height: 44 }];
  const anchor = unionTutorialRects(gates);
  assert.deepEqual(anchor, { left: 75, top: 350, right: 183, bottom: 394, width: 108, height: 44 });
  const bubble = { width: 296, height: 180 }, viewport = { left: 0, top: 0, width: 390, height: 844 };
  const result = placeTutorialBubble(anchor, bubble, viewport);
  inside(result, bubble, viewport);
  assert.equal(result.side, 'below');
  for (const gate of gates) assert.equal(overlaps({ ...result, ...bubble }, gate), 0);
  assert.equal(result.top, anchor.bottom + 12);
  assert.equal(result.left + result.arrow, anchor.left + anchor.width / 2);
  assert.equal(unionTutorialRects([]), null);
});

test('every corner remains inside an offset viewport without hiding the referent', () => {
  const viewport = { left: 70, top: 120, width: 390, height: 640 }, bubble = { width: 230, height: 130 };
  for (const left of [70, 420]) for (const top of [120, 720]) {
    const anchor = { left, top, width: 40, height: 40 }, result = placeTutorialBubble(anchor, bubble, viewport);
    finitePlacement(result); inside(result, bubble, viewport);
    assert.equal(overlaps({ ...result, ...bubble }, anchor), 0);
    assert.ok(result.arrow >= 12 && result.arrow <= (['above', 'below'].includes(result.side) ? bubble.width : bubble.height) - 12);
  }
});

test('large and partly hidden referents use their visible intersection rather than their offscreen center', () => {
  const viewport = { left: 0, top: 0, width: 800, height: 600 }, bubble = { width: 180, height: 100 };
  const anchor = { left: -1000, top: 170, width: 1120, height: 60 };
  const result = placeTutorialBubble(anchor, bubble, viewport);
  assert.deepEqual(result, { left: 132, top: 150, side: 'right', arrow: 50 });
  assert.equal(overlaps({ ...result, ...bubble }, anchor), 0);
  const wide = { left: -500, top: 250, width: 1800, height: 60 };
  const below = placeTutorialBubble(wide, bubble, viewport);
  assert.equal(below.side, 'below'); assert.equal(below.left, 310);
  assert.equal(overlaps({ ...below, ...bubble }, wide), 0);
});

test('fully offscreen anchors point at the nearest viewport edge', () => {
  const viewport = { left: 50, top: 80, width: 300, height: 400 }, bubble = { width: 160, height: 100 };
  for (const anchor of [{ left: 900, top: 220, width: 20, height: 20 },
    { left: -900, top: 220, width: 20, height: 20 }, { left: 180, top: -100, width: 20, height: 20 }]) {
    const result = placeTutorialBubble(anchor, bubble, viewport);
    finitePlacement(result); inside(result, bubble, viewport);
    assert.ok(result.arrow >= 12);
  }
});

test('tiny viewports relax padding and oversized bubbles remain finite at a visible origin', () => {
  const viewport = { left: 15, top: 30, width: 40, height: 30 }, anchor = { left: 33, top: 43, width: 4, height: 4 };
  const bubble = { width: 36, height: 26 }, result = placeTutorialBubble(anchor, bubble, viewport);
  inside(result, bubble, viewport); finitePlacement(result);
  assert.equal(result.left, 17); assert.equal(result.top, 32);
  const huge = placeTutorialBubble(anchor, { width: 500, height: 300 }, viewport);
  finitePlacement(huge); assert.equal(huge.left, viewport.left); assert.equal(huge.top, viewport.top);
  finitePlacement(placeTutorialBubble({}, {}, { left: 10, top: 20, width: 0, height: 0 }));
});

test('a bubble avoids the focus across a grid whenever any adjacent side has enough room', () => {
  const viewport = { left: 35, top: 75, width: 800, height: 600 };
  for (const bubble of [{ width: 160, height: 80 }, { width: 350, height: 160 }]) {
    for (let x = -1; x <= 8; x++) for (let y = -1; y <= 6; y++) {
      const anchor = { left: viewport.left + x * 100, top: viewport.top + y * 100, width: 40, height: 40 };
      const saved = structuredClone({ anchor, bubble, viewport });
      const result = placeTutorialBubble(anchor, bubble, viewport);
      finitePlacement(result); inside(result, bubble, viewport);
      assert.equal(overlaps({ ...result, ...bubble }, anchor), 0, JSON.stringify({ anchor, bubble, result }));
      assert.deepEqual({ anchor, bubble, viewport }, saved);
    }
  }
});

test('invalid preferences and nonfinite measurements never produce invalid CSS coordinates', () => {
  const result = placeTutorialBubble({ left: NaN, top: Infinity, width: -1, height: 0 },
    { width: 80, height: 40 }, { left: 20, top: 30, width: 200, height: 100 },
    { preferredSide: 'invalid', gap: -100, padding: NaN });
  finitePlacement(result);
  inside(result, { width: 80, height: 40 }, { left: 20, top: 30, width: 200, height: 100 });
});
