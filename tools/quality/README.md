# Website quality checks

Keep the existing behaviour while testing failures, accessibility, resource use, and maintainability. `npm test` includes content helpers, finite-field circuits, game rules/controllers, and the actual API handlers with an isolated PostgreSQL database. No production credentials or score writes are needed.

## Routine checks

```sh
npm test
npm run check
npm audit --audit-level=high
npm run build
node tools/circuit-reduction/certify-generated.mjs --check-data
```

## Browser and analysis tools

These optional tools stay outside the website dependencies:

```sh
npm install --prefix tmp/quality-tools --no-save --package-lock=false --ignore-scripts axe-core@4.14.0 knip@6.41.0 lighthouse@13.5.0 playwright@1.62.1
node tmp/quality-tools/node_modules/playwright/cli.js install chromium
node tmp/quality-tools/node_modules/knip/bin/knip.js --config knip.json
npm run preview -- --host 127.0.0.1 --port 4323
```

With the preview running, use `npm run test:site:browser`. The script discovers built pages, runs axe WCAG checks on desktop and a 320px touch viewport, checks local links/anchors and ARIA references, tests dialog/skip-link focus, records resources, and proves that CSP blocks an injected script. Screenshots and JSON results go to `tmp/quality-report/`. Browser automation cannot prove full accessibility conformance; also check keyboard operation and meaningful content manually.

Set `SITE_BASE_URL` to audit another local preview. `PLAYWRIGHT_MODULE_DIR`, `QUALITY_MODULE_DIR`, and `PLAYWRIGHT_EXECUTABLE` allow existing tools or Chrome/Edge to be used. `QUALITY_MODULE_DIR` defaults to `tmp/quality-tools/node_modules`. On memory-constrained hosts set `KNIP_DISABLE_RAW_TRANSFER=1`; run browser and PostgreSQL checks separately.

Game playthroughs use `npm run test:reduction:browser` (see its [instructions](../circuit-reduction/README.md)). This also checks Golf. Lighthouse can audit the same local preview; retain its JSON/HTML output in `tmp/quality-report/`, and compare resource sizes as well as environment-dependent scores.

## Maintenance boundaries

- Runtime assets belong in `src/` or `public/`; proof witnesses, test transports, and build reports never ship as game dependencies.
- Profile portraits are pre-sized for the 11rem card (up to 480px wide, preserving aspect ratios); avoid shipping full-resolution replacements. Decorative wallpaper adapts its paint rate to device speed and pauses while hidden.
- Knip includes worker entry points and dynamic test/tool modules. Local exports used by independent tests are intentional; Playwright/axe are optional audit dependencies.
- API errors must not disclose upstream messages or credentials. Limit request bytes, read time, database execution, and replay work; scoring validates the canonical puzzle. Public anonymous scores still need host-level rate limiting to resist traffic floods.
- Astro hashes executable scripts and stylesheet elements during builds. Inline layout attributes remain allowed for game rendering and KaTeX. Vercel adds MIME, referrer, framing, and permission headers; test the production build when changing scripts or sources.

Guidance: [OWASP API resource limits](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/), [W3C keyboard focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible), [web.dev performance](https://web.dev/learn/performance/optimize-web-fonts), [Astro CSP](https://docs.astro.build/en/reference/configuration-reference/#securitycsp), and [Knip analysis](https://knip.dev/explanations/how-knip-works).
