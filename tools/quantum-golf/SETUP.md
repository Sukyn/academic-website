# Quantum golf on your Vercel project

The website serves `/api/leaderboard` through a native Vercel Node function and stores scores in your Neon Postgres database. The database connection stays on the server. Astro and the game remain static; no Astro server adapter is needed.

## Connect storage

The `quantum-golf` Neon project uses separate `production` and `preview` branches. Vercel's `academic-website` project has an encrypted, server-only `DATABASE_URL` for each environment. Manage the database in your Neon account and the environment settings in your Vercel project.

To recreate this setup, create a Neon database through its console or Vercel's **Storage** integration, then configure `DATABASE_URL` on the Vercel project. Use a separate Neon branch for Preview and local testing so test scores stay out of the live leaderboard.

If the integration uses a prefix, configure an unprefixed `DATABASE_URL` in Vercel to point to that same database. Use the pooled connection for the endpoint and the direct connection (`DATABASE_URL_UNPOOLED`) for migrations. Keep both credentials in Vercel or an ignored local environment file; never put them in browser code or Git.

## Create tables and transfer scores

Run these commands from the website repository with Node 22 or later. Install dependencies with `npm ci`, and pull the selected environment into `.env.local`, for example with `vercel env pull .env.local --environment=preview` after linking this repository to your existing Vercel project.

```powershell
node --env-file=.env.local tools/quantum-golf/migrate.mjs
node --env-file=.env.local tools/quantum-golf/migrate.mjs --scores "C:\absolute\path\quantum-golf-scores.json"
```

The first command creates the schema. The second also imports a backup: either an array of database records or an object containing a `rows` array. Each record needs `id`, `campaign`, `level`, `name`, `sequence`, `moves`, and `created_at`.

The importer preserves IDs, campaign versions, timestamps, and every attempt. Exact retries are safe. Incompatible IDs or duplicate circuits under a different ID stop the transaction without replacing existing scores. It also advances the identity counter beyond the imported IDs. The endpoint never creates or migrates tables during requests.

## Verify and switch

1. Import the backup into the Preview database and deploy a preview. The game uses `/api/leaderboard` on its own origin by default.
2. Play a campaign hole, save a nickname, check its rank, replay it, and verify that its best score and neighbouring ranks remain correct. Confirm imported names and scores appear.
3. Before production cutover, obtain a fresh backup from the existing service and import it into the Production database using that environment's credentials. Minimise the gap between this export and cutover so new scores are included.
4. Deploy to Production and verify a saved score on your live domain. Remove any legacy `PUBLIC_QUANTUM_GOLF_API` override if one was configured.
5. Keep the old service available until the new endpoint is verified and the transfer is complete.

A missing `DATABASE_URL`, missing tables, or inaccessible database produces a 503 response. Check the Vercel function logs and project environment settings, then redeploy if the settings changed. No ChatGPT login or Sites service is needed once the new endpoint is selected.

For local games with scores, run `vercel dev` in the website repository after pulling Preview environment settings. Plain `astro dev` serves the game UI but does not run functions in the root `api/` directory.

References: [Vercel Marketplace storage](https://vercel.com/docs/storage), [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver).
