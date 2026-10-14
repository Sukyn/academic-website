# Academic website

Astro website for publications, talks, outreach, and contact information.

## Run and check

Use Node 24. Tests also need Python 3.8+.

```sh
npm ci
npm run dev
npm test
npm run check
npm run check:golf
npm run build
```

`npm run dev` serves the static site. To run the game APIs locally, see [database setup](tools/quantum-golf/SETUP.md).

## Files

- `src/pages/`: routes
- `src/data/`: talks, outreach, and research notes
- `src/lib/`, `src/scripts/`: reusable helpers and browser/worker code
- `src/content/publications.bibtex`: publications
- `public/`: PDFs, fonts, and other assets
- `api/`: daily puzzles and validated score endpoints
- `tests/`, `tools/`: regressions, offline generation, and maintenance checks

[Quantum golf](tools/quantum-golf/README.md) is at `/games/quantum-golf/`.
[Circuit reduction](tools/circuit-reduction/README.md) is at `/games/circuit-reduction/`.
The unlisted finite-field circuit tool is at `/circuits/`; its construction algorithms are checked against Python references with `npm run test:circuits`.

See [quality checks](tools/quality/README.md) for whole-site browser, accessibility, dependency, and dead-code audits. Test reports and temporary tools stay in ignored `tmp/`.
