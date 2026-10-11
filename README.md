# My academic website

Astro site for publications, talks, outreach, contact information, and research ideas.

## Commands

```sh
npm install
npm run dev
npm run check
npm run build
```

Main content lives in:

- `src/pages/` for routes
- `src/data/` for publications notes, talks, outreach, and research ideas
- `src/content/publications.bibtex` for BibTeX-backed publication metadata
- `public/` for PDFs and static assets

Fonts are configured in `astro.config.mjs` using Astro's fonts API. Astro downloads
and caches Google Fonts during development/build, then serves the generated files
from this site. A first build needs network access. `BaseLayout.astro` preloads
only four Latin fonts used in the header and body; other weights and subsets load
on demand, with `font-display: swap`. The Google provider wrapper keeps legacy
declarations before WOFF2 subsets so browsers use the smaller preloaded files.

Todo :
- Add dragons
