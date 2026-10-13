import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';
import { runPython } from '../../tools/quantum-golf/python.mjs';
const { START_STATE, applyGate, traceDistance, normalize } = await import(websiteFile('src/lib/quantum-golf/quantum.js'));
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });

const replay = (sequence) => [...sequence].reduce(applyGate, START_STATE);

// Independent, unpruned breadth-first enumeration includes HH, leading T and
// T^8. This catches a pruning mistake in the production optimum search.
function bruteMinimum(target, epsilon, maxDepth) {
  let states = [START_STATE];
  for (let depth = 0; depth <= maxDepth; depth++) {
    if (states.some((state) => traceDistance(state, target) <= epsilon)) return depth;
    if (depth < maxDepth) states = states.flatMap((state) => ['H', 'T'].map((gate) => applyGate(state, gate)));
  }
  return null;
}

test('campaign holes have fixed, independently verified nondecreasing shortest move counts', () => {
  assert.deepEqual(LEVELS.map((level) => level.id), Array.from({ length: LEVELS.length }, (_, index) => index + 1));
  assert.ok(LEVELS.at(-1).optimalMoves >= 24, 'The final hole needs a substantially longer circuit');
  assert.ok(LEVELS.at(-1).epsilon <= 0.003, 'The final hole demands fine precision');
  const verification = runPython([fileURLToPath(websiteFile('tools/quantum-golf/precompute.py')), '--check']);
  assert.equal(verification.status, 0, verification.error?.message || verification.stderr);
  assert.match(verification.stdout, /Checked both generated files/);
  for (const [index, level] of LEVELS.entries()) {
    assert.ok(Math.abs(Math.hypot(...level.target) - 1) < 1e-12);
    assert.ok(traceDistance(START_STATE, level.target) > level.epsilon);
    assert.ok(level.epsilon > 0 && level.epsilon < 1);
    if (index) assert.ok(level.epsilon < LEVELS[index - 1].epsilon);
    if (index) assert.ok(level.optimalMoves >= LEVELS[index - 1].optimalMoves);
    // Offline certificates may use more nodes than the bounded browser worker.
    const solution = solveShortest(level.target, level.epsilon, { maxDepth: level.optimalMoves, maxNodes: 2_000_000 });
    assert.equal(solution.status, 'optimal');
    assert.equal(solution.optimalMoves, level.optimalMoves);
    assert.equal(solution.checkedDepth, level.optimalMoves - 1);
    assert.equal(solution.sequence.length, level.optimalMoves);
    assert.match(solution.sequence, /^[HT]+$/);
    assert.ok(traceDistance(replay(solution.sequence), level.target) < level.epsilon);
    assert.ok(level.title);
    assert.equal('sequence' in level, false, 'Campaign metadata must not ship the benchmark circuit');
    assert.equal('witness' in level, false);
  }
});

test('shortest search measures all H and T moves, including targets already reached', () => {
  const reached = solveShortest(START_STATE, 0.01);
  assert.equal(reached.status, 'optimal');
  assert.equal(reached.optimalMoves, 0);
  assert.equal(reached.sequence, '');
  for (const sequence of ['H', 'T', 'TH', 'TT', 'HT', 'HTH', 'THT', 'TTTT', 'HTHTTH']) {
    const target = replay(sequence);
    const expected = bruteMinimum(target, 0.001, sequence.length);
    const result = solveShortest(target.map((coordinate) => coordinate * 3), 0.001, { maxDepth: sequence.length });
    assert.equal(result.status, 'optimal');
    assert.equal(result.optimalMoves, expected);
    assert.equal(result.sequence.length, expected);
    assert.ok(traceDistance(replay(result.sequence), target) < 0.001);
    assert.equal(result.sequence.includes('HH'), false);
    assert.equal(result.sequence.includes('TTTTTTTT'), false);
  }
});

test('generic approximate targets agree with unpruned search at several hole sizes', () => {
  for (let sample = 0; sample < 12; sample++) {
    const z = -0.9 + sample * 1.8 / 11;
    const azimuth = sample * 2.399963229728653;
    const radius = Math.sqrt(1 - z * z);
    const target = [radius * Math.cos(azimuth), radius * Math.sin(azimuth), z];
    for (const epsilon of [0.08, 0.2, 0.4]) {
      const expected = bruteMinimum(target, epsilon, 8);
      const result = solveShortest(target, epsilon, { maxDepth: 8 });
      assert.equal(result.status, expected === null ? 'limit' : 'optimal');
      assert.equal(result.optimalMoves, expected);
      if (expected !== null) assert.ok(traceDistance(replay(result.sequence), target) < epsilon);
      else assert.equal(result.checkedDepth, 8);
    }
  }
});

test('bounded or numerically ambiguous searches never claim an unproved optimum', () => {
  const target = normalize([0.2, 0.6, -0.7]);
  const byDepth = solveShortest(target, 0.001, { maxDepth: 3 });
  assert.equal(byDepth.status, 'limit');
  assert.equal(byDepth.checkedDepth, 3);
  assert.equal(byDepth.optimalMoves, null);
  assert.equal(byDepth.sequence, null);
  const byNodes = solveShortest(target, 0.001, { maxNodes: 1 });
  assert.equal(byNodes.status, 'limit');
  assert.equal(byNodes.checkedDepth, 0);
  assert.equal(byNodes.optimalMoves, null);
  assert.ok(byNodes.visited <= 1, 'The node limit must stop search promptly');

  // The start lies on the hole boundary; T lands definitely inside. Floating
  // roundoff must not certify that no zero-move solution exists.
  const boundaryTarget = [0.5, Math.sqrt(3) / 2, 0];
  const boundary = solveShortest(boundaryTarget, 0.5, { maxDepth: 1 });
  assert.equal(boundary.status, 'boundary');
  assert.equal(boundary.optimalMoves, null);
  assert.equal(boundary.sequence, 'T');
  assert.ok(traceDistance(replay(boundary.sequence), boundaryTarget) < 0.5);
  const boundaryOnly = solveShortest(boundaryTarget, 0.5, { maxDepth: 0 });
  assert.equal(boundaryOnly.status, 'boundary');
  assert.equal(boundaryOnly.optimalMoves, null);
  assert.equal(boundaryOnly.sequence, null);
});

test('shortest search rejects invalid geometry, epsilon and computational budgets', () => {
  for (const target of [[0, 0, 0], [NaN, 0, 1], [0, 1], null]) {
    assert.throws(() => solveShortest(target, 0.2));
  }
  for (const epsilon of [NaN, Infinity, -0.1, 0, 1.01]) {
    assert.throws(() => solveShortest(START_STATE, epsilon), RangeError);
  }
  for (const options of [{ maxDepth: -1 }, { maxDepth: 1.5 }, { maxDepth: 41 }, { maxNodes: 0 }, { maxNodes: 1.5 }]) {
    assert.throws(() => solveShortest(START_STATE, 0.2, options), RangeError);
  }
});

test('campaign runtime data omits circuits and offline generation fixtures', async () => {
  const source = await readFile(websiteFile('src/lib/quantum-golf/levels.json'), 'utf8');
  assert.doesNotMatch(source, /["'](?:witness|generationWitness|sequence)["']\s*:/);
  assert.doesNotMatch(source, /witnesses\.json/);
});
