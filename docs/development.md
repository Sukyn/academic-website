# Development

Run commands from the repository root. Node 24 and Python 3.11+ are required.
Install Node dependencies with `npm ci` and Python dependencies with `python -m pip install -r requirements.txt`.

## Layout

| Folder | Contents |
| --- | --- |
| `src/` | Pages, components, browser controllers, styles and application logic |
| `api/` | Vercel request handlers |
| `tests/` | Unit tests by feature, browser checks, Python checks and fixtures |
| `tools/` | Development servers, asset builders, puzzle certification and score utilities |
| `public/` | Files served directly, including images, fonts and PDFs |
| `docs/` | Maintainer guides |

`dist/`, `.astro/`, `node_modules/`, `.venv/` and `tmp/` are generated or local.
Reports and optional test dependencies stay in ignored `tmp/`.

## Checks

```sh
npm test
npm run test:minimality
npm run check
npm audit --audit-level=high
npm run build
node tools/quality/weights.mjs
node tools/circuit-reduction/certify-generated.mjs --check-data
```

`npm test` discovers `tests/**/*.test.mjs`. Browser scripts are separate because they need a running site and optional tools:

```sh
npm install --prefix tmp/quality-tools --no-save --package-lock=false --ignore-scripts axe-core@4.14.0 knip@6.41.0 playwright@1.62.1
node tmp/quality-tools/node_modules/playwright/cli.js install chromium
npm run preview -- --host 127.0.0.1 --port 4323
```

In another terminal, run `npm run test:site:browser` and `npm run test:tutorials:browser`.
Individual game checks use `npm run test:reduction:browser`, `test:signals:browser`, `test:graphs:browser`, `test:zx:browser`, `test:categories:browser` and `test:daily:browser`.
Browser checks use local score fixtures; game API tests use PGlite. The shared helpers are in `tests/browser/helpers/` and `tests/helpers/`.

`SITE_BASE_URL` selects another site preview; `GAME_BASE_URL` selects another game preview.
`PLAYWRIGHT_MODULE_DIR`, `PLAYWRIGHT_EXECUTABLE` and `QUALITY_MODULE_DIR` select existing test dependencies.
Minimality browser checks need the Python API; see [Minimality](minimality.md).

Run dead-code checks with `node tmp/quality-tools/node_modules/knip/bin/knip.js --config knip.json`.
Run memory-heavy checks separately. On Windows, `KNIP_DISABLE_RAW_TRANSFER=1` avoids Knip buffer exhaustion; `node --liftoff-only --test tests/games/leaderboard-api.test.mjs` reduces PGlite compiler memory.

## Scores and backups

All games share one Neon project and the `quantum_golf` database, with separate Production and Preview branches.
Ranked results use `scores`; Signals completions use `completions`. Both APIs require a server-only `DATABASE_URL`.
The utilities in `tools/scores/` prefer `DATABASE_URL_UNPOOLED`. Keep credentials and environment files out of Git.

For a local scoring API, use `vercel env pull .env.local --environment=preview`, then `vercel dev`.
`npm run dev` serves the UI and Minimality API without the scoring endpoints.
Browser tests can run the real scoring handlers against local PGlite with `node tests/browser/server.mjs` and `GAME_API_URL=http://127.0.0.1:4322`.
`GAME_TEST_TIME` fixes the test clock in the server and browser.

```sh
node --env-file=.env.local tools/scores/export.mjs quantum-golf-scores.json
node --env-file=.env.local tools/scores/migrate.mjs --scores /absolute/path/to/backup.json
```

Exports preserve scores, completions, IDs and tie timestamps, and never overwrite an existing file.
Keep a private copy outside the hosting account. Restore into an empty Preview database and verify rankings before switching Production.
Omit `--scores` only to install or update the schema. Requests never migrate it.
A 503 requires checking function logs, schema and environment configuration. Redeploy after changing Vercel environment settings.

## Assets

`python -m pip install -r tools/profile/requirements.txt`, then `python tools/profile/build.py` regenerates the CV and overview in `public/profile/`. Use `--cv` or `--overview` to build only one.
Both PDFs share the same theme and [Florilegium v2.0.1](https://github.com/kevinraymond/florilegium/tree/v2.0.1) ornament, requiring Lua 5.3+ or `texlua` (MiKTeX / TeX Live). The local theme supplies ZX drawing primitives; Florilegium handles their growth and placement. The library is downloaded once into ignored `tmp/pdfs/`. The fixed PDF font in `tools/profile/` is the website's Grenze Gotisch at weight 600; its [license](../public/fonts/grenzegotisch-OFL.txt) is shared with the web fonts.
The site build does not regenerate these PDFs. Check their links and render every page after editing; use public research results and settled dates.
Keep publication details aligned with `src/content/publications.bibtex`.

Local WOFF2 fonts are declared in `src/styles/fonts.css`. Filenames identify family, weight, style and character subset; keep the four OFL license files alongside them.
`node tools/games/thumbnails.mjs` regenerates game illustrations from the gameplay renderers and needs a running site.

References: [OWASP validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html), [WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/), [Web Vitals](https://web.dev/articles/vitals), [animation performance](https://web.dev/articles/animations-guide).
