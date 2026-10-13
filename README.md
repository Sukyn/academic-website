# My academic website

Astro site for publications, talks, outreach, contact information, and research ideas.

Quantum golf uses a native Vercel function at `/api/leaderboard` and a Neon Postgres database. Its source, campaign generator, tests, and database tools are all in this repository. See [game maintenance](tools/quantum-golf/README.md) and [database setup and backups](tools/quantum-golf/SETUP.md).

## Commands

```sh
npm ci
npm run dev
npm test
npm run check
npm run build
```

Main content lives in:

- `src/pages/` for routes
- `src/data/` for publications notes, talks, outreach, and research ideas
- `src/content/publications.bibtex` for BibTeX-backed publication metadata
- `public/` for PDFs and static assets

Use Node 24. Fonts are self-hosted in `public/fonts/` and defined in
`src/styles/fonts.css`. They preserve the original font files and load without a
Google Fonts request or an experimental Astro provider. `BaseLayout.astro`
preloads four Latin fonts; other weights and subsets load on demand.

Todo :
- Add dragons

The unlisted circuit tool is at `/circuits/` (excluded from search indexing and
the sitemap). It supports field sizes up to 256 of characteristic at least 5,
1–32 controls, and up to 12,000 displayed operations. Run `npm run test:circuits` to
compare the browser implementation with the Python references. To refresh those
references, run `python tests/make_circuit_references.py --source-root PATH_TO_TOFFOLI --output-dir tmp/circuit-references`, then copy `references.json` to
`tests/circuit-references.json` and `fields.json` to `src/lib/circuits/fields.json`.
