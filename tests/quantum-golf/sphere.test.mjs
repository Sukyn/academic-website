import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';

const { BlochSphere } = await import(websiteFile('src/lib/quantum-golf/sphere.js'));
const { START_STATE, applyGate, gateRotation } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
const samePoint = (actual, expected) => actual.forEach((value, i) => close(value, expected[i]));

// Use the real camera and projection without browser event listeners or drawing.
function sphere() {
  const instance = Object.create(BlochSphere.prototype);
  const noop = () => {};
  Object.assign(instance, {
    ctx: Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'setLineDash', 'fill', 'closePath', 'arc', 'fillText'].map(name => [name, noop])),
    canvas: { style: {} },
    width: 600, height: 500, view: { yaw: 0.72, pitch: 0.28, zoom: 1 },
    state: START_STATE, model: { state: START_STATE, target: null, sequence: '', showTrace: false, animation: null },
    traces: [], history: [], boundary: null,
  });
  instance.render();
  return instance;
}

function centered(instance, point) {
  instance.render();
  const projected = instance.project(point);
  close(projected.x, instance.cx);
  close(projected.y, instance.cy);
  close(projected.depth, 1);
}

test('lost pointer capture cancels dragging, and restored canvas redraws the current round', (context) => {
  const originalWindow = globalThis.window, originalObserver = globalThis.ResizeObserver;
  globalThis.window = { devicePixelRatio: 2 };
  globalThis.ResizeObserver = class { observe() {} };
  context.after(() => {
    globalThis.window = originalWindow;
    globalThis.ResizeObserver = originalObserver;
  });
  const events = new Map(), captured = new Set();
  let transforms = 0, picks = 0;
  const ctx = sphere().ctx;
  ctx.setTransform = () => transforms++;
  const canvas = {
    style: {}, getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 500 }),
    addEventListener: (name, handler) => events.set(name, handler),
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
  };
  const instance = new BlochSphere(canvas, { onPick: () => picks++ });
  instance.setState({ pickMode: true, sequence: 'TH', state: applyGate(applyGate(START_STATE, 'T'), 'H') });
  const down = pointerId => events.get('pointerdown')({ pointerId, button: 0, clientX: 300, clientY: 250 });
  down(1);
  assert.equal(instance.pointers.size, 1);
  captured.delete(1);
  events.get('lostpointercapture')({ pointerId: 1 });
  assert.equal(instance.pointers.size, 0);
  assert.equal(instance.drag, null);
  assert.equal(picks, 0, 'Losing capture must not choose a target');
  down(2);
  assert.equal(instance.pointers.size, 1, 'The next gesture starts with one pointer');
  assert.equal(instance.drag.moved, false);
  const model = { ...instance.model }, view = { ...instance.view }, before = transforms;
  events.get('contextrestored')();
  assert.equal(transforms, before + 1, 'Restoration reinstates the pixel scaling');
  assert.deepEqual(instance.model, model);
  assert.deepEqual(instance.view, view);
});

test('camera arrival centers gate destinations on the visible hemisphere', () => {
  const instance = sphere();
  const diagonal = Math.sqrt(1 / 3);
  for (const point of [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0], [diagonal, -diagonal, diagonal], [-diagonal, diagonal, -diagonal]]) {
    const start = { ...instance.view };
    const follow = instance.cameraTo(point);
    follow(0);
    assert.deepEqual(instance.view, start);
    for (const progress of [0.2, 0.5, 0.8, 1]) {
      follow(progress);
      instance.render();
      assert.ok(Object.values(instance.project(point)).every(Number.isFinite));
    }
    centered(instance, point);
  }
});

test('camera animation updates orientation without scheduling extra drawing', () => {
  const instance = sphere();
  let draws = 0;
  instance.ctx.clearRect = () => { draws++; };
  const follow = instance.cameraTo([1, 0, 0]);
  for (const progress of [0, 0.2, 0.5, 1]) follow(progress);
  assert.equal(draws, 0);
  instance.render();
  assert.equal(draws, 1);
});

test('camera takes the short route when crossing the longitude seam', () => {
  const instance = sphere();
  instance.view.yaw = Math.PI - 0.1;
  instance.view.pitch = 0;
  const startYaw = instance.view.yaw;
  const point = [-Math.sin(0.1), -Math.cos(0.1), 0];
  const follow = instance.cameraTo(point);
  follow(0.5);
  centered(instance, [0, -1, 0]);
  follow(1);
  assert.ok(Math.abs(instance.view.yaw - startYaw) < 0.21);
  centered(instance, point);
});

test('both poles can be centered without changing longitude', () => {
  const instance = sphere();
  const yaw = instance.view.yaw;
  for (const point of [[0, 0, 1], [0, 0, -1]]) {
    const follow = instance.cameraTo(point);
    for (const progress of [0, 0.25, 0.5, 1]) {
      follow(progress);
      close(instance.view.yaw, yaw);
      assert.ok(Number.isFinite(instance.view.pitch));
    }
    centered(instance, point);
  }
});

