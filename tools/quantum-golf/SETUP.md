# Scores and hosting

Vercel serves the static site and both game APIs. All four games share one Neon project and its `quantum_golf` database, with separate Production and Preview branches. Ranked results use `scores`; Quantum signals uses `completions`. Queries and indexes group records by campaign and level, so adding games does not require more databases.

Each environment needs a server-only `DATABASE_URL`; migrations prefer `DATABASE_URL_UNPOOLED`. Keep credentials and environment files out of Git.

## Local API

```sh
vercel env pull .env.local --environment=preview
vercel dev
```

Use Preview for testing. `npm run dev` serves the UI without API endpoints.

## Backup and restore

Point `.env.local` at the database to back up:

```sh
node --env-file=.env.local tools/quantum-golf/export.mjs quantum-golf-scores.json
```

Exports include all scores and completions, preserving IDs and score timestamps. Existing files are never overwritten. Keep a private copy outside the hosting account. To restore, point `.env.local` at an **empty Preview database** and use an absolute backup path:

```sh
node --env-file=.env.local tools/quantum-golf/migrate.mjs --scores "C:\absolute\path\quantum-golf-scores.json"
```

The command installs the schema and imports records without replacing conflicts. Check rankings in Preview before switching Production. Omit `--scores` only to install/update the schema; requests never migrate it.

For a live upgrade from the old `sequence` column: make it nullable, create `scores_submission_moves` from `schema.sql`, deploy the API, then run the migration to drop the old column. Requests must fit Vercel's 4.5 MB payload limit.

A 503 indicates an unavailable database or schema. Check function logs and that environment's `DATABASE_URL`. Redeploy after changing Vercel environment settings.
