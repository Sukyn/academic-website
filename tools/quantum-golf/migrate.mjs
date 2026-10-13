import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

class MigrationError extends Error {}

function integer(value, minimum = 0) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return false;
  return Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
}

export async function migrate(sql, rows = []) {
  if (!Array.isArray(rows)) throw new MigrationError('The score backup must contain an array of records.');
  const ids = new Set();
  const scores = rows.map((row, index) => {
    if (!row || !integer(row.id, 1) || !integer(row.level, 1) ||
      !integer(row.moves, 1) || !integer(row.created_at) ||
      typeof row.campaign !== 'string' || !row.campaign || row.campaign.includes('\0') ||
      typeof row.name !== 'string' || !row.name.trim() || Array.from(row.name).length > 24 || /\p{C}/u.test(row.name) ||
      typeof row.sequence !== 'string' || !row.sequence.length || row.sequence.length > 512 || /[^HT]/.test(row.sequence) ||
      Number(row.moves) !== row.sequence.length || ids.has(Number(row.id))) {
      throw new MigrationError(`Invalid score backup record ${index + 1}.`);
    }
    ids.add(Number(row.id));
    return [Number(row.id), row.campaign, Number(row.level), row.name, row.sequence, Number(row.moves), Number(row.created_at)];
  });
  const schema = (await Promise.all(['schema.sql', '001-expand-levels.sql'].map(file =>
    readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  const queries = schema.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => sql.query(statement));
  queries.push(sql.query('LOCK TABLE scores IN SHARE ROW EXCLUSIVE MODE'));
  for (const score of scores) {
    // An exact retry keeps its ID. A different record at that ID fails the
    // primary key's NOT NULL rule, rolling back the entire import.
    queries.push(sql.query(`
      INSERT INTO scores (id, campaign, level, name, sequence, moves, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET id = CASE WHEN
        (scores.campaign, scores.level, scores.name, scores.sequence, scores.moves, scores.created_at) =
        (EXCLUDED.campaign, EXCLUDED.level, EXCLUDED.name, EXCLUDED.sequence, EXCLUDED.moves, EXCLUDED.created_at)
        THEN scores.id END
    `, score));
  }
  queries.push(sql.query(`
    SELECT setval(pg_get_serial_sequence('scores', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0)
    FROM scores
  `));
  await sql.transaction(queries);
  return scores.length;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--scores' || !isAbsolute(args[1]))) {
    throw new MigrationError('Use --scores followed by the absolute path to a JSON score backup.');
  }
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new MigrationError('Set DATABASE_URL_UNPOOLED or DATABASE_URL for the target Neon database.');
  let rows = [];
  if (args.length) {
    try {
      const backup = JSON.parse(await readFile(args[1], 'utf8'));
      rows = Array.isArray(backup) ? backup : backup.rows;
    } catch { throw new MigrationError('Could not read the JSON score backup. Check its path and format.'); }
    if (!Array.isArray(rows)) throw new MigrationError('The score backup must contain an array of records.');
  }
  const count = await migrate(neon(url), rows);
  console.log(`Migration complete. ${count} backed-up scores verified.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof MigrationError ? error.message : 'Migration failed. Check database access and conflicting score records.');
    process.exitCode = 1;
  });
}
