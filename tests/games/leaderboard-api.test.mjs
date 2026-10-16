import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';
import { compileApiFixture, loadApiFixture } from '../../tools/games/api-fixture.mjs';
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { DAILY_VERSION, dailyBounds, dailyPuzzle } = await import(websiteFile('src/lib/quantum-golf/daily.js'));
const { MAX_SUBMISSION_BYTES } = await import(websiteFile('src/lib/games/submission.js'));
const { CAMPAIGN: CIRCUIT_CAMPAIGN, MAX_SUBMISSION_BYTES: MAX_CIRCUIT_BYTES } =
  await import(websiteFile('src/lib/circuit-reduction/leaderboard.js'));
const { DAILY_VERSION: CIRCUIT_DAILY_VERSION } = await import(websiteFile('src/lib/circuit-reduction/puzzles.js'));
const { LEVELS: CIRCUIT_LEVELS, dailyPuzzle: circuitPuzzle } = await import(websiteFile('tools/circuit-reduction/witnesses.js'));
const { sequenceCost: circuitSequenceCost } = await import(websiteFile('src/lib/circuit-reduction/engine.js'));
const { DAILY_START: SIGNAL_START, LEVELS: SIGNAL_LEVELS, dailyPuzzle: signalDailyPuzzle } =
  await import(websiteFile('src/lib/quantum-signals/puzzles.js'));
const { CAMPAIGN: SIGNAL_CAMPAIGN, DAILY_CAMPAIGN: SIGNAL_DAILY_CAMPAIGN, MAX_SUBMISSION_BYTES: MAX_SIGNAL_BYTES } =
  await import(websiteFile('src/lib/quantum-signals/completions.js'));
const { solvePuzzle: solveSignals } = await import(websiteFile('src/lib/quantum-signals/engine.js'));
const signalSequence = puzzle => Object.entries(solveSignals(puzzle, { limit: 1 })[0])
  .filter(([, gate]) => gate !== 'I').map(([hole, gate]) => ({ hole, gate }));
const { LEVELS: GRAPH_LEVELS, DAILY_START: GRAPH_START, dailyPuzzle: graphDailyPuzzle } =
  await import(websiteFile('src/lib/graph-states/puzzles.js'));
const { optimalShots: graphOptimalShots, sequenceCost: graphSequenceCost, solutionForGraph: graphSequence } = await import(websiteFile('src/lib/graph-states/engine.js'));
const { CAMPAIGN: GRAPH_CAMPAIGN, DAILY_CAMPAIGN: GRAPH_DAILY_CAMPAIGN, MAX_SUBMISSION_BYTES: MAX_GRAPH_BYTES } =
  await import(websiteFile('src/lib/graph-states/leaderboard.js'));

// Replace only the database transport. The Vercel handler, score validation and
// parameterized ranking SQL still run unchanged against real PostgreSQL.
const neonReplacement = 'const neon = (url, options) => { globalThis.__quantumGolfDatabaseOptions = options; return globalThis.__quantumGolfPostgres; };';
const route = await loadApiFixture('api/leaderboard.ts', { neonReplacement });
const dailyRoute = await loadApiFixture('api/daily.ts');

