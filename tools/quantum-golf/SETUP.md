# Quantum golf on your Vercel project

The website serves `/api/leaderboard` through a native Vercel Node function and stores scores in your Neon Postgres database. The database connection stays on the server. Astro and the game remain static; no Astro server adapter is needed.

## Connect storage

The `quantum-golf` Neon project uses separate `production` and `preview` branches. Vercel's `academic-website` project has an encrypted, server-only `DATABASE_URL` for each environment. Manage the database in your Neon account and the environment settings in your Vercel project.

To recreate this setup, create a Neon database through its console or Vercel's **Storage** integration, then configure `DATABASE_URL` on the Vercel project. Use a separate Neon branch for Preview and local testing so test scores stay out of the live leaderboard.

Use the pooled connection for the endpoint and the direct connection (`DATABASE_URL_UNPOOLED`) for migrations. Keep credentials in Vercel or an ignored local environment file.

## Create tables and transfer scores

Run these commands from the website repository with Node 24. Install dependencies with `npm ci`, and pull the selected environment into `.env.local`, for example with `vercel env pull .env.local --environment=preview` after linking this repository to your existing Vercel project.

```powershell
node --env-file=.env.local tools/quantum-golf/migrate.mjs
node --env-file=.env.local tools/quantum-golf/migrate.mjs --scores "C:\absolute\path\quantum-golf-scores.json"
```

The first command creates or updates the schema, including removing the former ten-level limit. Run it against Preview before Production; it preserves existing scores. The campaign data controls which levels accept new submissions. The second also imports a backup: either an array of database records or an object containing a `rows` array. Each record needs `id`, `campaign`, `level`, `name`, `sequence`, `moves`, and `created_at`.

The importer preserves IDs, campaign versions, timestamps, and every attempt. Exact retries are safe. Incompatible IDs or duplicate circuits under a different ID stop the transaction without replacing existing scores. It also advances the identity counter beyond the imported IDs. The endpoint never creates or migrates tables during requests.

## Back up and restore scores

Save a JSON backup before changing the campaign or database, and keep a copy outside the hosting account:

```powershell
node --env-file=.env.local tools/quantum-golf/export.mjs "quantum-golf-scores.json"
```

The export contains all campaigns and attempts, including player IDs and tie-breaking timestamps. It never overwrites an existing file. Restore it into an empty Preview database with the `migrate.mjs --scores` command above, then check the rankings before using that database in Production. Keep backups private: they contain player nicknames and circuits.

The table uses ordinary PostgreSQL SQL. For a complete database backup or a move away from Neon, use PostgreSQL's `pg_dump` and `pg_restore` with the direct connection string. The game itself is static; only the score API needs a server and database.

When changing the starting state, gate rules, or an existing hole's target or epsilon, change the campaign version before regenerating its data. That keeps earlier scores separate. Appending new holes can keep the same version when all existing holes stay unchanged.

## Development and verification

The game always calls `/api/leaderboard` on its own origin. Test changes with the Preview database, then deploy and verify a campaign win, nickname submission, displayed rank, and Next level on the live website.

A missing `DATABASE_URL`, missing tables, or inaccessible database produces a 503 response. Database requests stop waiting after ten seconds. Check the Vercel function logs and project environment settings, then redeploy if the settings changed. Logs include configuration status and SQL error codes without credentials, player names, or circuits.

For local games with scores, run `vercel dev` in the website repository after pulling Preview environment settings. Plain `astro dev` serves the game UI but does not run functions in the root `api/` directory.

References: [Vercel Marketplace storage](https://vercel.com/docs/storage), [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver).
