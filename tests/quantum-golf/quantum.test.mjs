import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';
const {
  START_STATE, normalize, applyGate, gateRotation, gateTrajectory,
  traceDistance, targetCap, randomTarget,
} = await import(websiteFile('src/lib/quantum-golf/quantum.js'));

const tolerance = 1e-12;

function close(actual, expected, epsilon = tolerance) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
}

function vectorClose(actual, expected, epsilon = tolerance) {
  actual.forEach((component, index) => close(component, expected[index], epsilon));
}

// Test-only seeded sampling keeps statistical checks repeatable.
function seededRandom(seed) {
  let word = 2166136261;
  for (const character of String(seed)) {
    word = Math.imul(word ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return () => {
    word = (word + 0x6d2b79f5) >>> 0;
    let value = word;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent complex-amplitude simulation of the published gate matrices.
function amplitudeGate([a, b], gate) {
  if (gate === 'H') {
    return [
      [(a[0] + b[0]) * Math.SQRT1_2, (a[1] + b[1]) * Math.SQRT1_2],
      [(a[0] - b[0]) * Math.SQRT1_2, (a[1] - b[1]) * Math.SQRT1_2],
    ];
  }
  return [a, [(b[0] - b[1]) * Math.SQRT1_2, (b[0] + b[1]) * Math.SQRT1_2]];
}

function amplitudeBloch([a, b]) {
  return [
    2 * (a[0] * b[0] + a[1] * b[1]),
    2 * (a[0] * b[1] - a[1] * b[0]),
    a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1],
  ];
}

test('H and T agree with independent quantum gate matrices across a long circuit', () => {
  const random = seededRandom('matrix validation');
  let state = [...START_STATE];
  let amplitudes = [[Math.SQRT1_2, 0], [Math.SQRT1_2, 0]];
  for (let index = 0; index < 1000; index++) {
    const gate = random() < 0.5 ? 'H' : 'T';
    state = applyGate(state, gate);
    amplitudes = amplitudeGate(amplitudes, gate);
    vectorClose(state, amplitudeBloch(amplitudes));
    close(Math.hypot(...state), 1);
  }
});

test('gate identities and orientation use the standard Bloch convention', () => {
  const state = normalize([2, 3, 4]);
  vectorClose(applyGate(applyGate(state, 'H'), 'H'), state);
  let repeated = state;
  for (let index = 0; index < 8; index++) repeated = applyGate(repeated, 'T');
  vectorClose(repeated, state);
  assert.deepEqual(START_STATE, [1, 0, 0]);
  vectorClose(applyGate(START_STATE, 'H'), [0, 0, 1]);
  vectorClose(applyGate(START_STATE, 'T'), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  vectorClose(applyGate([0, 0, 1], 'T'), [0, 0, 1]);
  vectorClose(applyGate([0, 0, -1], 'T'), [0, 0, -1]);
});

test('preview and animation follow the gate rotation and share exact endpoints', () => {
  const state = normalize([0.2, -0.3, 0.7]);
  for (const gate of ['H', 'T']) {
    const rotate = gateRotation(state, gate);
    const points = gateTrajectory(state, gate, 32);
    assert.equal(points.length, 33);
    vectorClose(points[0], state);
    vectorClose(points.at(-1), applyGate(state, gate));
    // Animation reuses one prepared rotation for its entire duration.
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      assert.deepEqual(rotate(progress), points[progress * 32]);
    }
    assert.deepEqual(rotate(1), applyGate(state, gate));
    for (const progress of [NaN, Infinity, -0.1, 1.1]) {
      assert.throws(() => rotate(progress), RangeError);
    }
    points.forEach((point) => close(Math.hypot(...point), 1));
    const axis = gate === 'H' ? [Math.SQRT1_2, 0, Math.SQRT1_2] : [0, 0, 1];
    const projection = (point) => point.reduce((sum, component, index) => sum + component * axis[index], 0);
    points.forEach((point) => close(projection(point), projection(state)));
  }
  // H from |+> leaves the x/z plane during its natural rotation.
  vectorClose(gateRotation(START_STATE, 'H')(0.5), [0.5, Math.SQRT1_2, 0.5]);
  // An eigenstate remains still for every intermediate frame.
  const hAxis = [Math.SQRT1_2, 0, Math.SQRT1_2];
  gateTrajectory(hAxis, 'H').forEach((point) => vectorClose(point, hAxis));
  gateTrajectory([0, 0, 1], 'T').forEach((point) => vectorClose(point, [0, 0, 1]));
});

test('trace distance matches quantum overlap and stays stable near identical states', () => {
  close(traceDistance(START_STATE, START_STATE), 0);
  close(traceDistance(START_STATE, [-1, 0, 0]), 1);
  close(traceDistance(START_STATE, [0, 0, 1]), Math.SQRT1_2);
  for (const theta of [1e-9, 0.01, 0.4, 1.8, Math.PI]) {
    const state = [Math.cos(theta), Math.sin(theta), 0];
    close(traceDistance(START_STATE, state), Math.sin(theta / 2));
    close(1 - traceDistance(START_STATE, state) ** 2, Math.cos(theta / 2) ** 2);
  }
});

test('hole boundaries encode epsilon correctly even at poles and extreme cap sizes', () => {
  for (const target of [START_STATE, [0, 0, 1], [0, 0, -1], normalize([1, 2, 3])]) {
    for (const epsilon of [0, 0.03, 0.2, 0.4, 1]) {
      const points = targetCap(target, epsilon, 64);
      assert.equal(points.length, 65);
      assert.deepEqual(points[0], points.at(-1));
      for (const point of points) {
        close(Math.hypot(...point), 1);
        close(traceDistance(point, target), epsilon);
      }
    }
  }
});

test('random targets exclude the initial hole without rejection and retain uniform area', () => {
  for (const epsilon of [0, 0.03, 0.2, 0.4, 0.999]) {
    const random = seededRandom(`uniform-${epsilon}`);
    let zMean = 0;
    let xMean = 0;
    let yMean = 0;
    const count = 20000;
    for (let index = 0; index < count; index++) {
      const point = randomTarget(epsilon, random);
      close(Math.hypot(...point), 1);
      assert.ok(traceDistance(point, START_STATE) > epsilon);
      zMean += point[2];
      xMean += point[0];
      yMean += point[1];
    }
    // Area measure is uniform in x over [-1,1−2epsilon²].
    assert.ok(Math.abs(xMean / count + epsilon ** 2) < 0.015);
    assert.ok(Math.abs(zMean / count) < 0.015);
    assert.ok(Math.abs(yMean / count) < 0.015);
  }
  let calls = 0;
  const target = randomTarget(0.999999, () => { calls++; return 0.5; });
  assert.equal(calls, 2);
  assert.ok(traceDistance(target, START_STATE) > 0.999999);
});

test('invalid geometry is rejected instead of introducing NaN into rendering', () => {
  assert.throws(() => normalize([0, 0, 0]), RangeError);
  assert.throws(() => normalize([1.7e308, 1.7e308, 1.7e308]), RangeError);
  assert.throws(() => normalize([1, , 0]), RangeError);
  assert.throws(() => normalize([NaN, 0, 1]), TypeError);
  assert.throws(() => applyGate(START_STATE, 'X'), RangeError);
  assert.throws(() => gateRotation(START_STATE, 'X'), RangeError);
  assert.throws(() => gateRotation([0, 0, 0], 'H'), RangeError);
  assert.throws(() => targetCap(START_STATE, -0.1), RangeError);
  for (const steps of [0, -1, 1.5, Infinity]) assert.throws(() => targetCap(START_STATE, .1, steps), RangeError);
  assert.throws(() => randomTarget(1), RangeError);
});