const endpoint = 'https://www.colin-blake.eu/api/leaderboard';
const origin = new URL(endpoint).origin;
const valid = (changes = {}) => ({ level: 1, name: 'Ada', sequence: 'T', ...changes });
const get = (level = 1, player, site = origin, address = endpoint) => route.fetch(new Request(
  `${address}?level=${level}${player === undefined ? '' : `&player=${player}`}`,
  { headers: site === null ? {} : { Origin: site } },
));
const post = (payload, site = origin, address = endpoint) => route.fetch(new Request(address, {
  method: 'POST', headers: { ...(site === null ? {} : { Origin: site }), 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}));
const ranks = board => board.entries.map(entry => entry.rank);

test('compiled Vercel ESM resolves every game and their shared validator JavaScript', async () => {
  const tempBase = tmpdir();
  const directory = await mkdtemp(resolve(tempBase, 'vercel-esm-'));
  const compiledRoot = pathToFileURL(`${directory}/`);
  try {
    await writeFile(new URL('package.json', compiledRoot), '{"type":"module"}\n');
    await mkdir(new URL('api/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/quantum-golf/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/circuit-reduction/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/quantum-signals/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/graph-states/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/games/', compiledRoot), { recursive: true });
    await writeFile(new URL('api/leaderboard.js', compiledRoot), await compileApiFixture('api/leaderboard.ts', { neonReplacement, absoluteImports: false }));
    await writeFile(new URL('api/daily.js', compiledRoot), await compileApiFixture('api/daily.ts', { absoluteImports: false }));
    for (const name of ['leaderboard.js', 'quantum.js', 'campaign.json', 'daily.js', 'solver.js']) {
      await writeFile(new URL(`src/lib/quantum-golf/${name}`, compiledRoot),
        await readFile(websiteFile(`src/lib/quantum-golf/${name}`)));
    }
    for (const path of ['games/server.js', 'games/daily-calendar.js', 'games/submission.js', 'games/random.js',
      'quantum-signals/engine.js', 'quantum-signals/puzzles.js', 'quantum-signals/completions.js',
      'graph-states/engine.js', 'graph-states/puzzles.js', 'graph-states/leaderboard.js',
      'circuit-reduction/leaderboard.js',
      'circuit-reduction/engine.js', 'circuit-reduction/puzzles.js',
      'circuit-reduction/generator.js', 'circuit-reduction/generated-catalogue.js',
      'circuit-reduction/paper-missions.js', 'circuit-reduction/paper-certificates.js',
      'circuit-reduction/stored-puzzles.js']) {
      await writeFile(new URL(`src/lib/${path}`, compiledRoot), await readFile(websiteFile(`src/lib/${path}`)));
    }
    // Keep the API's relative imports intact to verify the deployed package.
    const { default: compiled } = await import(new URL('api/leaderboard.js', compiledRoot));
    const response = await compiled.fetch(new Request(`${endpoint}?level=unknown`));
    assert.equal(response.status, 400, 'The deployed handler can load its validator before servicing requests');
    assert.deepEqual(await response.json(), { error: `Choose a campaign level from 1 to ${LEVELS.length}.` });
    const { default: compiledDaily } = await import(new URL('api/daily.js', compiledRoot));
    assert.equal((await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?date=invalid`))).status, 400);
    assert.equal((await compiled.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid({ sequence: 'H' })),
    }))).status, 400, 'Golf continues to validate submitted circuits');
    const selectedCircuit = await compiled.fetch(new Request(`${endpoint}?game=circuit-reduction&level=unknown`));
    assert.equal(selectedCircuit.status, 400);
    assert.deepEqual(await selectedCircuit.json(), { error: `Choose a campaign level from 1 to ${CIRCUIT_LEVELS.length}.` });
    const selectedGolf = await compiled.fetch(new Request(`${endpoint}?game=quantum-golf&level=unknown`));
    assert.deepEqual(await selectedGolf.json(), { error: `Choose a campaign level from 1 to ${LEVELS.length}.` });
    const selectedSignals = await compiled.fetch(new Request(`${endpoint}?game=quantum-signals&level=unknown`));
    assert.equal(selectedSignals.status, 400);
    assert.deepEqual(await selectedSignals.json(), { error: `Choose a campaign level from 1 to ${SIGNAL_LEVELS.length}.` });
    const selectedGraph = await compiled.fetch(new Request(`${endpoint}?game=graph-states&level=unknown`));
    assert.equal(selectedGraph.status, 400);
    assert.deepEqual(await selectedGraph.json(), { error: 'Choose a campaign level from 1 to 10.' });
    const signalSubmission = await compiled.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid({ game: 'quantum-signals', sequence: [{ hole: 'a', gate: 'H' }] })),
    }));
    assert.equal(signalSubmission.status, 400);
    assert.deepEqual(await signalSubmission.json(), { error: 'That replay contains an invalid gate placement.' });
    const unsupportedGame = await compiled.fetch(new Request(`${endpoint}?game=unknown&level=1`));
    assert.equal(unsupportedGame.status, 400);
    assert.deepEqual(await unsupportedGame.json(), { error: 'Choose a supported game.' });
    const bodyGame = await compiled.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(valid({ game: 'unknown' })),
    }));
    assert.equal(bodyGame.status, 400);
    assert.deepEqual(await bodyGame.json(), { error: 'Choose a supported game.' });
    const selectedDaily = await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?game=quantum-golf&date=invalid`));
    assert.equal(selectedDaily.status, 400);
    assert.deepEqual(await selectedDaily.json(), { error: 'Choose an available daily puzzle.' });
    const signalDaily = await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?game=quantum-signals&date=invalid`));
    assert.equal(signalDaily.status, 400);
    assert.deepEqual(await signalDaily.json(), { error: 'Choose an available daily puzzle.' },
      'Signal daily puzzles and completion validation resolve in the deployed package');
    const graphDaily = await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?game=graph-states&date=invalid`));
    assert.equal(graphDaily.status, 400);
    assert.deepEqual(await graphDaily.json(), { error: 'Choose an available daily puzzle.' });
    const unsupportedDaily = await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?game=unknown`));
    assert.equal(unsupportedDaily.status, 400);
    assert.deepEqual(await unsupportedDaily.json(), { error: 'Choose a supported game.' });
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tempBase));
    assert.ok(basename(directory).startsWith('vercel-esm-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Vercel route ranks preserved attempts in PostgreSQL and rejects invalid writes', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test.invalid/quantum_golf';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    const { rows } = await database.query(query, values);
    // Neon sends int8 results as strings; the API must still expose numeric IDs
    // and ranks for strict comparisons in the game controller.
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key, value !== null && ['id', 'rank', 'total'].includes(key) ? String(value) : value,
    ])));
  };
  try {
    await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
    const count = async () => Number((await database.query('SELECT COUNT(*) AS n FROM scores')).rows[0].n);

    assert.equal((await get('unknown')).status, 400);
    assert.equal((await get(LEVELS.length + 1)).status, 400);
    for (const method of ['PUT', 'DELETE', 'OPTIONS']) {
      const unsupported = await route.fetch(new Request(endpoint, { method }));
      assert.equal(unsupported.status, 405);
      assert.equal(unsupported.headers.get('Allow'), 'GET, POST');
    }
    for (const id of ['NaN', '1.5', '-1', '0', '9007199254740992']) {
      assert.equal((await get(1, id)).status, 400);
    }
    assert.equal((await get(1, undefined, 'https://unrelated.example')).status, 403);
    assert.equal((await post(valid(), 'https://unrelated.example')).status, 403);
    assert.equal((await post(valid({ sequence: 'H', moves: 1, epsilon: 1 }))).status, 400);
    assert.equal((await post(valid({ level: 11, sequence: null, moves: 1358 }))).status, 400,
      'The public API still requires a winning circuit, including when a move count is supplied');
    assert.equal((await post(valid({ name: 'Ada\u202e' }))).status, 400);
    for (const payload of [null, [], true, 3, {},
      valid({ sequence: true }), valid({ sequence: 1 }), valid({ sequence: ['T'] }),
      valid({ sequence: { 0: 'T', length: 1 } }), valid({ sequence: 'Ｔ' }),
      { level: 11, name: 'Colin', moves: 1, target: [1, 0, 0], epsilon: 1 },
      valid({ level: 11, moves: 1, target: [1, 0, 0], epsilon: 1, optimalMoves: 0 }),
    ]) {
      assert.equal((await post(payload)).status, 400, 'Malformed or forged score data cannot write a row');
    }
    for (const body of [
      '{"level":1,"name":"Ada","sequence":"T","sequence":null}',
      '{"level":1,"name":"Ada","sequence":"T","level":11}',
      '{"__proto__":{"level":1,"name":"Ada","sequence":"T"}}',
    ]) {
      assert.equal((await route.fetch(new Request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }))).status, 400);
    }
    const formLike = await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: JSON.stringify(valid()),
    }));
    assert.equal(formLike.status, 415, 'Simple cross-site form content cannot submit even a valid winning score');
    assert.equal((await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify(valid()),
    }))).status, 403, 'Cross-site browser requests are rejected even without an Origin header');
    const badUnicode = Uint8Array.from([
      ...new TextEncoder().encode('{"level":1,"name":"Ada'), 0xc0, 0xaf,
      ...new TextEncoder().encode('","sequence":"T"}'),
    ]);
    assert.equal((await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: badUnicode,
    }))).status, 400, 'Malformed UTF-8 cannot silently change a submitted identity');
    for (const alreadyCancelled of [true, false]) {
      const controller = new AbortController();
      let cancelled = false;
      const request = new Request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half',
      });
      if (alreadyCancelled) controller.abort();
      const pending = route.fetch(request);
      if (!alreadyCancelled) controller.abort();
      assert.equal((await pending).status, 408, 'Cancelled score bodies cannot leave a pending write');
      assert.equal(cancelled, true);
      assert.equal(request.body.locked, false);
    }
    for (const [body, status] of [['{bad', 400], ['🦊'.repeat(600), 400], ['T'.repeat(MAX_SUBMISSION_BYTES + 1), 413]]) {
      const rejected = await route.fetch(new Request(endpoint, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body,
      }));
      assert.equal(rejected.status, status);
    }
    assert.equal(await count(), 0, 'Rejected requests never insert a score');
    assert.deepEqual(await (await get()).json(), { total: 0, entries: [], currentPlayer: null });
    assert.equal((await get(1, undefined, null)).status, 200, 'Read-only clients need no Origin header');
    const local = 'http://localhost:4321';
    assert.equal((await get(1, undefined, local, `${local}/api/leaderboard`)).status, 200,
      'Same-origin requests also work on local Astro and Vercel preview hosts');

    let response = await post(valid({ name: ' <b>Ada</b> ', sequence: 'HTHT', moves: 0 }));
    assert.equal(response.status, 201);
    let board = await response.json();
    const firstId = board.currentPlayer.id;
    assert.equal(typeof firstId, 'number', 'PostgreSQL bigint IDs retain the public numeric contract');
    assert.equal(board.total, 1);
    assert.deepEqual(board.currentPlayer, { id: firstId, name: '<b>Ada</b>', moves: 4, rank: 1 });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    board = await (await post(valid({ name: '<b>Ada</b>', sequence: 'HTHT' }))).json();
    assert.equal(await count(), 1, 'A network retry cannot duplicate the same circuit');
    assert.equal(board.currentPlayer.id, firstId);
    board = await (await post(valid({ name: '<b>Ada</b>' }))).json();
    const improvedId = board.currentPlayer.id;
    assert.notEqual(improvedId, firstId);
    assert.equal(board.currentPlayer.moves, 1);
    assert.equal(board.total, 1, 'Only the best attempt per normalized nickname counts');
    assert.equal(await count(), 2, 'Improvement preserves the old score for migration and history');
    board = await (await get(1, firstId)).json();
    assert.equal(board.currentPlayer.id, improvedId, 'Existing stored player IDs resolve the nickname’s new best');
    assert.equal((await get(1, firstId)).headers.get('Cache-Control'), 'no-store');
    board = await (await post(valid({ name: '<b>Ada</b>', sequence: 'T' + 'H'.repeat(4) }))).json();
    assert.equal(board.currentPlayer.id, improvedId);
    assert.equal(await count(), 3, 'A worse attempt does not replace or delete the best');

    await post(valid({ level: 2, name: 'Other level', sequence: 'HT' }));
    assert.equal((await (await get()).json()).total, 1);
    assert.equal((await (await get(2, firstId)).json()).currentPlayer, null, 'Personal IDs stay scoped to their hole');
    const finalHole = LEVELS.at(-1);
    const solution = solveShortest(finalHole.target, finalHole.epsilon, { maxDepth: finalHole.optimalMoves, maxNodes: 2_000_000 });
    assert.equal(solution.status, 'optimal');
    response = await post(valid({ level: finalHole.id, name: 'Final visitor', sequence: solution.sequence }));
    assert.equal(response.status, 201, 'The final campaign hole accepts a verified winning circuit');
    const finalBoard = await response.json();
    assert.equal(finalBoard.currentPlayer.moves, finalHole.optimalMoves);
    assert.equal(finalBoard.total, 1);
    assert.deepEqual(await (await get(finalHole.id, finalBoard.currentPlayer.id)).json(), finalBoard);
    assert.equal((await (await get()).json()).total, 1, 'The extra hole does not alter existing rankings');
    const hole11 = LEVELS.find(level => level.id === 11);
    const hole11Solution = solveShortest(hole11.target, hole11.epsilon, { maxDepth: hole11.optimalMoves, maxNodes: 2_000_000 });
    const padded = hole11Solution.sequence + 'H'.repeat(1358 - hole11Solution.sequence.length);
    response = await post(valid({ level: 11, name: 'Colin', sequence: padded }));
    assert.equal(response.status, 201, 'A verified 1358-gate level 11 solution is accepted');
    const colinBoard = await response.json();
    assert.equal(colinBoard.currentPlayer.moves, 1358);
    const alternative = 'HH' + padded.slice(0, -2);
    assert.notEqual(alternative, padded);
    assert.deepEqual(await (await post(valid({ level: 11, name: 'Colin', sequence: alternative }))).json(), colinBoard,
      'Different winning circuits with the same move count share one score');

    let seed = 42;
    const prefix = Array.from({ length: 10_000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed & 0x80000000 ? 'H' : 'T';
    }).join('');
    const inverse = [...prefix].reverse().map(gate => gate === 'H' ? 'H' : 'TTTTTTT').join('');
    const long = valid({ level: 11, name: 'Long circuit', sequence: prefix + inverse + hole11Solution.sequence });
    response = await post(long);
    assert.equal(response.status, 201, 'Long mixed circuits are validated without being indexed or stored');
    const longBoard = await response.json();
    assert.equal(longBoard.currentPlayer.moves, long.sequence.length);
    const countBeforeRetry = await count();
    assert.deepEqual(await (await post(long)).json(), longBoard, 'Long-circuit retries preserve the player ID and rank');
    assert.equal(await count(), countBeforeRetry);
    assert.deepEqual(await (await get(11, longBoard.currentPlayer.id)).json(), longBoard);
    for (const entry of longBoard.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['id', 'moves', 'name', 'rank'], 'Leaderboards never expose stored circuits');
    }
    const savedLong = (await database.query('SELECT * FROM scores WHERE id = $1', [longBoard.currentPlayer.id])).rows[0];
    assert.deepEqual(Object.keys(savedLong).sort(), ['campaign', 'created_at', 'id', 'level', 'moves', 'name'],
      'Stored scores contain neither a circuit nor a circuit fingerprint');
    for (const name of ['Ada', 'ada', 'Zoë', 'Zoe\u0308']) {
      assert.equal((await post(valid({ level: 2, name, sequence: 'HT' }))).status, 201);
    }
    assert.equal((await (await get(2)).json()).total, 5, 'Exact case-sensitive Unicode nicknames keep their original identities');
    await database.query('INSERT INTO scores (campaign, level, name, moves, created_at) VALUES ($1, 1, $2, 1, 0)',
      ['retired-campaign', 'Old campaign']);
    assert.equal((await (await get()).json()).total, 1, 'Previous campaigns cannot contaminate current ranks');

    // A tied timestamp deliberately exercises the ID ordering used for old D1
    // rows and simultaneous new submissions.
    const originalNow = Date.now;
    Date.now = () => 1;
    const ids = [];
    try {
      for (let index = 0; index < 8; index++) {
        board = await (await post(valid({ name: `Player ${index}` }))).json();
        ids.push(board.currentPlayer.id);
      }
      board = await (await get()).json();
      assert.equal(board.total, 9);
      assert.deepEqual(ranks(board), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'Fewer than ten players show everyone');
      board = await (await post(valid({ name: 'Player 8' }))).json();
      ids.push(board.currentPlayer.id);
      assert.deepEqual(ranks(await (await get()).json()), [1, 2, 3, 4, 5], 'Ten players switch to the top-five view');
      for (let index = 9; index < 30; index++) {
        board = await (await post(valid({ name: `Player ${index}` }))).json();
        ids.push(board.currentPlayer.id);
      }
    } finally { Date.now = originalNow; }

    response = await get();
    board = await response.json();
    assert.equal(board.total, 31);
    assert.deepEqual(ranks(board), [1, 2, 3, 4, 5]);
    assert.equal(board.currentPlayer, null);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=15');
    board = await (await get(1, ids[18])).json();
    assert.equal(board.currentPlayer.rank, 19);
    assert.equal(board.currentPlayer.name, 'Player 18');
    assert.deepEqual(ranks(board), [1, 2, 3, 4, 5, 17, 18, 19, 20, 21]);
    board = await (await post(valid({ name: 'Player 18' }))).json();
    assert.equal(board.currentPlayer.id, ids[18]);
    assert.equal(board.currentPlayer.rank, 19);
    board = await (await get(1, ids[3])).json();
    assert.deepEqual(ranks(board), [1, 2, 3, 4, 5, 6], 'Overlapping top and personal windows contain no duplicates');
    board = await (await get(1, improvedId)).json();
    assert.equal(board.currentPlayer.rank, 31);
    assert.deepEqual(ranks(board), [1, 2, 3, 4, 5, 29, 30, 31]);
    assert.equal((await (await get(1, 999999)).json()).currentPlayer, null);

    const thirdHole = LEVELS.find(level => level.id === 3);
    const thirdSolution = solveShortest(thirdHole.target, thirdHole.epsilon, { maxDepth: thirdHole.optimalMoves });
    const sqlNickname = "Ada'); DROP TABLE x;--";
    const literal = await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'Application/JSON; charset=UTF-8' },
      body: JSON.stringify(valid({ level: 3, name: sqlNickname, sequence: thirdSolution.sequence,
        moves: 0, campaign: 'other', created_at: 0, id: 1 })),
    }));
    assert.equal(literal.status, 201, 'JSON media type parameters are supported');
    const literalBoard = await literal.json();
    assert.equal(literalBoard.currentPlayer.name, sqlNickname, 'A SQL-looking nickname is stored as literal text');
    assert.equal(literalBoard.currentPlayer.moves, thirdHole.optimalMoves);
    const savedLiteral = (await database.query('SELECT * FROM scores WHERE id = $1', [literalBoard.currentPlayer.id])).rows[0];
    assert.equal(savedLiteral.campaign, 'quantum-golf-v2-plus');
    assert.notEqual(Number(savedLiteral.created_at), 0, 'Clients cannot choose their tie-breaking timestamp');
    assert.equal((await (await get(3)).json()).total, 1);

    const beforeFailure = await count();
    delete process.env.DATABASE_URL;
    for (const unavailable of [await get(), await post(valid({ name: 'No database' }))]) {
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await unavailable.json(), { error: 'Scores are temporarily unavailable. Try again.' });
    }
    assert.equal(await count(), beforeFailure, 'Missing configuration cannot write or damage stored scores');
    process.env.DATABASE_URL = 'postgresql://test.invalid/quantum_golf';
    globalThis.__quantumGolfPostgres = () => { throw new Error('Database credentials must never be exposed'); };
    response = await get();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Scores are temporarily unavailable. Try again.' });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});

test('score migration preserves IDs and timestamps, retries safely and rolls back conflicting imports', async () => {
  const { migrate } = await import(websiteFile('tools/quantum-golf/migrate.mjs'));
  const database = new PGlite();
  let queryCount = 0;
  const sql = {
    query(query, values = []) { queryCount++; return { query, values }; },
    transaction(queries) {
      return database.transaction(async transaction => {
        const results = [];
        for (const { query, values } of queries) results.push((await transaction.query(query, values)).rows);
        return results;
      });
    },
  };
  const row = (changes = {}) => ({
    id: '42', campaign: 'quantum-golf-v1', level: '1', name: 'Colin',
    sequence: 'H', moves: '1', created_at: '1791810123456', ...changes,
  });
  const backup = [
    row(),
    row({ id: 73, sequence: 'TH', moves: 2, created_at: 1791811123456 }),
    row({ id: '101', level: 2, name: '🦊', sequence: 'HT', moves: 2 }),
    row({ id: 8, campaign: 'retired-campaign', name: 'Historical', created_at: 1 }),
    row({ id: 201, level: 11, name: 'Colin', sequence: undefined, moves: 1358 }),
  ];
  const snapshot = async () => (await database.query('SELECT * FROM scores ORDER BY id')).rows;
  try {
    assert.equal(await migrate(sql), 0, 'Schema setup needs no existing backup');
    assert.equal(await migrate(sql, backup), 5);
    const imported = await snapshot();
    assert.deepEqual(imported.map(value => ({ ...value, id: Number(value.id), created_at: Number(value.created_at) })),
      backup.map(({ sequence, ...value }) => ({
        ...value, id: Number(value.id), level: Number(value.level), moves: Number(value.moves), created_at: Number(value.created_at),
      })).sort((a, b) => a.id - b.id), 'All historical attempts, names, IDs and tie timestamps survive intact');
    await migrate(sql, backup);
    assert.deepEqual(await snapshot(), imported, 'Repeating the same import leaves records unchanged');
    const inserted = await database.query(`
      INSERT INTO scores (campaign, level, name, moves, created_at)
      VALUES ('quantum-golf-v1', 1, 'New visitor', 1, 1791812123456) RETURNING id
    `);
    assert.equal(Number(inserted.rows[0].id), 202, 'New visitors continue after the highest preserved player ID');
    await migrate(sql, backup);
    const intact = await snapshot();
    assert.equal(intact.length, 6, 'Retrying the backup preserves scores submitted after migration');

    const fresh = row({ id: 500, name: 'Imported next' });
    await assert.rejects(() => migrate(sql, [fresh, row({ name: 'Conflicting identity' })]));
    assert.deepEqual(await snapshot(), intact, 'A mismatched existing ID rolls back every new record in that batch');
    await assert.rejects(() => migrate(sql, [fresh, row({ id: 501 })]));
    assert.deepEqual(await snapshot(), intact, 'A score duplicated under a different ID also rolls back the batch');

    for (const bad of [
      [row(), row()], [row({ id: '9007199254740992' })], [row({ moves: 2 })],
      [row({ level: 2147483648 })], [row({ sequence: undefined, moves: 2147483648 })],
      [row({ name: '🦊'.repeat(25) })], [row({ name: 'Ada\u202e' })], [row({ sequence: 'HX', moves: 2 })],
      [row({ moves: 0 })], null,
    ]) {
      const before = queryCount;
      await assert.rejects(() => migrate(sql, bad));
      assert.equal(queryCount, before, 'Malformed backups are rejected before issuing database statements');
    }
    assert.deepEqual(await snapshot(), intact);
  } finally { await database.close(); }
});

test('database waits stop on request cancellation or timeout and errors never expose sensitive data', async () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalTimeout = AbortSignal.timeout;
  const originalError = console.error;
  const logs = [];
  process.env.DATABASE_URL = 'postgresql://test.invalid/quantum_golf';
  console.error = (...items) => logs.push(items);
  globalThis.__quantumGolfPostgres = () => new Promise((_resolve, reject) => {
    const { signal } = globalThis.__quantumGolfDatabaseOptions.fetchOptions;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  try {
    const controller = new AbortController();
    const pending = route.fetch(new Request(`${endpoint}?level=1`, { signal: controller.signal }));
    controller.abort(new Error('Sensitive connection string or nickname'));
    assert.equal((await pending).status, 503, 'Disconnected requests also cancel the database fetch');
    AbortSignal.timeout = milliseconds => {
      assert.equal(milliseconds, 10_000);
      return AbortSignal.abort(new DOMException('Sensitive timeout details', 'TimeoutError'));
    };
    const response = await get();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Scores are temporarily unavailable. Try again.' });
    assert.equal(JSON.stringify(logs).includes('Sensitive'), false, 'Logs omit database error text and request data');
    assert.deepEqual(logs.at(-1), ['Game leaderboard failed.', {
      configured: true, error: 'TimeoutError', code: undefined,
    }]);
    // Error names are mutable too; upstream error objects are not safe log data.
    globalThis.__quantumGolfPostgres = () => {
      const error = new Error('Sensitive database message');
      error.name = 'Sensitive postgresql://user:password@database';
      error.code = 'Sensitive SQL detail';
      throw error;
    };
    assert.equal((await get()).status, 503);
    assert.equal(JSON.stringify(logs).includes('Sensitive'), false);
    assert.deepEqual(logs.at(-1), ['Game leaderboard failed.', {
      configured: true, error: 'Error', code: undefined,
    }]);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    AbortSignal.timeout = originalTimeout;
    console.error = originalError;
    delete globalThis.__quantumGolfPostgres;
    delete globalThis.__quantumGolfDatabaseOptions;
  }
});

test('JSON export restores scores and completions safely and refuses to overwrite a backup', async () => {
  const { migrate } = await import(websiteFile('tools/quantum-golf/migrate.mjs'));
  const { exportScores } = await import(websiteFile('tools/quantum-golf/export.mjs'));
  const databases = [new PGlite(), new PGlite()];
  const adapter = database => ({
    query: (query, values = []) => ({ query, values }),
    transaction: queries => database.transaction(async transaction => {
      for (const { query, values } of queries) await transaction.query(query, values);
    }),
  });
  const directory = await mkdtemp(resolve(tmpdir(), 'quantum-golf-backup-'));
  const path = resolve(directory, 'scores.json');
  const rows = [
    { id: 9, campaign: 'retired-campaign', level: 1, name: 'Zoë 🦊', moves: 1, created_at: 0 },
    { id: 101, campaign: 'quantum-golf-v2-plus', level: 15, name: 'Ada', moves: 2, created_at: 9007199254740991 },
    { id: 202, campaign: 'quantum-golf-v2-plus', level: 11, name: 'Colin', moves: 1358, created_at: 1791810123456 },
  ];
  const completions = [
    { id: 9, campaign: SIGNAL_CAMPAIGN, level: 1, name: 'Zoë 🦊' },
    { id: 777, campaign: SIGNAL_DAILY_CAMPAIGN, level: 20261017, name: 'Ada' },
  ];
  try {
    assert.equal(await migrate(adapter(databases[0]), rows, completions), 5);
    const source = { query: async query => (await databases[0].query(query)).rows };
    assert.equal(await exportScores(source, path), 5);
    const saved = await readFile(path, 'utf8');
    const backup = JSON.parse(saved);
    assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
    assert.deepEqual(backup.rows, rows);
    assert.deepEqual(backup.completions, completions, 'Checkbox completions are included alongside ranked scores');
    await assert.rejects(() => exportScores(source, path), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), saved);
    await migrate(adapter(databases[1]), backup.rows, backup.completions);
    await migrate(adapter(databases[1]), backup.rows, backup.completions);
    assert.deepEqual((await databases[1].query('SELECT * FROM scores ORDER BY id')).rows, rows);
    assert.deepEqual((await databases[1].query('SELECT * FROM completions ORDER BY id')).rows, completions,
      'Restoring or retrying preserves completion identities and names');
    assert.equal((await databases[1].query(`INSERT INTO scores (campaign, level, name, moves, created_at)
      VALUES ('new-campaign', 1, 'New score', 1, 0) RETURNING id`)).rows[0].id, 203);
    assert.equal((await databases[1].query(`INSERT INTO completions (campaign, level, name)
      VALUES ('new-campaign', 1, 'New completion') RETURNING id`)).rows[0].id, 778,
      'Both identity sequences continue above their restored records');
    const snapshot = async table => (await databases[1].query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    const intactScores = await snapshot('scores'), intactCompletions = await snapshot('completions');
    const freshScore = { ...rows[0], id: 500, name: 'Fresh score' };
    const freshCompletion = { ...completions[0], id: 900, name: 'Fresh completion' };
    for (const conflict of [
      { ...completions[0], name: 'Conflicting identity' },
      { ...completions[0], id: 901 },
    ]) {
      await assert.rejects(() => migrate(adapter(databases[1]), [freshScore], [freshCompletion, conflict]));
      assert.deepEqual(await snapshot('scores'), intactScores);
      assert.deepEqual(await snapshot('completions'), intactCompletions,
        'A conflicting completion rolls back all score and completion inserts');
    }
    for (const invalid of [null, [completions[0], completions[0]],
      [{ ...completions[0], id: '9007199254740992' }], [{ ...completions[0], level: 2147483648 }],
      [{ ...completions[0], name: 'Ada\u202e' }], [{ ...completions[0], name: '🦊'.repeat(25) }],
    ]) {
      let queries = 0;
      const validationOnly = { query() { queries++; }, transaction() { queries++; } };
      await assert.rejects(() => migrate(validationOnly, [], invalid));
      assert.equal(queries, 0, 'Malformed completions fail before any database statements');
    }
  } finally {
    await Promise.all(databases.map(database => database.close()));
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('quantum-golf-backup-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('schema removes legacy circuit storage while preserving scores and upgrading level limits', async () => {
  const { migrate } = await import(websiteFile('tools/quantum-golf/migrate.mjs'));
  const database = new PGlite();
  const sql = {
    query: (query, values = []) => ({ query, values }),
    transaction: queries => database.transaction(async transaction => {
      const results = [];
      for (const { query, values } of queries) results.push((await transaction.query(query, values)).rows);
      return results;
    }),
  };
  const insert = (level, legacy = false) => database.query(`
    INSERT INTO scores (campaign, level, name, moves, created_at${legacy ? ', sequence' : ''})
    VALUES ('quantum-golf-v2-plus', $1, 'Existing visitor', 1, 1791810123456${legacy ? ", 'T'" : ''})
    RETURNING *
  `, [level]);
  try {
    await database.exec(`
      CREATE TABLE scores (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        campaign TEXT NOT NULL CHECK (length(campaign) > 0),
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
        name TEXT COLLATE "C" NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
        sequence TEXT NOT NULL CHECK (length(sequence) BETWEEN 1 AND 512 AND sequence !~ '[^HT]'),
        moves INTEGER NOT NULL,
        created_at BIGINT NOT NULL CHECK (created_at >= 0),
        CONSTRAINT scores_check CHECK (moves = length(sequence))
      );
      CREATE UNIQUE INDEX scores_submission ON scores (campaign, level, name, sequence);
    `);
    const { sequence, ...preserved } = (await insert(1, true)).rows[0];
    await assert.rejects(() => insert(15, true), /scores_level_check/);
    assert.equal(await migrate(sql), 0);
    assert.deepEqual((await database.query('SELECT * FROM scores WHERE id = $1', [preserved.id])).rows, [preserved],
      'The expansion preserves existing scores, IDs and tie timestamps');
    const added = (await insert(15)).rows[0];
    assert.equal(added.level, 15);
    assert.equal(await migrate(sql, [added]), 1, 'The importer accepts and safely retries a score from level fifteen');
    assert.deepEqual((await database.query('SELECT * FROM scores ORDER BY id')).rows, [preserved, added],
      'Repeating the schema upgrade preserves both old and new level scores');
    await assert.rejects(() => insert(0), /scores_level_check/);
    const long = (await database.query(`
      INSERT INTO scores (campaign, level, name, moves, created_at)
      VALUES ('quantum-golf-v2-plus', 11, 'Long visitor', 1358, 1791810123456) RETURNING *
    `)).rows[0];
    const owner = (await database.query(`
      INSERT INTO scores (campaign, level, name, moves, created_at)
      VALUES ('quantum-golf-v2-plus', 11, 'Colin', 1358, 1791810123456) RETURNING *
    `)).rows[0];
    await migrate(sql);
    assert.deepEqual((await database.query('SELECT * FROM scores ORDER BY id')).rows, [preserved, added, long, owner],
      'Repeated upgrades preserve long scores and owner-recorded scores');
    const indexes = (await database.query("SELECT indexname FROM pg_indexes WHERE tablename = 'scores'")).rows.map(row => row.indexname);
    assert.ok(indexes.includes('scores_submission_moves'));
    assert.equal(indexes.includes('scores_submission'), false, 'The raw circuit B-tree index is removed');
    for (const moves of [0, -1]) {
      await assert.rejects(() => database.query(`
        INSERT INTO scores (campaign, level, name, moves, created_at)
        VALUES ('quantum-golf-v2-plus', 11, 'Invalid', $1, 1791810123456)
      `, [moves]), /scores_moves_check/);
    }
  } finally { await database.close(); }
});

test('daily metadata follows Paris midnight without a database or cached future puzzles', async () => {
  const originalNow = Date.now;
  const originalUrl = process.env.DATABASE_URL;
  const address = endpoint.replace('leaderboard', 'daily');
  const daily = query => dailyRoute.fetch(new Request(`${address}${query ?? ''}`));
  delete process.env.DATABASE_URL;
  try {
    const midnight = Date.parse('2026-10-13T22:00:00Z');
    Date.now = () => midnight - 1;
    const response = await daily();
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const first = await response.json();
    assert.equal(first.today, '2026-10-13');
    assert.equal(first.date, first.today);
    assert.equal(first.startDate, '2026-10-13');
    assert.equal(first.timeZone, 'Europe/Paris');
    assert.equal(first.acceptingScores, true);
    assert.equal(first.serverNow, midnight - 1);
    assert.equal(first.closesAt, midnight);
    assert.equal(first.nextChangeAt, midnight);
    assert.deepEqual(Object.keys(first.puzzle).sort(), ['epsilon', 'optimalMoves', 'target']);
    assert.ok(first.puzzle.optimalMoves >= 8 && first.puzzle.optimalMoves <= 12);
    assert.equal((await daily('?date=2026-10-14')).status, 400, 'Tomorrow is not accessible before Paris midnight');

    Date.now = () => midnight;
    const next = await (await daily()).json();
    assert.equal(next.today, '2026-10-14');
    assert.equal(next.acceptingScores, true);
    assert.equal(next.opensAt, midnight);
    assert.equal(next.serverNow, midnight);
    const past = await (await daily('?date=2026-10-13')).json();
    assert.equal(past.acceptingScores, false);
    assert.equal(past.nextChangeAt, next.closesAt, 'The refresh deadline follows today even while viewing the archive');
    assert.deepEqual(past.puzzle, first.puzzle, 'A past puzzle stays exactly the same after rollover');
    for (const date of ['', 'invalid', '2026-02-30', '2026-10-12', '2026-10-15', '2026-10-14T00:00:00Z']) {
      assert.equal((await daily(`?date=${encodeURIComponent(date)}`)).status, 400);
    }
    const unsupported = await dailyRoute.fetch(new Request(address, { method: 'POST' }));
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get('Allow'), 'GET');
  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
});

test('daily PostgreSQL writes enforce the real scoring day at midnight, independently of the request clock', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL;
  const originalNow = Date.now;
  process.env.DATABASE_URL = 'postgresql://test.invalid/quantum_golf';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows;
  };
  const boardFor = (date, player) => route.fetch(new Request(
    `${endpoint}?date=${date}${player === undefined ? '' : `&player=${player}`}`,
  ));
  const count = async () => Number((await database.query('SELECT COUNT(*) AS n FROM scores')).rows[0].n);
  // Override only PostgreSQL's clock, keeping the API and its conditional SQL
  // unchanged. This proves slow requests cannot use the application clock.
  const databaseNow = instant => database.query("SELECT set_config('quantum_golf.test_now', $1, false)", [new Date(instant).toISOString()]);
  try {
    await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
    await database.exec(`
      CREATE SCHEMA test_clock;
      CREATE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('quantum_golf.test_now')::timestamptz $$;
      SET search_path TO test_clock, pg_catalog, public;
    `);
    const date = '2026-10-14';
    const { opensAt, closesAt } = dailyBounds(date);
    const puzzle = dailyPuzzle(date);
    const solution = solveShortest(puzzle.target, puzzle.epsilon, { maxDepth: 12 });
    assert.equal(solution.status, 'optimal');
    const payload = { date, name: 'Daily Ada', sequence: solution.sequence };
    Date.now = () => opensAt;
    await databaseNow(opensAt - 1);
    assert.equal((await post(payload)).status, 409, 'Database rejects an early submission even if application clock is ahead');
    assert.equal(await count(), 0);
    await databaseNow(opensAt);
    let response = await post(payload);
    assert.equal(response.status, 201, 'The scoring interval includes its first instant');
    let board = await response.json();
    const id = board.currentPlayer.id;
    assert.equal(board.currentPlayer.moves, puzzle.optimalMoves);
    assert.equal(board.total, 1);
    assert.deepEqual(await (await boardFor(date, id)).json(), board);
    assert.equal((await (await get()).json()).total, 0, 'Daily scores never enter campaign boards');
    const saved = (await database.query('SELECT * FROM scores WHERE id = $1', [id])).rows[0];
    assert.equal(saved.campaign, DAILY_VERSION);
    assert.equal(saved.level, 20261014);
    assert.equal(Number(saved.created_at), opensAt, 'Tie timestamps come from the same database instant as the scoring guard');

    Date.now = () => closesAt - 1;
    await databaseNow(closesAt - 1);
    response = await post(payload);
    assert.equal(response.status, 201, 'In-day retries are idempotent');
    assert.equal((await response.json()).currentPlayer.id, id);
    assert.equal(await count(), 1);
    assert.deepEqual((await database.query('SELECT * FROM scores WHERE id = $1', [id])).rows[0], saved);
    response = await post({ ...payload, name: 'Last instant' });
    assert.equal(response.status, 201);
    assert.equal(await count(), 2);

    await database.exec(`
      CREATE SEQUENCE test_clock.clock_calls;
      CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('quantum_golf.test_now')::timestamptz
          + CASE WHEN nextval('test_clock.clock_calls') > 1 THEN INTERVAL '1 millisecond' ELSE INTERVAL '0 milliseconds' END $$;
    `);
    assert.equal((await post(payload)).status, 409,
      'A retry that waits for a conflicting row across midnight also checks the clock before updating');
    assert.equal(await count(), 2);
    await database.exec(`
      CREATE OR REPLACE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('quantum_golf.test_now')::timestamptz $$;
    `);

    await databaseNow(closesAt);
    for (const submission of [payload, { ...payload, name: 'Delayed visitor' }]) {
      assert.equal((await post(submission)).status, 409, 'Requests begun yesterday cannot write at or after midnight');
    }
    assert.equal(await count(), 2);
    Date.now = () => closesAt;
    assert.equal((await post(payload)).status, 409, 'Stale clients are rejected by the server before a database request');
    assert.equal((await boardFor(date)).status, 200, 'Past puzzle boards remain readable');
    const tomorrow = '2026-10-15';
    assert.deepEqual(await (await boardFor(tomorrow)).json(), { total: 0, entries: [], currentPlayer: null });
    const tomorrowPuzzle = dailyPuzzle(tomorrow);
    const tomorrowSolution = solveShortest(tomorrowPuzzle.target, tomorrowPuzzle.epsilon, { maxDepth: 12 });
    assert.equal((await post({ date: tomorrow, name: 'Next day', sequence: tomorrowSolution.sequence })).status, 201);
    assert.equal((await (await boardFor(date)).json()).total, 2);
    assert.equal((await (await boardFor(tomorrow)).json()).total, 1, 'Each civil date has its own independent board');
    for (const query of ['date=2026-10-14&level=1', 'date=2026-10-16', 'date=2026-02-30', 'date=', 'date=2026-10-12']) {
      assert.equal((await route.fetch(new Request(`${endpoint}?${query}`))).status, 400);
    }

    // A DST change creates a 25-hour scoring interval rather than a fixed 24h.
    const autumn = '2026-10-25';
    const autumnBounds = dailyBounds(autumn);
    assert.equal(autumnBounds.closesAt - autumnBounds.opensAt, 25 * 60 * 60 * 1000);
    Date.now = () => autumnBounds.closesAt - 1;
    await databaseNow(autumnBounds.closesAt - 1);
    const autumnPuzzle = dailyPuzzle(autumn);
    const autumnSolution = solveShortest(autumnPuzzle.target, autumnPuzzle.epsilon, { maxDepth: 12 });
    assert.equal((await post({ date: autumn, name: 'DST visitor', sequence: autumnSolution.sequence })).status, 201);
    await databaseNow(autumnBounds.closesAt);
    assert.equal((await post({ date: autumn, name: 'Late DST visitor', sequence: autumnSolution.sequence })).status, 409);
  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});

test('circuit reduction shares ranking SQL while isolating campaigns, replays and request budgets', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://test.invalid/games';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows;
  };
  const address = `${endpoint}?game=circuit-reduction`;
  const level = CIRCUIT_LEVELS[0];
  const payload = { game: 'circuit-reduction', level: level.id, name: 'Ada', sequence: level.solution };
  const circuitBoard = player => route.fetch(new Request(`${address}&level=${level.id}${player ? `&player=${player}` : ''}`));
  const count = async () => Number((await database.query('SELECT COUNT(*) AS n FROM scores')).rows[0].n);
  try {
    await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
    assert.equal((await route.fetch(new Request(`${endpoint}?game=unknown&level=1`))).status, 400);
    assert.equal((await post({ ...payload, game: 'quantum-golf' }, origin, address)).status, 400,
      'Contradictory URL and body game selectors never switch score boards');
    for (const sequence of [[], 'T', [null], [{ rule: 'cancel-x', row: 0, column: 0 }],
      [{ rule: 'cancel-x', row: 0, column: '1' }], [{ rule: 'erase', row: 0, column: 1 }]]) {
      assert.equal((await post({ ...payload, sequence, moves: 1, circuit: [['.', '.']] }, origin, address)).status, 400);
    }
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_CIRCUIT_BYTES) }, origin, address)).status, 413);
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_CIRCUIT_BYTES) })).status, 413,
      'Body-selected circuit games have the same budget');
    assert.equal((await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: ' '.repeat(MAX_CIRCUIT_BYTES) + JSON.stringify(payload),
    }))).status, 413, 'Body-selected budgets include JSON whitespace from the original request');
    assert.equal(await count(), 0, 'Rejected replay and selector requests never write');

    const padding = [{ rule: 'insert-column', row: 0, column: 0 }, { rule: 'remove-column', row: 0, column: 0 }];
    const chargedDetour = [level.solution[0], level.solution[0]];
    let response = await post({ ...payload, sequence: [...padding, ...chargedDetour, ...level.solution] }, origin, address);
    assert.equal(response.status, 201);
    let result = await response.json();
    const initialId = result.currentPlayer.id;
    assert.equal(result.currentPlayer.moves, circuitSequenceCost(level.solution) + 2, 'Only reversible circuit rewrites count as score moves');
    response = await post(payload, origin, address);
    assert.equal(response.status, 201);
    result = await response.json();
    const bestId = result.currentPlayer.id;
    assert.notEqual(bestId, initialId);
    assert.equal(result.currentPlayer.moves, level.optimalMoves);
    assert.equal(result.total, 1);
    assert.deepEqual(await (await post(payload, origin, address)).json(), result, 'Retries keep a player record');
    assert.deepEqual(await (await post({ ...payload, sequence: [...padding, ...level.solution] }, origin, address)).json(), result,
      'A replay with free space adjustments resolves the same scored attempt');
    assert.equal(await count(), 2, 'Only distinct attempts are preserved');
    assert.deepEqual(await (await circuitBoard(initialId)).json(), result, 'Old IDs resolve the nickname’s current best');
    assert.equal((await circuitBoard(bestId)).headers.get('Cache-Control'), 'no-store');
    assert.equal((await circuitBoard()).headers.get('Cache-Control'), 'public, max-age=15');

    const saved = (await database.query('SELECT * FROM scores WHERE id = $1', [bestId])).rows[0];
    assert.equal(saved.campaign, CIRCUIT_CAMPAIGN);
    assert.deepEqual(Object.keys(saved).sort(), ['campaign', 'created_at', 'id', 'level', 'moves', 'name']);
    assert.deepEqual(await (await get()).json(), { total: 0, entries: [], currentPlayer: null });
    const golf = await (await post(valid())).json();
    assert.equal(golf.total, 1);
    assert.equal((await (await circuitBoard(golf.currentPlayer.id)).json()).currentPlayer, null,
      'A Golf player ID cannot identify a circuit-reduction player');
    assert.equal((await (await get(1, bestId)).json()).currentPlayer, null);
    assert.equal((await (await circuitBoard()).json()).total, 1);
    assert.equal((await post(payload)).status, 201, 'A body-only game selector is supported');
    const final = CIRCUIT_LEVELS.at(-1);
    assert.equal((await post({ ...payload, level: final.id, sequence: final.solution }, origin, address)).status, 201,
      'The shared existing table accepts every circuit campaign level');
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});

test('Signals records verified completions in the shared table without ranks', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL, originalNow = Date.now;
  process.env.DATABASE_URL = 'postgresql://test.invalid/games';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows.map(row => Object.fromEntries(Object.entries(row)
      .map(([key, value]) => [key, value !== null && ['id', 'total'].includes(key) ? String(value) : value])));
  };
  const address = `${endpoint}?game=quantum-signals`;
  const payload = { game: 'quantum-signals', level: 1, name: 'Ada', sequence: [{ hole: 'a', gate: 'X' }] };
  const count = async table => Number((await database.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  const list = (selector = 'level=1', player) => route.fetch(new Request(`${address}&${selector}${player ? `&player=${player}` : ''}`));
  const checkShape = body => {
    assert.deepEqual(Object.keys(body).sort(), ['currentPlayer', 'entries', 'total']);
    assert.ok(body.entries.length <= 11);
    for (const entry of body.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ['completed', 'id', 'name']);
      assert.equal(entry.completed, true);
      assert.equal(typeof entry.id, 'number');
    }
  };
  try {
    const schema = await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8');
    await database.exec(schema);
    assert.deepEqual(await (await list()).json(), { total: 0, entries: [], currentPlayer: null });
    for (const input of [null, [], {}, { ...payload, sequence: [] }, { ...payload, sequence: 'X' },
      { ...payload, sequence: [{ hole: 'a', gate: 'I' }] }, { ...payload, sequence: [{ hole: 'a', gate: 'H' }] },
      { ...payload, sequence: [{ hole: '__proto__', gate: 'X' }] }, { ...payload, name: 'Ada\u202e' },
      { ...payload, level: 99 }, { ...payload, date: SIGNAL_START }]) {
      assert.equal((await post(input, origin, address)).status, 400);
    }
    assert.equal((await post(payload, 'https://unrelated.example', address)).status, 403);
    assert.equal((await post({ ...payload, game: 'quantum-golf' }, origin, address)).status, 400);
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_SIGNAL_BYTES) }, origin, address)).status, 413);
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_SIGNAL_BYTES) })).status, 413,
      'A body-selected completion game retains its smaller request budget');
    assert.equal((await route.fetch(new Request(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: ' '.repeat(MAX_SIGNAL_BYTES) + JSON.stringify(payload),
    }))).status, 413, 'The completion budget includes leading JSON whitespace');
    assert.equal(await count('completions'), 0);
    assert.equal(await count('scores'), 0);

    Date.now = () => dailyBounds('2026-10-16').opensAt;
    const response = await post({ ...payload, name: '  Ada  ', moves: 0, rank: 1,
      optimalMoves: 0, target: [1], sequence: [{ hole: 'a', gate: 'I' }, ...payload.sequence] }, origin, address);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const first = await response.json();
    checkShape(first);
    assert.deepEqual(first, { total: 1, entries: [{ id: first.currentPlayer.id, name: 'Ada', completed: true }],
      currentPlayer: { id: first.currentPlayer.id, name: 'Ada', completed: true } });
    const saved = (await database.query('SELECT * FROM completions WHERE id = $1', [first.currentPlayer.id])).rows[0];
    assert.equal(saved.campaign, SIGNAL_CAMPAIGN);
    assert.deepEqual(Object.keys(saved).sort(), ['campaign', 'id', 'level', 'name']);
    assert.deepEqual((await database.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'completions' ORDER BY column_name")).rows
      .map(row => row.column_name), ['campaign', 'id', 'level', 'name'], 'Only identity and puzzle membership are stored');
    Date.now = () => dailyBounds('2026-10-17').opensAt;
    const retry = await post({ ...payload, sequence: [...payload.sequence,
      { hole: 'a', gate: null }, ...payload.sequence] });
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), first, 'Editing detours and retries keep one completion per name');
    assert.deepEqual((await database.query('SELECT * FROM completions WHERE id = $1', [first.currentPlayer.id])).rows[0], saved);
    await database.exec(schema);
    assert.equal(await count('completions'), 1, 'Reapplying the schema preserves completion records');

    for (const [index, puzzle] of SIGNAL_LEVELS.entries()) {
      const result = await post({ ...payload, level: index + 1, sequence: signalSequence(puzzle) }, origin, address);
      assert.equal(result.status, 201, 'Every campaign target is replay-verified without a minimum score');
      checkShape(await result.json());
    }
    const secondLevel = await (await list('level=2', first.currentPlayer.id)).json();
    assert.equal(secondLevel.currentPlayer, null, 'Player IDs cannot select a completion from another level');
    for (let index = 14; index >= 0; index--) {
      assert.equal((await post({ ...payload, name: `Player ${String(index).padStart(2, '0')}` }, origin, address)).status, 201);
    }
    const last = await (await post({ ...payload, name: 'Zoë' }, origin, address)).json();
    checkShape(last);
    assert.equal(last.total, 17);
    assert.equal(last.entries.length, 11);
    assert.equal(last.entries.at(-1).name, 'Zoë', 'A current player outside the first ten remains visible');
    assert.deepEqual(last.entries.slice(0, 10).map(entry => entry.name), ['Ada', ...Array.from({ length: 9 }, (_, i) => `Player 0${i}`)]);
    assert.deepEqual(await (await list('level=1', last.currentPlayer.id)).json(), last);
    const anonymous = await list();
    assert.equal(anonymous.headers.get('Cache-Control'), 'public, max-age=15');
    const publicList = await anonymous.json();
    checkShape(publicList);
    assert.equal(publicList.entries.length, 10); assert.equal(publicList.currentPlayer, null);
    assert.equal((await list('level=1', last.currentPlayer.id)).headers.get('Cache-Control'), 'no-store');
    const htmlName = "<b>O'Neil</b>";
    const html = await (await post({ ...payload, name: htmlName }, origin, address)).json();
    assert.equal(html.currentPlayer.name, htmlName, 'Names stay parameterized data for the text-only client');
    assert.equal(await count('scores'), 0, 'Completions never create ranked score records');
    assert.equal((await post(valid())).status, 201);
    assert.equal(await count('scores'), 1, 'Other games continue using the separate score table');

    const dailyPayload = { game: 'quantum-signals', date: SIGNAL_START, name: 'Archive Ada', sequence: signalSequence(signalDailyPuzzle(SIGNAL_START)) };
    const archiveResponse = await post(dailyPayload, origin, address);
    assert.equal(archiveResponse.status, 201, 'Past daily puzzles accept completions after Paris midnight');
    const archive = await archiveResponse.json();
    checkShape(archive);
    assert.equal(archive.total, 1);
    const archivedRow = (await database.query('SELECT * FROM completions WHERE id = $1', [archive.currentPlayer.id])).rows[0];
    assert.equal(archivedRow.campaign, SIGNAL_DAILY_CAMPAIGN);
    assert.equal(archivedRow.level, 20261015);
    assert.deepEqual(await (await list(`date=${SIGNAL_START}`, archive.currentPlayer.id)).json(), archive);
    assert.equal((await (await list('level=1', archive.currentPlayer.id)).json()).currentPlayer, null);
    Date.now = () => dailyBounds('2026-10-25').opensAt;
    assert.deepEqual(await (await post(dailyPayload, origin, address)).json(), archive,
      'Archive completion retries have no midnight or DST scoring deadline');
    for (const date of ['2026-10-14', '2026-10-26', '2026-02-30']) {
      assert.equal((await post({ ...dailyPayload, date }, origin, address)).status, 400);
    }

  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});

test('graph states ranks verified shots and enforces daily database deadlines', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL, originalNow = Date.now;
  process.env.DATABASE_URL = 'postgresql://test.invalid/games';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows.map(row => Object.fromEntries(Object.entries(row)
      .map(([key, value]) => [key, value !== null && ['id', 'rank', 'total'].includes(key) ? String(value) : value])));
  };
  const address = `${endpoint}?game=graph-states`;
  const sequence = graphSequence(GRAPH_LEVELS[0]);
  const payload = { game: 'graph-states', level: 1, name: 'Ada', sequence };
  const list = (selector = 'level=1', player) => route.fetch(new Request(`${address}&${selector}${player ? `&player=${player}` : ''}`));
  const count = async table => Number((await database.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  const bounds = dailyBounds(GRAPH_START);
  const databaseNow = instant => database.query("SELECT set_config('graph.test_now', $1, false)", [new Date(instant).toISOString()]);
  try {
    await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
    await database.exec(`
      CREATE SCHEMA test_clock;
      CREATE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('graph.test_now')::timestamptz $$;
      SET search_path TO test_clock, pg_catalog, public;
    `);
    Date.now = () => bounds.opensAt;
    for (const invalid of [[], [{ vertex: 0 }], [{ edge: [0, 3] }], [{ vertex: 0, moves: 0 }]]) {
      assert.equal((await post({ ...payload, sequence: invalid }, origin, address)).status, 400);
    }
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_GRAPH_BYTES) }, origin, address)).status, 413);
    assert.equal((await post({ ...payload, ignored: 'x'.repeat(MAX_GRAPH_BYTES) })).status, 413,
      'Body-selected graph scores retain the graph request budget');
    assert.equal(await count('scores'), 0);

    const detour = [{ vertex: 0 }, { vertex: 0 }];
    const initial = await (await post({ ...payload, moves: 0, sequence: [...detour, ...sequence] }, origin, address)).json();
    assert.equal(initial.currentPlayer.moves, graphSequenceCost(sequence) + 2, 'Every complementation counts even when the replay includes a reversible detour');
    assert.equal(initial.currentPlayer.rank, 1);
    const response = await post({ ...payload, moves: -100 }, origin, address);
    assert.equal(response.status, 201);
    const improved = await response.json();
    assert.equal(improved.currentPlayer.moves, graphSequenceCost(sequence), 'Client-supplied shot counts cannot change a replay score');
    assert.notEqual(improved.currentPlayer.id, initial.currentPlayer.id);
    assert.equal(improved.total, 1, 'Only the best attempt for a nickname enters the rankings');
    assert.deepEqual(await (await post(payload, origin, address)).json(), improved, 'Identical graph score retries are idempotent');
    assert.equal(await count('scores'), 2);
    assert.deepEqual(await (await list('level=1', initial.currentPlayer.id)).json(), improved, 'Older player IDs resolve the current best score');
    const saved = (await database.query('SELECT * FROM scores WHERE id = $1', [improved.currentPlayer.id])).rows[0];
    assert.equal(saved.campaign, GRAPH_CAMPAIGN);
    assert.deepEqual(Object.keys(saved).sort(), ['campaign', 'created_at', 'id', 'level', 'moves', 'name']);
    assert.equal(await count('completions'), 0, 'Graph rankings use the existing score table');

    const slower = await (await post({ ...payload, name: 'Grace', sequence: [...detour, ...sequence] }, origin, address)).json();
    assert.deepEqual(slower.entries.map(({ name, moves, rank }) => ({ name, moves, rank })), [
      { name: 'Ada', moves: graphSequenceCost(sequence), rank: 1 },
      { name: 'Grace', moves: graphSequenceCost(sequence) + 2, rank: 2 },
    ]);
    for (const [index, graph] of GRAPH_LEVELS.entries()) {
      const solved = await post({ ...payload, level: index + 1, sequence: graphSequence(graph) }, origin, address);
      assert.equal(solved.status, 201, 'Every official graph level supports ranked scores');
      assert.equal((await solved.json()).currentPlayer.moves, graphSequenceCost(graphSequence(graph)));
    }
    const pivot = await (await post({ ...payload, level: 2, sequence: [{ edge: [0, 1] }] }, origin, address)).json();
    assert.equal(pivot.currentPlayer.moves, 3, 'A pivot counts as three local complementations');
    assert.equal((await post({ game: 'quantum-signals', level: 1, name: 'Ada', sequence: [{ hole: 'a', gate: 'X' }] })).status, 201);
    assert.equal(await count('completions'), 1, 'Signals retains its separate checkbox completion table');
    assert.equal((await (await list('level=1', initial.currentPlayer.id)).json()).total, 2);
    assert.equal((await (await get()).json()).total, 0, 'Graph scores never appear in Golf');

    const dailyPayload = { game: 'graph-states', date: GRAPH_START, name: 'Daily Ada', sequence: graphSequence(graphDailyPuzzle(GRAPH_START)) };
    await databaseNow(bounds.opensAt - 1);
    assert.equal((await post(dailyPayload, origin, address)).status, 409, 'The database rejects early graph scores');
    await databaseNow(bounds.opensAt);
    const dailyResponse = await post(dailyPayload, origin, address);
    assert.equal(dailyResponse.status, 201);
    const daily = await dailyResponse.json();
    assert.equal(daily.currentPlayer.moves, graphSequenceCost(dailyPayload.sequence));
    const dailyRow = (await database.query('SELECT * FROM scores WHERE id = $1', [daily.currentPlayer.id])).rows[0];
    assert.equal(dailyRow.campaign, GRAPH_DAILY_CAMPAIGN);
    assert.equal(dailyRow.level, 20261016);
    assert.equal(Number(dailyRow.created_at), bounds.opensAt);
    assert.deepEqual(await (await post(dailyPayload, origin, address)).json(), daily);
    await databaseNow(bounds.closesAt);
    assert.equal((await post(dailyPayload, origin, address)).status, 409, 'A queued graph retry cannot cross Paris midnight');
    Date.now = () => bounds.closesAt;
    assert.equal((await post(dailyPayload, origin, address)).status, 409, 'Archived graph puzzles reject new ranked scores');
    assert.deepEqual(await (await list(`date=${GRAPH_START}`, daily.currentPlayer.id)).json(), daily, 'Archived graph rankings remain readable');
    assert.equal((await (await list('level=1', daily.currentPlayer.id)).json()).currentPlayer, null);
  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});

test('graph daily API serves ranked days with their exact shot benchmark', async () => {
  const originalNow = Date.now;
  Date.now = () => dailyBounds(GRAPH_START).opensAt;
  try {
    const address = `${endpoint.replace('leaderboard', 'daily')}?game=graph-states`;
    const response = await dailyRoute.fetch(new Request(address));
    assert.equal(response.status, 200);
    const info = await response.json();
    assert.equal(info.acceptingScores, true);
    assert.equal(info.startDate, GRAPH_START);
    assert.deepEqual(Object.keys(info.puzzle).sort(), ['edges', 'optimalMoves', 'vertices']);
    const graph = graphDailyPuzzle(GRAPH_START), { vertices, edges } = graph;
    assert.deepEqual(info.puzzle, { vertices, edges, optimalMoves: graphOptimalShots(graph) });
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-15`))).status, 400);
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-17`))).status, 400);
    Date.now = () => dailyBounds('2026-10-17').opensAt;
    const archived = await (await dailyRoute.fetch(new Request(`${address}&date=${GRAPH_START}`))).json();
    assert.equal(archived.acceptingScores, false);
    assert.deepEqual(archived.puzzle, info.puzzle);
    assert.equal(archived.nextChangeAt, dailyBounds('2026-10-17').closesAt);
  } finally { Date.now = originalNow; }
});

test('signal daily API keeps current and archived puzzles playable without scores', async () => {
  const originalNow = Date.now;
  Date.now = () => dailyBounds(SIGNAL_START).opensAt;
  try {
    const address = `${endpoint.replace('leaderboard', 'daily')}?game=quantum-signals`;
    const response = await dailyRoute.fetch(new Request(address));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const info = await response.json();
    assert.equal(info.date, SIGNAL_START);
    assert.equal(info.startDate, SIGNAL_START);
    assert.equal(info.acceptingScores, false);
    assert.equal(Object.hasOwn(info.puzzle, 'optimalMoves'), false);
    assert.deepEqual(Object.keys(info.puzzle).sort(), ['columns', 'target', 'wires']);
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-14`))).status, 400);
    assert.equal((await dailyRoute.fetch(new Request(`${address}&date=2026-10-16`))).status, 400);
    Date.now = () => dailyBounds('2026-10-16').opensAt;
    const archived = await (await dailyRoute.fetch(new Request(`${address}&date=${SIGNAL_START}`))).json();
    assert.equal(archived.acceptingScores, false);
    assert.deepEqual(archived.puzzle, info.puzzle, 'The archive retains the same circuit after midnight');
    assert.equal(archived.nextChangeAt, dailyBounds('2026-10-16').closesAt);
  } finally { Date.now = originalNow; }
});

