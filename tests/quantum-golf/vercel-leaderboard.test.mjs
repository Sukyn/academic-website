import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { websiteFile } from '../../tools/quantum-golf/website.mjs';
const { default: LEVELS } = await import(websiteFile('src/lib/quantum-golf/levels.json'), { with: { type: 'json' } });
const { solveShortest } = await import(websiteFile('src/lib/quantum-golf/solver.js'));
const { DAILY_VERSION, dailyBounds, dailyPuzzle } = await import(websiteFile('src/lib/quantum-golf/daily.js'));
const { MAX_SUBMISSION_BYTES } = await import(websiteFile('src/lib/quantum-golf/leaderboard.ts'));

const source = await readFile(websiteFile('api/leaderboard.ts'), 'utf8');
// Replace only the database transport. The Vercel handler, score validation and
// parameterized ranking SQL still run unchanged against real PostgreSQL.
const transportSource = source.replace(/import\s*\{\s*neon\s*\}\s*from\s*(['"])@neondatabase\/serverless\1;/,
  'const neon = (url, options) => { globalThis.__quantumGolfDatabaseOptions = options; return globalThis.__quantumGolfPostgres; };');
const fixture = transportSource
  .replace(/from\s*(['"])\.\.\/src\/lib\/quantum-golf\/leaderboard(?:\.[tj]s)?\1/,
    `from '${websiteFile('src/lib/quantum-golf/leaderboard.ts').href}'`);
assert.notEqual(transportSource, source, 'The Neon transport must be replaced in the test fixture');
const transpile = value => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText;
const outputText = transpile(fixture);
const { default: route } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const dailySource = await readFile(websiteFile('api/daily.ts'), 'utf8');
const dailyFixture = dailySource.replace(/from\s*(['"])\.\.\/src\/lib\/quantum-golf\/daily\.js\1/,
  `from '${websiteFile('src/lib/quantum-golf/daily.js').href}'`);
const { default: dailyRoute } = await import(`data:text/javascript;base64,${Buffer.from(transpile(dailyFixture)).toString('base64')}`);

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

test('compiled Vercel ESM imports resolve the emitted validator JavaScript', async () => {
  const tempBase = tmpdir();
  const directory = await mkdtemp(resolve(tempBase, 'vercel-esm-'));
  const compiledRoot = pathToFileURL(`${directory}/`);
  try {
    await writeFile(new URL('package.json', compiledRoot), '{"type":"module"}\n');
    await mkdir(new URL('api/', compiledRoot), { recursive: true });
    await mkdir(new URL('src/lib/quantum-golf/', compiledRoot), { recursive: true });
    await writeFile(new URL('api/leaderboard.js', compiledRoot), transpile(transportSource));
    await writeFile(new URL('src/lib/quantum-golf/leaderboard.js', compiledRoot),
      transpile(await readFile(websiteFile('src/lib/quantum-golf/leaderboard.ts'), 'utf8')));
    await writeFile(new URL('api/daily.js', compiledRoot), transpile(dailySource));
    for (const name of ['quantum.js', 'campaign.json', 'daily.js', 'solver.js']) {
      await writeFile(new URL(`src/lib/quantum-golf/${name}`, compiledRoot),
        await readFile(websiteFile(`src/lib/quantum-golf/${name}`)));
    }
    // Keep the API's relative import intact. A .ts runtime import must fail here
    // because Vercel emits only .js files into the function's package.
    const { default: compiled } = await import(new URL('api/leaderboard.js', compiledRoot));
    const response = await compiled.fetch(new Request(`${endpoint}?level=unknown`));
    assert.equal(response.status, 400, 'The deployed handler can load its validator before servicing requests');
    assert.deepEqual(await response.json(), { error: `Choose a campaign level from 1 to ${LEVELS.length}.` });
    const { default: compiledDaily } = await import(new URL('api/daily.js', compiledRoot));
    assert.equal((await compiledDaily.fetch(new Request(`${endpoint.replace('leaderboard', 'daily')}?date=invalid`))).status, 400);
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
    assert.deepEqual(logs.at(-1), ['Quantum golf leaderboard failed.', {
      configured: true, error: 'TimeoutError', code: undefined,
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

test('JSON export restores all historical scores and refuses to overwrite a backup', async () => {
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
  try {
    await migrate(adapter(databases[0]), rows);
    const source = { query: async query => (await databases[0].query(query)).rows };
    assert.equal(await exportScores(source, path), 3);
    const saved = await readFile(path, 'utf8');
    const backup = JSON.parse(saved);
    assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
    assert.deepEqual(backup.rows, rows);
    await assert.rejects(() => exportScores(source, path), { code: 'EEXIST' });
    assert.equal(await readFile(path, 'utf8'), saved);
    await migrate(adapter(databases[1]), backup.rows);
    assert.deepEqual((await databases[1].query('SELECT * FROM scores ORDER BY id')).rows, rows);
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
