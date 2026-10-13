import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_START, DAILY_TIME_ZONE, DAILY_VERSION,
  dailyDate, dailyBounds, dailyPuzzle, validDailyDate,
} from '../../src/lib/quantum-golf/daily.js';

const DAY = 86_400_000;
const timestamp = date => Date.parse(`${date}T00:00:00Z`);
const iso = milliseconds => new Date(milliseconds).toISOString();
const dateAfter = (date, days) => iso(timestamp(date) + days * DAY).slice(0, 10);

// Independent complex-amplitude H/T implementation, with no pruning. Prepare
// all 2^depth words once so the daily certificates can be checked independently.
function reachableStates(maxDepth) {
  const h = ([ar, ai, br, bi]) => [
    (ar + br) * Math.SQRT1_2, (ai + bi) * Math.SQRT1_2,
    (ar - br) * Math.SQRT1_2, (ai - bi) * Math.SQRT1_2,
  ];
  const t = ([ar, ai, br, bi]) => [ar, ai,
    (br - bi) * Math.SQRT1_2, (br + bi) * Math.SQRT1_2];
  let amplitudes = [[Math.SQRT1_2, 0, Math.SQRT1_2, 0]];
  const states = [];
  for (let depth = 0; depth <= maxDepth; depth++) {
    states.push(amplitudes.map(([ar, ai, br, bi]) => [
      2 * (ar * br + ai * bi), 2 * (ar * bi - ai * br),
      ar * ar + ai * ai - br * br - bi * bi,
    ]));
    amplitudes = amplitudes.flatMap(state => [h(state), t(state)]);
  }
  return states;
}

test('Paris civil dates change at midnight in summer and winter', () => {
  assert.equal(DAILY_TIME_ZONE, 'Europe/Paris');
  assert.equal(DAILY_START, '2026-10-13');
  for (const [before, at, date, next] of [
    ['2026-10-13T21:59:59.999Z', '2026-10-13T22:00:00Z', '2026-10-13', '2026-10-14'],
    ['2027-01-04T22:59:59.999Z', '2027-01-04T23:00:00Z', '2027-01-04', '2027-01-05'],
  ]) {
    assert.equal(dailyDate(Date.parse(before)), date);
    assert.equal(dailyDate(Date.parse(at)), next);
  }
  assert.throws(() => dailyDate(NaN), RangeError);
});

test('scoring bounds follow 23-hour and 25-hour Paris DST days', () => {
  const spring = dailyBounds('2027-03-28');
  assert.equal(iso(spring.opensAt), '2027-03-27T23:00:00.000Z');
  assert.equal(iso(spring.closesAt), '2027-03-28T22:00:00.000Z');
  assert.equal(spring.closesAt - spring.opensAt, 23 * 3_600_000);
  const autumn = dailyBounds('2027-10-31');
  assert.equal(iso(autumn.opensAt), '2027-10-30T22:00:00.000Z');
  assert.equal(iso(autumn.closesAt), '2027-10-31T23:00:00.000Z');
  assert.equal(autumn.closesAt - autumn.opensAt, 25 * 3_600_000);
  for (const date of ['2026-10-13', '2027-03-28', '2027-10-31', '2028-02-29', '2028-12-31']) {
    const { opensAt, closesAt } = dailyBounds(date);
    assert.equal(dailyDate(opensAt), date);
    assert.equal(dailyDate(closesAt - 1), date);
    assert.equal(dailyDate(closesAt), dateAfter(date, 1));
    assert.equal(dailyBounds(dateAfter(date, 1)).opensAt, closesAt);
  }
});

test('archive dates are canonical, real, launched, and not in the future', () => {
  const now = Date.parse('2028-02-29T12:00:00Z');
  assert.equal(validDailyDate(DAILY_START, now), true);
  assert.equal(validDailyDate('2028-02-29', now), true);
  assert.equal(validDailyDate('2028-03-01', now), false);
  assert.equal(validDailyDate('2026-10-12', now), false);
  for (const date of [null, 20261013, '', '2026-1-13', '2026-10-13T00:00:00Z',
    '2027-02-29', '2028-02-30', '2028-13-01', '2028-00-10', '2028-03-00']) {
    assert.equal(validDailyDate(date, now), false);
    assert.throws(() => dailyBounds(date), RangeError);
    assert.throws(() => dailyPuzzle(date), RangeError);
  }
  assert.throws(() => dailyPuzzle('2026-10-12'), RangeError);
  assert.equal(validDailyDate('2026-10-14', Date.parse('2026-10-13T21:59:59.999Z')), false);
  assert.equal(validDailyDate('2026-10-14', Date.parse('2026-10-13T22:00:00Z')), true);
});

test('the versioned generator keeps released dates unchanged', () => {
  assert.equal(DAILY_VERSION, 'quantum-golf-daily-v1-plus');
  for (const [date, target, moves] of [
    ['2026-10-13', [-0.816892209744, -0.539265137484, -0.204646595754], 11],
    ['2026-10-14', [-0.978122156250, 0.171083276987, 0.118353537284], 11],
    ['2026-10-15', [-0.599673066384, 0.592466817559, -0.537936133333], 10],
  ]) {
    const puzzle = dailyPuzzle(date);
    assert.equal(puzzle.optimalMoves, moves);
    assert.deepEqual(puzzle.target.map(value => Number(value.toFixed(12))), target);
  }
});

test('1,000 daily puzzles have independently proven eight-to-twelve move optima', () => {
  const states = reachableStates(12);
  const counts = new Set(), targets = new Set();
  const first = dailyPuzzle(DAILY_START);
  for (let index = 0; index < 1_000; index++) {
    const date = dateAfter(DAILY_START, index);
    const puzzle = dailyPuzzle(date);
    assert.equal(puzzle.date, date);
    assert.equal(puzzle.epsilon, 0.09);
    assert.ok(puzzle.optimalMoves >= 8 && puzzle.optimalMoves <= 12);
    assert.ok(Math.abs(Math.hypot(...puzzle.target) - 1) < 1e-12);
    assert.equal('sequence' in puzzle, false);
    assert.equal('witness' in puzzle, false);
    assert.equal(Object.isFrozen(puzzle), true);
    assert.equal(Object.isFrozen(puzzle.target), true);
    let minimum = -1;
    for (let depth = 0; depth <= 12; depth++) {
      const inside = states[depth].some(state => Math.hypot(
        state[0] - puzzle.target[0], state[1] - puzzle.target[1], state[2] - puzzle.target[2],
      ) / 2 <= puzzle.epsilon);
      if (inside) { minimum = depth; break; }
    }
    assert.equal(puzzle.optimalMoves, minimum, `Independent optimum for ${date}`);
    counts.add(minimum);
    targets.add(JSON.stringify(puzzle.target));
    assert.strictEqual(dailyPuzzle(date), puzzle, 'Repeated requests reuse bounded cached metadata');
  }
  assert.deepEqual([...counts].sort((a, b) => a - b), [8, 9, 10, 11, 12]);
  assert.equal(targets.size, 1_000, 'The sample does not repeat a target');
  assert.deepEqual(dailyPuzzle(DAILY_START), first, 'Evicting a date must not change its puzzle');
});