test('zoom adjustments survive the rest of an active camera animation', () => {
  const instance = sphere();
  const follow = instance.cameraTo([1, 0, 0]);
  follow(0.3);
  instance.zoomBy(1.2);
  for (const progress of [0.5, 0.8, 1]) {
    follow(progress);
    close(instance.view.zoom, 1.2);
  }
  centered(instance, [1, 0, 0]);
});

test('manual rotation takes control from an active animation', () => {
  const instance = sphere();
  const follow = instance.cameraTo([1, 0, 0]);
  follow(0.3);
  instance.rotateBy(20, -10);
  const manualView = { ...instance.view };
  follow(0.5);
  follow(1);
  assert.deepEqual(instance.view, manualView);
});

test('trace follows physical gate curves and reuses only the unchanged circuit prefix', () => {
  const instance = sphere();
  instance.setState({ sequence: 'TH' });
  assert.equal(instance.history.length, 0, 'Trace starts disabled');
  instance.setState({ showTrace: true });
  assert.deepEqual(instance.history.map(path => path.gate), ['T', 'H']);
  const [t, h] = instance.history;
  samePoint(t.points[0], START_STATE);
  samePoint(t.points[16], [Math.cos(Math.PI / 8), Math.sin(Math.PI / 8), 0]);
  samePoint(t.points.at(-1), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  samePoint(h.points[0], t.points.at(-1));
  samePoint(h.points[16], [Math.SQRT1_2 / 2 - 0.5, 0.5, Math.SQRT1_2 / 2 + 0.5]);
  samePoint(h.points.at(-1), [0, -Math.SQRT1_2, Math.SQRT1_2]);
  for (const path of instance.history) for (const point of path.points) close(Math.hypot(...point), 1);

  instance.setState({ sequence: 'THT' });
  assert.equal(instance.history[0], t);
  assert.equal(instance.history[1], h);
  samePoint(instance.history.at(-1).points.at(-1), [...'THT'].reduce(applyGate, START_STATE));
  instance.setState({ state: [0, 1, 0] });
  instance.rotateBy(10, -5);
  instance.zoomBy(1.1);
  assert.equal(instance.history[0], t, 'Animation and camera changes do not rebuild completed paths');
  assert.equal(instance.history[1], h);

  instance.setState({ sequence: 'T' });
  assert.equal(instance.history.length, 1, 'Undo removes the unused suffix');
  assert.equal(instance.history[0], t);
  instance.setState({ sequence: 'THH' });
  assert.equal(instance.history[0], t);
  assert.equal(instance.history[1].gate, 'H');
  samePoint(instance.history.at(-1).points.at(-1), t.points.at(-1));
  instance.setState({ showTrace: false });
  assert.equal(instance.history.length, 0, 'Disabled trace releases its geometry');
  instance.setState({ sequence: 'TH' });
  instance.setState({ showTrace: true });
  assert.equal(instance.history.length, 2, 'Re-enabling reconstructs the current circuit');
  samePoint(instance.history.at(-1).points.at(-1), [0, -Math.SQRT1_2, Math.SQRT1_2]);
  instance.setState({ sequence: '' });
  assert.equal(instance.history.length, 0, 'A fresh hole clears the previous path');
});

test('active trace grows along the current gate and is hidden immediately when disabled', () => {
  const instance = sphere(), calls = [];
  instance.path = (points, front, stroke, _width, dash = []) => calls.push({ points, front, stroke, dash });
  const historyCalls = () => calls.filter(call => call.dash.length === 0 && /rgba\((238,159,134|181,162,234),/.test(call.stroke));
  const afterT = applyGate(START_STATE, 'T'), rotate = gateRotation(afterT, 'H');
  instance.setState({ sequence: 'T', showTrace: true, state: rotate(0.5), animation: { gate: 'H', rotate, progress: 0.5 } });
  const completed = instance.history[0];
  assert.equal(historyCalls().length, 4, 'Completed and active gates draw both clipped hemispheres');
  const active = historyCalls().filter(call => call.stroke.startsWith('rgba(238,159,134,'));
  assert.equal(active.length, 2);
  for (const call of active) {
    assert.deepEqual(call.points[0], instance.project(afterT));
    assert.deepEqual(call.points.at(-1), instance.project(rotate(0.5)), 'The trace stops at the animated point');
    assert.deepEqual(call.points[16], instance.project(rotate(0.25)), 'The active trace follows the partial rotation');
  }

  calls.length = 0;
  instance.setState({ state: rotate(0.75), animation: { gate: 'H', rotate, progress: 0.75 } });
  assert.equal(instance.history[0], completed);
  for (const call of historyCalls().filter(call => call.stroke.startsWith('rgba(238,159,134,'))) {
    assert.deepEqual(call.points.at(-1), instance.project(rotate(0.75)));
  }
  calls.length = 0;
  instance.setState({ showTrace: false });
  assert.equal(historyCalls().length, 0);
  calls.length = 0;
  instance.setState({ showTrace: true });
  assert.equal(historyCalls().length, 4, 'Toggling back on during a gate restores completed and active paths');
  calls.length = 0;
  instance.setState({ sequence: 'TH', state: rotate(1), animation: null });
  assert.equal(historyCalls().length, 4, 'Committing a gate replaces its partial trace without duplicating it');
});
