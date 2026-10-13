# Quantum golf maintenance

The page, browser JavaScript, campaign source, API, tests, and database tools all live in this repository. No ChatGPT runtime or separate workspace is needed. The browser game has no runtime library dependencies. Astro builds static files; Vercel runs only `api/leaderboard.ts`.

## Run and verify

Use Node 24 and Python 3.8+ (standard library only). Python is needed for campaign checks, never for playing or serving scores.

```sh
npm ci
npm run dev
npm test
npm run check
npm run check:golf
npm run build
```

Open `/games/quantum-golf/`. For local shared scores use `vercel dev` with Preview database credentials; see [SETUP.md](SETUP.md). GitHub runs the checks and build on pushes and pull requests without database credentials. API tests use local PostgreSQL through PGlite.

## Campaign changes

Edit `tools/quantum-golf/campaign.json`, then run `npm run precompute:golf`. This generates both frontend and server metadata, including independently verified shortest move counts. `npm run verify:campaign` detects stale generated data. Add levels with consecutive IDs; no code change is needed for the level count.

The start is `|+⟩`, and the objective is shortest total H+T presses to prepare a state within `‖r − target‖ / 2 ≤ ε`. It is not full-unitary synthesis or minimum T-count. The Python checker uses independent complex amplitudes; it removes only exact identities HH and T⁸. Runtime data includes minimum lengths, never solution circuits.

Change the campaign version when changing existing holes, gates, or the starting state. Back up scores first and keep earlier campaigns in the database. New levels can keep the version if existing scoring rules stay identical.

## Dependencies and hosting

Commit `package-lock.json`; use `npm ci` for reproducible installs. Upgrade packages deliberately, review `npm audit`, and run the full checks before deploying. Node 24 is the tested runtime in `.node-version`, `package.json`, and CI; update these together when moving to another supported Node version. Fonts are ordinary local WOFF2 assets and CSS, with their licenses in `public/fonts/`.

The built `dist/` directory can be archived and served by another static host. Gameplay does not require the score service. To move shared scores, export the database using [SETUP.md](SETUP.md), host the standard Request/Response handler, and provide a PostgreSQL connection. The only database provider dependency is the Neon transport in the API and maintenance tools.

Keep a private score backup outside the hosting account and periodically test restoration into Preview. Keep the domain, hosting account, and database account active. Tests reduce code regressions; they cannot preserve third-party accounts automatically.
