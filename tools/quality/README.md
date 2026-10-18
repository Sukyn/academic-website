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
For recovery checks only: `npm run test:site:browser -- --resilience-only`.

Set `SITE_BASE_URL` (site checks) or `GAME_BASE_URL` (games) for another preview. `PLAYWRIGHT_EXECUTABLE` and `PLAYWRIGHT_MODULE_DIR` select an existing browser/runtime. Game API options are in [the game README](../circuit-reduction/README.md).

Run memory-heavy checks separately. For PGlite compiler exhaustion, use `node --liftoff-only --test tests/games/leaderboard-api.test.mjs`. Set `KNIP_DISABLE_RAW_TRANSFER=1` if Knip exhausts buffers on Windows.

References: [OWASP validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html), [WCAG](https://www.w3.org/WAI/standards-guidelines/wcag/), [Web Vitals](https://web.dev/articles/vitals), [animation performance](https://web.dev/articles/animations-guide).
