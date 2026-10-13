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
- `src/content/publications.bibtex`: publications
- `public/`: PDFs, fonts, and other assets

[Quantum golf](tools/quantum-golf/README.md) is at `/games/quantum-golf/`.
The unlisted circuit tool is at `/circuits/`; check it with `npm run test:circuits`.
