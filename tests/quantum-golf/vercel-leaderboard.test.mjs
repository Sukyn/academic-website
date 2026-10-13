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
    for (const name of ['quantum.js', 'campaign.json']) {
      await writeFile(new URL(`src/lib/quantum-golf/${name}`, compiledRoot),
        await readFile(websiteFile(`src/lib/quantum-golf/${name}`)));
    }
    // Keep the API's relative import intact. A .ts runtime import must fail here
    // because Vercel emits only .js files into the function's package.
    const { default: compiled } = await import(new URL('api/leaderboard.js', compiledRoot));
    const response = await compiled.fetch(new Request(`${endpoint}?level=unknown`));
    assert.equal(response.status, 400, 'The deployed handler can load its validator before servicing requests');
    assert.deepEqual(await response.json(), { error: `Choose a campaign level from 1 to ${LEVELS.length}.` });
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
    assert.equal((await post(valid({ name: 'Ada\u202e' }))).status, 400);
    for (const [body, status] of [['{bad', 400], ['🦊'.repeat(600), 413]]) {
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
    for (const name of ['Ada', 'ada', 'Zoë', 'Zoe\u0308']) {
      assert.equal((await post(valid({ level: 2, name, sequence: 'HT' }))).status, 201);
    }
    assert.equal((await (await get(2)).json()).total, 5, 'Exact case-sensitive Unicode nicknames keep their original identities');
    await database.query('INSERT INTO scores (campaign, level, name, sequence, moves, created_at) VALUES ($1, 1, $2, $3, 1, 0)',
      ['retired-campaign', 'Old campaign', 'H']);
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
  ];
  const snapshot = async () => (await database.query('SELECT * FROM scores ORDER BY id')).rows;
  try {
    assert.equal(await migrate(sql), 0, 'Schema setup needs no existing backup');
    assert.equal(await migrate(sql, backup), 4);
    const imported = await snapshot();
    assert.deepEqual(imported.map(value => ({ ...value, id: Number(value.id), created_at: Number(value.created_at) })),
      backup.map(value => ({
        ...value, id: Number(value.id), level: Number(value.level), moves: Number(value.moves), created_at: Number(value.created_at),
      })).sort((a, b) => a.id - b.id), 'All historical attempts, names, IDs and tie timestamps survive intact');
    await migrate(sql, backup);
    assert.deepEqual(await snapshot(), imported, 'Repeating the same import leaves records unchanged');
    const inserted = await database.query(`
      INSERT INTO scores (campaign, level, name, sequence, moves, created_at)
      VALUES ('quantum-golf-v1', 1, 'New visitor', 'H', 1, 1791812123456) RETURNING id
    `);
    assert.equal(Number(inserted.rows[0].id), 102, 'New visitors continue after the highest preserved player ID');
    await migrate(sql, backup);
    const intact = await snapshot();
    assert.equal(intact.length, 5, 'Retrying the backup preserves scores submitted after migration');

    const fresh = row({ id: 500, name: 'Imported next' });
    await assert.rejects(() => migrate(sql, [fresh, row({ name: 'Conflicting identity' })]));
    assert.deepEqual(await snapshot(), intact, 'A mismatched existing ID rolls back every new record in that batch');
    await assert.rejects(() => migrate(sql, [fresh, row({ id: 501 })]));
    assert.deepEqual(await snapshot(), intact, 'A circuit duplicated under a different ID also rolls back the batch');

    for (const bad of [
      [row(), row()], [row({ id: '9007199254740992' })], [row({ moves: 2 })],
      [row({ level: 2147483648 })],
      [row({ name: '🦊'.repeat(25) })], [row({ name: 'Ada\u202e' })], [row({ sequence: 'HX', moves: 2 })], null,
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
    { id: 9, campaign: 'retired-campaign', level: 1, name: 'Zoë 🦊', sequence: 'T', moves: 1, created_at: 0 },
    { id: 101, campaign: 'quantum-golf-v2-plus', level: 15, name: 'Ada', sequence: 'HT', moves: 2, created_at: 9007199254740991 },
  ];
  try {
    await migrate(adapter(databases[0]), rows);
    const source = { query: async query => (await databases[0].query(query)).rows };
    assert.equal(await exportScores(source, path), 2);
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

test('campaign expansion upgrades the old ten-hole constraint without changing stored scores', async () => {
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
  const insert = level => database.query(`
    INSERT INTO scores (campaign, level, name, sequence, moves, created_at)
    VALUES ('quantum-golf-v2-plus', $1, 'Existing visitor', 'T', 1, 1791810123456)
    RETURNING *
  `, [level]);
  try {
    const schema = await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8');
    await database.exec(schema.replace('CHECK (level >= 1)', 'CHECK (level BETWEEN 1 AND 10)'));
    const preserved = (await insert(1)).rows[0];
    await assert.rejects(() => insert(15), /scores_level_check/);
    assert.equal(await migrate(sql), 0);
    assert.deepEqual((await database.query('SELECT * FROM scores WHERE id = $1', [preserved.id])).rows, [preserved],
      'The expansion preserves existing scores, IDs and tie timestamps');
    const added = (await insert(15)).rows[0];
    assert.equal(added.level, 15);
    assert.equal(await migrate(sql, [added]), 1, 'The importer accepts and safely retries a score from level fifteen');
    assert.deepEqual((await database.query('SELECT * FROM scores ORDER BY id')).rows, [preserved, added],
      'Repeating the schema upgrade preserves both old and new level scores');
    await assert.rejects(() => insert(0), /scores_level_check/);
  } finally { await database.close(); }
});
