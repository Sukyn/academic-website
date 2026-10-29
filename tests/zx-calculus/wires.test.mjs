import test from 'node:test';
import assert from 'node:assert/strict';
import { decoratedWires, curvePoint, curveParameter, curveSlice, curveMetrics, curveDistance, arcFraction, arcParameter, hadamardSlots } from '../../src/lib/zx-calculus/wires.js';
import { applyMove, targetDiagram } from '../../src/lib/zx-calculus/engine.js';

const boundaries = () => targetDiagram().nodes;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
const allEdgesOnce = (diagram, wires) => assert.deepEqual(wires.flatMap(wire => wire.indices).sort((a, b) => a - b), diagram.edges.map((_, index) => index));

test('open H chains retain raw edge indexes and use increasing terminal order', () => {
  const diagram = { nodes: [...boundaries(), { id: 4, kind: 'z' }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' }, { id: 7, kind: 'x' }].reverse(),
    edges: [[7, 6], [5, 4], [6, 5], [0, 4], [7, 2], [1, 3]] };
  const saved = structuredClone(diagram), wires = decoratedWires(diagram);
  assert.deepEqual(wires.find(wire => wire.ids.length > 2), { ids: [4, 5, 6, 7], indices: [1, 2, 0] });
  assert.ok(wires.every(wire => wire.ids[0] < wire.ids.at(-1)));
  allEdgesOnce(diagram, wires); assert.deepEqual(diagram, saved);
});

test('parallel decorated and undecorated wires stay separate', () => {
  const diagram = { nodes: [...boundaries(), { id: 4, kind: 'z' }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' }, { id: 7, kind: 'x' }],
    edges: [[0, 4], [4, 2], [1, 7], [7, 3], [4, 5], [5, 7], [7, 6], [6, 4], [4, 7]] };
  const wires = decoratedWires(diagram), parallel = wires.filter(wire => wire.ids[0] === 4 && wire.ids.at(-1) === 7);
  assert.equal(parallel.length, 3);
  assert.deepEqual(parallel.map(wire => wire.ids), [[4, 5, 7], [4, 6, 7], [4, 7]]);
  allEdgesOnce(diagram, wires);
});

test('a return loop uses its raw edges instead of becoming a degenerate quadratic', () => {
  const diagram = { nodes: [...boundaries(), { id: 4, kind: 'z' }, { id: 5, kind: 'h' }, { id: 6, kind: 'h' }],
    edges: [[0, 4], [4, 2], [1, 3], [4, 5], [5, 6], [6, 4]] };
  const wires = decoratedWires(diagram), loop = wires.filter(wire => wire.indices.some(index => index >= 3));
  assert.equal(loop.length, 3); assert.ok(loop.every(wire => wire.ids.length === 2 && wire.indices.length === 1));
  allEdgesOnce(diagram, wires);
});

test('H-only cycles and a parallel HH pair keep every raw edge', () => {
  for (const edges of [[[4, 5], [5, 6], [6, 4]], [[4, 5], [5, 4]]]) {
    const ids = [...new Set(edges.flat())];
    const diagram = { nodes: [...boundaries(), ...ids.map(id => ({ id, kind: 'h' }))], edges: [[0, 2], [1, 3], ...edges] };
    const wires = decoratedWires(diagram);
    assert.equal(wires.length, diagram.edges.length); allEdgesOnce(diagram, wires);
  }
});

test('the longest valid H chain is traversed once without recursion', () => {
  const boxes = Array.from({ length: 28 }, (_, index) => index + 4), ids = [0, ...boxes, 2];
  const diagram = { nodes: [...boundaries(), ...boxes.map(id => ({ id, kind: 'h' }))], edges: [[1, 3], ...ids.slice(1).map((id, index) => [ids[index], id])] };
  const wires = decoratedWires(diagram);
  assert.equal(wires.length, 2); assert.deepEqual(wires.find(wire => wire.ids.length > 2).ids, ids);
  allEdgesOnce(diagram, wires);
});

test('colour changes decorate the same endpoint pairs without changing wire multiplicity', () => {
  const before = applyMove(targetDiagram(), { rule: 'insert', edge: [0, 2], kind: 'z' });
  let after = before;
  for (let count = 0; count < 4; count++) {
    after = applyMove(after, { rule: 'color', nodes: [4] });
    const wires = decoratedWires(after);
    assert.deepEqual(wires.map(wire => [wire.ids[0], wire.ids.at(-1)]), decoratedWires(before).map(wire => [wire.ids[0], wire.ids.at(-1)]));
    allEdgesOnce(after, wires);
  }
});

test('quadratic slices agree with the full curve at every sampled local parameter', () => {
  const curves = [{ a: { x: 0, y: 0 }, control: { x: 100, y: 90 }, b: { x: 200, y: 0 } },
    { a: { x: -62, y: 23 }, control: { x: 405, y: -250 }, b: { x: 100, y: 602 } }];
  for (const curve of curves) for (const [start, end] of [[0, 1], [0, .2], [.2, .8], [.8, 1], [1, 0], [.5, .5]]) {
    const saved = structuredClone(curve), slice = curveSlice(curve, start, end);
    for (const t of [0, .25, .5, .75, 1]) {
      const actual = curvePoint(slice, t), expected = curvePoint(curve, start + t * (end - start));
      close(actual.x, expected.x); close(actual.y, expected.y);
    }
    assert.deepEqual(curve, saved);
  }
});

test('midpoint-normal chord projection round-trips parameters without clamping', () => {
  const a = { x: 20, y: 30 }, b = { x: 220, y: 130 }, control = { x: 80, y: 160 };
  for (const curve of [{ a, b, control }, { a: b, b: a, control }]) {
    for (const t of [-1, 0, .25, .5, .75, 1, 2]) close(curveParameter(curve, curvePoint(curve, t)), t);
  }
  assert.equal(curveParameter({ a, b: a }, { x: 400, y: 200 }), 0);
});

test('new H boxes fill only the gaps around saved positions', () => {
  const a = { x: 20, y: 30 }, b = { x: 420, y: 330 };
  const curve = { a, b, control: { x: 190, y: 220 } };
  const positions = new Map([[5, curvePoint(curve, .3)], [7, curvePoint(curve, .85)]]), saved = structuredClone(positions);
  const slots = hadamardSlots([0, 4, 5, 6, 7, 2], positions, a, b);
  [.15, .3, .575, .85].forEach((expected, index) => close(slots[index], expected));
  assert.deepEqual(positions, saved);
});

test('saved ordered parameters survive independently of a curve bend', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 }, positions = { 4: { x: 12, y: 80 }, 5: { x: 50, y: -60 }, 6: { x: 90, y: 200 } };
  assert.deepEqual(hadamardSlots([0, 4, 5, 6, 2], positions, a, b), [.12, .5, .9]);
});

