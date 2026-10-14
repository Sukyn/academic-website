// Local browser QA only: execute the real Vercel handlers against an in-memory
// PostgreSQL database. This deliberately replaces DATABASE_URL and Neon, so it
// cannot contact a production database.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { websiteFile } from '../quantum-golf/website.mjs';
import { loadApiFixture } from '../games/api-fixture.mjs';

const port = Number(process.env.GAME_API_PORT ?? 4322);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Choose a valid GAME_API_PORT.');
const database = new PGlite();
await database.exec(await readFile(websiteFile('tools/quantum-golf/schema.sql'), 'utf8'));
process.env.DATABASE_URL = 'postgresql://test.invalid/local_browser_qa';

const frozenTime = process.env.GAME_TEST_TIME ? Date.parse(process.env.GAME_TEST_TIME) : undefined;
if (frozenTime !== undefined) {
  if (!Number.isFinite(frozenTime)) throw new RangeError('Choose a valid GAME_TEST_TIME.');
  Date.now = () => frozenTime;
  await database.query("SELECT set_config('games.test_now', $1, false)", [new Date(frozenTime).toISOString()]);
  await database.exec(`
    CREATE SCHEMA test_clock;
    CREATE FUNCTION test_clock.clock_timestamp() RETURNS timestamptz LANGUAGE SQL VOLATILE
      AS $$ SELECT current_setting('games.test_now')::timestamptz $$;
    SET search_path TO test_clock, pg_catalog, public;
  `);
}

globalThis.__localGamePostgres = async (strings, ...values) => {
  const query = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
  return (await database.query(query, values)).rows;
};
const routes = new Map([
  ['/api/daily', await loadApiFixture('api/daily.ts')],
  ['/api/leaderboard', await loadApiFixture('api/leaderboard.ts', {
    neonReplacement: 'const neon = () => globalThis.__localGamePostgres;',
  })],
]);

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
  const route = routes.get(url.pathname);
  if (!route) { outgoing.writeHead(404); outgoing.end(); return; }
  const controller = new AbortController();
  incoming.on('aborted', () => controller.abort());
  outgoing.on('close', () => { if (!outgoing.writableFinished) controller.abort(); });
  try {
    const request = new Request(url, {
      method: incoming.method, headers: incoming.headers, signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(incoming.method)
        ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
    });
    const response = await route.fetch(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('Local game API failed.', { error: error instanceof Error ? error.name : 'Error' });
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: 'Local browser QA request failed.' }));
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Local game API ready at http://127.0.0.1:${port}; in-memory PGlite${frozenTime === undefined ? '' : `; clock ${new Date(frozenTime).toISOString()}`}.`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  server.close(async () => { await database.close(); process.exit(0); });
});
