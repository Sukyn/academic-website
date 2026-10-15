# Checks

```sh
npm test
npm run check
npm audit --audit-level=high
npm run build
node tools/circuit-reduction/certify-generated.mjs --check-data
```

## Browser checks

Install optional tools once:

```sh
npm install --prefix tmp/quality-tools --no-save --package-lock=false --ignore-scripts axe-core@4.14.0 knip@6.41.0 playwright@1.62.1
node tmp/quality-tools/node_modules/playwright/cli.js install chromium
```

Start `npm run preview -- --host 127.0.0.1 --port 4323`, then run:

```sh
npm run test:site:browser
node tmp/quality-tools/node_modules/knip/bin/knip.js --config knip.json
```

Reports go to `tmp/quality-report/`. Browser tests use score fixtures; API tests use PGlite.

Set `SITE_BASE_URL` (site checks) or `GAME_BASE_URL` (games) for another preview. `PLAYWRIGHT_EXECUTABLE` and `PLAYWRIGHT_MODULE_DIR` select an existing browser/runtime. Game API options are in [the game README](../circuit-reduction/README.md).

On low-memory machines, run database and browser tests separately. Set `KNIP_DISABLE_RAW_TRANSFER=1` if Knip fails allocating buffers on Windows.
