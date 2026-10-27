import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyMove, availableMoves, LEVELS as LESSONS, ruleFamily } from '../../src/lib/zx-calculus/engine.js';
import solutions from '../../tools/zx-calculus/solutions.json' with { type: 'json' };
import { CAMPAIGN, DAILY_START, DAILY_VERSION, dailyPuzzle } from '../../src/lib/zx-calculus/leaderboard.js';
import { dailyBounds } from '../../src/lib/games/daily-calendar.js';
import { loadApiFixture } from '../../tools/games/api-fixture.mjs';

const endpoint = 'https://www.colin-blake.eu/api/leaderboard?game=zx-calculus';
const LEVELS = LESSONS.map((level, index) => ({ ...level, solution: solutions[index] }));
const route = await loadApiFixture('api/leaderboard.ts', {
  neonReplacement: 'const neon = () => globalThis.__zxTestPostgres;',
});
const dailyRoute = await loadApiFixture('api/daily.ts');
const post = payload => route.fetch(new Request(endpoint, {
  method: 'POST', headers: { Origin: new URL(endpoint).origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
}));

function expandedSolution(puzzle, rule) {
  const move = availableMoves(puzzle.diagram, { expand: true }).find(move => move.rule === rule);
  assert.ok(move, `A match exists for ${rule}`);
  const after = applyMove(puzzle.diagram, move);
  const added = after.nodes.filter(node => !puzzle.diagram.nodes.some(old => old.id === node.id)).map(node => node.id);
  const nodes = rule === 'split' ? [...move.nodes, ...added] : rule === 'add-hopf' ? move.nodes : added;
  return [move, { rule: ruleFamily(rule), nodes }, ...puzzle.solution];
}

test('ZX uses the shared ranked API, isolates campaigns and closes daily scores at midnight', async () => {
  const database = new PGlite(), originalUrl = process.env.DATABASE_URL, originalNow = Date.now;
  process.env.DATABASE_URL = 'postgresql://test.invalid/games';
  globalThis.__zxTestPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows;
  };
  const { opensAt, closesAt } = dailyBounds(DAILY_START);
  const databaseNow = instant => database.query("SELECT set_config('zx.test_now', $1, false)", [new Date(instant).toISOString()]);
  try {
    await database.exec(await readFile(new URL('../../tools/quantum-golf/schema.sql', import.meta.url), 'utf8'));
    await database.exec(`
      CREATE SCHEMA test_clock;
      CREATE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('zx.test_now')::timestamptz $$;
      SET search_path TO test_clock, pg_catalog, public;
    `);
    Date.now = () => opensAt;
    await databaseNow(opensAt);
    const payload = { game: 'zx-calculus', level: 1, name: 'Ada', sequence: LEVELS[0].solution };
    assert.equal((await post({ ...payload, sequence: [] })).status, 400);
    const firstResponse = await post({ ...payload, moves: -1 });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.currentPlayer.moves, payload.sequence.length);
    assert.equal(first.currentPlayer.rank, 1);
    assert.equal(first.total, 1);
    assert.deepEqual(await (await post(payload)).json(), first, 'Retries preserve the existing record.');
    assert.deepEqual(await (await route.fetch(new Request(`${endpoint}&level=1&player=${first.currentPlayer.id}`))).json(), first);
    const row = (await database.query('SELECT campaign, moves FROM scores WHERE id = $1', [first.currentPlayer.id])).rows[0];
    assert.equal(row.campaign, CAMPAIGN);
    assert.equal(row.moves, payload.sequence.length);
    assert.equal((await (await route.fetch(new Request('https://www.colin-blake.eu/api/leaderboard?game=graph-states&level=1'))).json()).total, 0);

    const secondResponse = await post({ ...payload, name: 'Grace' });
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.deepEqual(second.entries.map(({ name, rank }) => ({ name, rank })), [{ name: 'Ada', rank: 1 }, { name: 'Grace', rank: 2 }]);
    for (const [index, level] of LEVELS.entries()) {
      assert.equal((await post({ ...payload, level: index + 1, sequence: level.solution })).status, 201);
    }

    for (const rule of ['insert', 'insert-hh', 'split', 'add-hopf']) {
      const index = LEVELS.findIndex(level => level.rules.includes(ruleFamily(rule)) &&
        availableMoves(level.diagram, { expand: true }).some(move => move.rule === rule));
      assert.notEqual(index, -1);
      const sequence = expandedSolution(LEVELS[index], rule);
      const response = await post({ ...payload, name: `Inverse ${rule}`, level: index + 1, sequence });
      assert.equal(response.status, 201, rule);
      assert.equal((await response.json()).currentPlayer.moves, sequence.length);
    }
    assert.equal((await post({ ...payload, name: 'Locked inverse', sequence: expandedSolution(LEVELS[0], 'insert-hh') })).status, 400);

    const dailyPayload = { game: 'zx-calculus', date: DAILY_START, name: 'Daily Ada', sequence: expandedSolution(dailyPuzzle(DAILY_START), 'add-hopf') };
    await databaseNow(opensAt - 1);
    assert.equal((await post(dailyPayload)).status, 409, 'Database time also guards the start of the daily round.');
    await databaseNow(opensAt);
    const dailyResponse = await post(dailyPayload);
    assert.equal(dailyResponse.status, 201);
    const daily = await dailyResponse.json();
    const savedDaily = (await database.query('SELECT campaign, level FROM scores WHERE id = $1', [daily.currentPlayer.id])).rows[0];
    assert.equal(savedDaily.campaign, DAILY_VERSION);
    assert.equal(savedDaily.level, Number(DAILY_START.replaceAll('-', '')));
    await databaseNow(closesAt);
    assert.equal((await post(dailyPayload)).status, 409, 'A queued retry cannot cross Paris midnight.');
    Date.now = () => closesAt;
    assert.equal((await post(dailyPayload)).status, 409);
    assert.deepEqual(await (await route.fetch(new Request(`${endpoint}&date=${DAILY_START}&player=${daily.currentPlayer.id}`))).json(), daily);
  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__zxTestPostgres;
    await database.close();
  }
});

test('daily API exposes a fixed ZX diagram without a fabricated optimal score', async () => {
  const originalNow = Date.now, { opensAt, closesAt } = dailyBounds(DAILY_START);
  Date.now = () => opensAt;
  const address = 'https://www.colin-blake.eu/api/daily?game=zx-calculus';
  try {
    const response = await dailyRoute.fetch(new Request(address));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const info = await response.json();
    assert.equal(info.acceptingScores, true);
    assert.equal(info.startDate, DAILY_START);
    assert.deepEqual(Object.keys(info.puzzle).sort(), ['edges', 'nodes']);
    assert.deepEqual(info.puzzle, dailyPuzzle(DAILY_START).diagram);
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-21`))).status, 400);
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-23`))).status, 400);
    Date.now = () => closesAt;
    const archive = await (await dailyRoute.fetch(new Request(`${address}&date=${DAILY_START}`))).json();
    assert.equal(archive.acceptingScores, false);
    assert.deepEqual(archive.puzzle, info.puzzle);
  } finally { Date.now = originalNow; }
});
