import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

class ExportError extends Error {}

export async function exportScores(sql, path) {
  const rows = await sql.query(`
    SELECT id, campaign, level, name, sequence, moves, created_at
    FROM scores ORDER BY id
  `);
  await writeFile(path, JSON.stringify({ exportedAt: new Date().toISOString(), rows }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  return rows.length;
}

async function main() {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new ExportError('Use one destination path for a new JSON score backup.');
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new ExportError('Set DATABASE_URL_UNPOOLED or DATABASE_URL before exporting scores.');
  const count = await exportScores(neon(url, { fetchOptions: { signal: AbortSignal.timeout(60_000) } }), resolve(path));
  console.log(`Export complete. ${count} scores saved.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof ExportError ? error.message :
      'Export failed. Check database access and use a destination file that does not already exist.');
    process.exitCode = 1;
  });
}