test('circuit daily metadata and database scoring share Paris deadlines and remain separate from Golf', async () => {
  const database = new PGlite();
  const originalUrl = process.env.DATABASE_URL, originalNow = Date.now;
  process.env.DATABASE_URL = 'postgresql://test.invalid/games';
  globalThis.__quantumGolfPostgres = async (strings, ...values) => {
    const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
    return (await database.query(query, values)).rows;
  };
  const dailyAddress = endpoint.replace('leaderboard', 'daily');
  const date = '2026-10-14', bounds = dailyBounds(date);
  const address = `${endpoint}?game=circuit-reduction`;
  const payload = { game: 'circuit-reduction', date, name: 'Daily Ada', sequence: circuitPuzzle(date).solution };
  const boardFor = chosen => route.fetch(new Request(`${address}&date=${chosen}`));
  const databaseNow = instant => database.query("SELECT set_config('games.test_now', $1, false)", [new Date(instant).toISOString()]);
  try {
    await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
    await database.exec(`
      CREATE SCHEMA test_clock;
      CREATE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
        AS $$ SELECT current_setting('games.test_now')::timestamptz $$;
      SET search_path TO test_clock, pg_catalog, public;
    `);
    Date.now = () => bounds.opensAt;
    const response = await dailyRoute.fetch(new Request(`${dailyAddress}?game=circuit-reduction`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const info = await response.json();
    assert.equal(info.startDate, date);
    assert.equal(info.today, date);
    assert.equal(info.timeZone, 'Europe/Paris');
    assert.equal(info.opensAt, bounds.opensAt);
    assert.equal(info.closesAt, bounds.closesAt);
    assert.equal(info.acceptingScores, true);
    assert.deepEqual(Object.keys(info.puzzle).sort(), ['circuit', 'optimalMoves'], 'The endpoint publishes only the board and benchmark; daily play uses all learned rules');
    assert.deepEqual(info.puzzle.circuit, circuitPuzzle(date).circuit);
    assert.ok(info.puzzle.optimalMoves >= 10 && info.puzzle.optimalMoves <= 14);
    for (const chosen of ['2026-10-13', '2026-10-15', '2026-02-30']) {
      assert.equal((await dailyRoute.fetch(new Request(`${dailyAddress}?game=circuit-reduction&date=${chosen}`))).status, 400);
    }
    await databaseNow(bounds.opensAt - 1);
    assert.equal((await post(payload, origin, address)).status, 409, 'The database rejects early requests');
    await databaseNow(bounds.opensAt);
    const result = await (await post(payload, origin, address)).json();
    assert.equal(result.currentPlayer.moves, info.puzzle.optimalMoves);
    const saved = (await database.query('SELECT * FROM scores WHERE id = $1', [result.currentPlayer.id])).rows[0];
    assert.equal(saved.campaign, CIRCUIT_DAILY_VERSION);
    assert.equal(saved.level, 20261014);
    assert.equal(Number(saved.created_at), bounds.opensAt);
    assert.equal((await (await get()).json()).total, 0);
    assert.equal((await (await route.fetch(new Request(`${endpoint}?date=${date}`))).json()).total, 0,
      'The same date in Golf has an independent board');
    await databaseNow(bounds.closesAt);
    assert.equal((await post(payload, origin, address)).status, 409, 'A queued retry cannot cross Paris midnight');
    Date.now = () => bounds.closesAt;
    assert.equal((await post(payload, origin, address)).status, 409, 'Stale clients are rejected before writing');
    assert.equal((await (await boardFor(date)).json()).total, 1, 'Closed daily scores remain readable');
    const past = await (await dailyRoute.fetch(new Request(`${dailyAddress}?game=circuit-reduction&date=${date}`))).json();
    assert.equal(past.acceptingScores, false);
    assert.equal(past.nextChangeAt, dailyBounds('2026-10-15').closesAt);
    assert.deepEqual(past.puzzle, info.puzzle);
  } finally {
    Date.now = originalNow;
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    delete globalThis.__quantumGolfPostgres;
    await database.close();
  }
});
