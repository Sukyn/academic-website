# Scores and hosting

Vercel's `academic-website` project serves the static site and `/api/daily` and `/api/leaderboard`. The `quantum-golf` Neon database has separate Production and Preview branches. Each Vercel environment supplies its own server-only `DATABASE_URL`; migrations use `DATABASE_URL_UNPOOLED` when available. No Astro server adapter is needed.

## Local scores

From the website repository, after the [normal installation](../../README.md):

```sh
vercel env pull .env.local --environment=preview
vercel dev
```

Use Preview for testing. Plain `npm run dev` runs only the game UI, without the API endpoints. Keep environment files and database credentials out of Git.

## Backups and restore

With `.env.local` pointing to the database being backed up:

```sh
node --env-file=.env.local tools/quantum-golf/export.mjs quantum-golf-scores.json
```

This exports all campaign and daily attempts, IDs, and timestamps to a new file. Keep a private copy outside the hosting account; exports never overwrite files.

To restore, switch `.env.local` to an empty Preview database and supply an absolute backup path:

```sh
node --env-file=.env.local tools/quantum-golf/migrate.mjs --scores "C:\absolute\path\quantum-golf-scores.json"
```

The command installs the schema and imports scores without replacing conflicting records. Check rankings in Preview before using a restored database in Production. Run the same command without `--scores` only when installing or updating the schema; normal requests never migrate it.

The API validates circuits without a gate-count cap, then saves only score details. Requests must fit Vercel's 4.5 MB payload limit. For a live upgrade, make the old `sequence` column nullable, create `scores_submission_moves` from `schema.sql`, deploy the API, then run the migration to drop the old column.

## Unavailable scores

A 503 response means the database connection or schema is unavailable. Check Vercel function logs and that environment's `DATABASE_URL`. Redeploy after changing Vercel environment settings.