test('crossed or out-of-range saved positions stay ordered with a positive gap', () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
  for (const xs of [[80, 20, 21], [-100, 50, 200], [100, 100, 100]]) {
    const positions = new Map(xs.map((x, index) => [index + 4, { x, y: 0 }]));
    const slots = hadamardSlots([0, 4, 5, 6, 2], positions, a, b);
    assert.ok(slots[0] > 0 && slots.at(-1) < 1);
    assert.ok(slots.slice(1).every((value, index) => value - slots[index] >= .04 - 1e-12));
  }
});

test('fresh chains, missing positions and coincident endpoints have finite even slots', () => {
  const a = { x: 10, y: 10 }, b = { x: 110, y: 20 }, ids = [0, 4, 5, 6, 2];
  assert.deepEqual(hadamardSlots(ids, undefined, a, b), [.25, .5, .75]);
  assert.deepEqual(hadamardSlots(ids, new Map([[4, { x: NaN, y: 0 }]]), a, b), [.25, .5, .75]);
  assert.deepEqual(hadamardSlots(ids, new Map([[4, { x: 30, y: 30 }]]), a, a), [.25, .5, .75]);
  assert.deepEqual(hadamardSlots([0, 2], undefined, a, b), []);
});

test('curve metrics reuse sixteen segments for distances and accumulated length', () => {
  const curve = { a: { x: 0, y: 0 }, control: { x: 50, y: 0 }, b: { x: 100, y: 0 } };
  const saved = structuredClone(curve), metrics = curveMetrics(curve);
  assert.equal(metrics.segments.length, 16); close(metrics.length, 100);
  close(curveDistance({ x: 32, y: 7 }, metrics), 7);
  close(curveDistance({ x: -3, y: 4 }, metrics), 5);
  for (let index = 0; index < metrics.segments.length; index++) close(metrics.segments[index].offset, index * 100 / 16);
  assert.deepEqual(curve, saved);
});

test('arc fractions and parameters round-trip on straight, curved and reversed quadratics', () => {
  for (const curve of [
    { a: { x: 0, y: 0 }, control: { x: 50, y: 0 }, b: { x: 100, y: 0 } },
    { a: { x: 20, y: 30 }, control: { x: -120, y: 400 }, b: { x: 420, y: 330 } },
    { a: { x: 420, y: 330 }, control: { x: -120, y: 400 }, b: { x: 20, y: 30 } },
  ]) {
    const metrics = curveMetrics(curve);
    for (let index = 0; index <= 100; index++) {
      const t = index / 100;
      close(arcParameter(arcFraction(t, metrics), metrics), t);
      close(arcFraction(arcParameter(t, metrics), metrics), t);
    }
    assert.equal(arcParameter(-1, metrics), 0); assert.equal(arcFraction(2, metrics), 1);
  }
});

test('degenerate curves have finite metrics and leave normalized positions unchanged', () => {
  const point = { x: 20, y: 30 }, metrics = curveMetrics({ a: point, b: point, control: point });
  assert.equal(metrics.length, 0); close(curveDistance({ x: 23, y: 34 }, metrics), 5);
  for (const t of [0, .1, .5, .9, 1]) {
    assert.equal(arcFraction(t, metrics), t); assert.equal(arcParameter(t, metrics), t);
  }
});

test('H slots preserve old parameters in arc space and respect a physical spacing fraction', () => {
  const curve = { a: { x: 0, y: 0 }, control: { x: 50, y: 150 }, b: { x: 100, y: 0 } }, metrics = curveMetrics(curve);
  const position = curvePoint(curve, .35), oldFraction = arcFraction(.35, metrics);
  const slots = hadamardSlots([0, 4, 5, 2], new Map([[4, position]]), curve.a, curve.b,
    { minimumGap: .2, parameter: t => arcFraction(t, metrics) });
  close(slots[0], oldFraction); close(slots[1], (oldFraction + 1) / 2);
  assert.ok(slots[1] - slots[0] >= .2 && 1 - slots[1] >= .2);
});
