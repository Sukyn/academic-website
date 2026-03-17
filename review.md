# Website Review

Reviewed on 2026-03-15.

Method: code audit of the Astro project, content review of the main pages and sample posts, plus build-health checks with `npm run check` and `npm run build`.

Important limitation: I did not run Lighthouse or real-device Web Vitals in a browser. The performance comments below are based on the shipped code, generated output, and asset sizes.

## Executive summary

The site already does the hardest part well: it feels like a real academic website with a point of view. The research identity is clear, the tone is warm without becoming casual, and the playful elements are controlled enough that they do not pull attention away from the science.

If your target is "easy to use, simple to read, a bit personal, with the scientific content as the main focus", the current site is close. The biggest opportunities are:

1. Make the best scientific material easier to discover at first glance.
2. Trim avoidable performance costs from rich media, external embeds, and shared client-side JavaScript.
3. Keep the codebase easy to evolve by breaking up the largest page and cleaning up a few structural inconsistencies.

## Snapshot

| Area | Verdict | Notes |
| --- | --- | --- |
| Overall positioning | Strong | Feels academic, specific, and personal rather than generic. |
| Content quality | Strong | Best on the homepage and blog; publications/about could sell the research more directly. |
| Performance | Good base, with headroom | Static Astro foundation is solid; media and shared JS are the main costs. |
| Code quality | Solid, but uneven | Good architecture overall; one large page and a few duplicated patterns are the main maintainability risks. |

## What already works well

- The site sounds like a person, not a template.
- The homepage communicates your area quickly and gives distinct entry points for researchers, students, and general readers.
- The overall visual language is appropriately academic: readable typography, restrained color, clear spacing, and no distracting gimmicks.
- The "fun twist" is present but controlled. The wallpaper and 404 page add personality without making the site feel unserious.
- The blog writing is a real strength. The published posts are explanatory, technically confident, and welcoming.
- The Ideas page has already avoided a common trap by adding quick paths, status labels, preview cards, and a glossary.
- Accessibility basics are better than average for a personal site: there is a skip link, a readable line length, good focus styles, a theme toggle, and print handling.
- Astro is a very good technical choice for this type of website.

## Performance review

### Quantitative signals

- `npm run check` completed with 0 errors and 1 hint.
- The only hint is missing TypeScript declarations for `bibtex-parse-js` in `src/lib/bibtex.ts`.
- `npm run build` completed successfully and produced 23 static pages in about 12.7 seconds.
- The shared client bundle is `dist/_astro/page.wczMSGxJ.js` at 131.6 KB raw / 45.1 KB gzip.
- That shared bundle is loaded on every route, including simple content pages.
- Largest built HTML files:
  - `dist/blog/01-circuits-fragments/index.html`: 240.6 KB
  - `dist/offers/index.html`: 105.2 KB
  - `dist/blog/03-phases/index.html`: 98.6 KB
  - `dist/blog/02-props-categories/index.html`: 76.3 KB
- Largest public assets:
  - `public/notes/clifford-minimality.pdf`: 7.27 MB
  - `public/notes/qudit-complete-theory.pdf`: 5.84 MB
  - `public/og/lego-interferometer.jpg`: 613 KB
  - `public/og/blochsphere.png`: 494 KB

### What is good already

- The site is static and deploy-friendly.
- Most pages are content-first and do not carry framework-heavy hydration.
- Mermaid is only loaded on posts that actually contain Mermaid content.
- Giscus is only enabled when the required environment variables exist.
- The animated wallpaper is limited to the homepage and 404 page instead of being site-wide.
- The build is healthy and uncomplicated, which matters a lot for a personal website.

### Main performance concerns

1. The site ships more JavaScript than a mostly static academic site really needs.

The shared client bundle is the single biggest structural cost right now. The site still feels fast in the "static site" sense, but there is room to move more behavior back toward minimal progressive enhancement.

2. Several routes depend on third-party runtime resources.

The site loads KaTeX CSS from jsDelivr, Mermaid from jsDelivr, Giscus, YouTube iframes, and Cloudflare analytics. None of these are unreasonable individually, but together they make the experience heavier and more externally dependent than it first appears.

3. Media is served mostly as raw files from `public/`.

That is simple and perfectly valid, but it means no responsive image variants, no automatic format optimization, and less control over layout stability. For a content-first site, this is easy performance headroom.

4. Some pages are very rich in HTML and embeds.

That is often justified by the subject matter, but it means the site should be especially careful with heavy video embeds and very large downloadable assets.

5. The blog pagination route currently creates a duplicate first page.

`/blog/page/1/` is built with its own canonical URL even though it duplicates `/blog/`. That is more of a quality/SEO issue than a raw speed issue, but it is still worth fixing.

### Best next performance improvements

- Replace raw YouTube iframes with a click-to-load or lite-embed pattern, especially in `src/content/posts/02-props-categories.mdx`.
- Move important cover images and large inline images to Astro's asset pipeline, or at least generate lighter variants with explicit `width` and `height`.
- Decide whether KaTeX and Mermaid should be local assets or consistently versioned external assets.
- Align Mermaid versions: the project depends on `mermaid` `^11.12.2`, while `src/pages/blog/[slug].astro` loads Mermaid `@10` from the CDN.
- Keep the wallpaper as a signature element, but do not let similar animated embellishments spread to more pages.
- Fix or canonicalize `/blog/page/1/`.
- Add file sizes or context text around the large PDFs so those downloads feel deliberate rather than incidental.

## Content review

### Fit for your stated goal

The tone is already close to ideal for what you described. It is serious, readable, and recognizably yours. The key content challenge is not prose quality. The prose is strong. The challenge is prioritization: the best material exists, but the site could surface the most important next click more aggressively for first-time visitors.

### Homepage

This is the strongest page on the site.

What works:

- It communicates your area quickly.
- It gives distinct entry points for different audiences.
- It keeps scientific content at the center through publications, current focus, and recurring questions.
- It already feels more like an academic homepage than a portfolio landing page.

What could improve:

- Add one compact trust-building block with concrete academic signals: affiliation, collaboration/supervision context, and a CV link.
- Consider highlighting one selected paper and one best-first blog post, not only the latest items, if "scientific content first" is the rule.

### About

The About page is clear and readable, but slightly underpowered compared with the homepage.

What would help most:

- A factual block with affiliation, location, CV, and maybe ORCID.
- A little more evidence of research trajectory: collaborators, methods, or tools you use.
- Slightly sharper academic context, rather than more personality, is what this page most needs.

### Publications

The Publications page is clean, but it currently undersells the research.

What would improve it:

- One-sentence summaries for each paper.
- Clear status labels such as `Preprint`, `Accepted`, `Journal`, `Conference`, or similar.
- Optional links to slides, notes, code, or talks where relevant.
- More explicit ordering rules if the homepage is going to show the "latest paper" and multiple entries share the same year.

### Ideas / student projects

This page has already solved part of the usual problem. The quick paths, glossary, status labels, and preview cards are good decisions and make it much more readable than a plain wall of project ideas.

What still needs attention:

- The page is still extremely long and mentally heavy for a first-time visitor.
- It mixes current opportunities, backlog ideas, and deep research notes on the same route.
- It partly reads like a public-facing student page and partly like a living internal notebook.

My recommendation is not to remove substance. It is to package the substance in layers:

- Keep the full long-form page.
- Add a shorter companion page such as `For students` or `Work with me`.
- Surface only the top active opportunities on that shorter page.
- Treat the rest as the deeper catalog for people who are already interested.

Also worth considering: `/offers` works internally, but a route like `/ideas`, `/students`, or `/work-with-me` may be clearer to new visitors.

### Blog

The blog is one of the strongest assets on the site.

What is especially good:

- The writing is pedagogical without becoming diluted.
- The posts are technically serious but still readable.
- The combination of equations, diagrams, and narrative fits the research area well.

What would help:

- Add a `Start here` or `Recommended first posts` section on the blog index.
- Distinguish more clearly between introductory explainers, research notes, and adjacent mathematical curiosities if you want the writing section to scale.
- Use a lighter strategy for embedded video.

### Contact

The Contact page is simple and effective, which is good.

Small additions that would strengthen it:

- Institutional profile and/or ORCID.
- GitHub on the page itself, not only in the footer.
- Possibly a short note about expected response time, though this is optional.

## Code quality review

### What is strong

- Astro is the right tool for this site.
- `src/layouts/BaseLayout.astro` handles titles, canonical URLs, metadata, and theme initialization sensibly.
- The global CSS is readable and fairly disciplined.
- The content collection schema is a good fit for the blog.
- The helper utilities are small and appropriate.
- The codebase already shows good instincts toward decomposition on the Ideas page through `OfferPreviewCard`, `OfferSummaryBlock`, `OfferSnapshot`, and `offerSummaries.ts`.

### Main concerns

1. `src/pages/offers.astro` is still too large.

It is about 1,299 lines / 62.8 KB of source. It mixes data, rendering, long-form content, and page-specific styles in a single file. The page works, but it is becoming the main maintenance bottleneck.

2. Blog listing logic is duplicated and inconsistent.

`src/pages/blog/page/[page].astro` duplicates logic that already exists elsewhere, formats dates differently, renders tags differently, and creates a duplicate `/blog/page/1/` route with its own canonical URL.

3. The media strategy is mostly "plain files in public".

That keeps the site simple, but it leaves easy performance and presentation gains on the table.

4. Tooling is still minimal.

`astro check` passes, which is good, but the repo has no linting, no formatting script, no smoke tests, and `README.md` is still the Astro starter template. That is manageable now, but it weakens future editing hygiene.

5. Small integration mismatches are starting to appear.

The cleanest example is Mermaid version drift: installed package version 11, CDN runtime version 10.

### Recommended codebase improvements

- Break the Ideas page into smaller topic/project content files plus rendering components.
- Create one shared helper or component for blog metadata and pagination.
- Add a local declaration for `bibtex-parse-js` to clear the remaining type hint.
- Replace the starter `README.md` with project-specific setup, structure, and deployment notes.
- Add a minimal CI/smoke-test layer: `npm run check`, `npm run build`, and maybe one page-level assertion.

## Suggested features and extensions

These are the additions that best fit your goals.

### Highest-value additions

- A `CV` page or downloadable academic CV.
- A `Talks` page with slides, recordings, and short abstracts.
- A `Notes` page for the PDFs already hosted in `public/notes`, with context and file sizes.
- A short `For students` / `Work with me` page that distills the top active opportunities.
- A `Selected writing` or `Start here` block for newcomers.

### Good second-wave additions

- A `Software / tools` page for prototypes, formalizations, or research code.
- A research timeline or `Now` page.
- Short paper summaries or "why this paper exists" blurbs.
- A compact outreach/teaching section, if you want to show more of your academic activity without diluting the research focus.

## Recommended roadmap

### Phase 1: high leverage, low effort

- Fix `/blog/page/1/` duplication and standardize blog metadata formatting.
- Replace the starter `README.md`.
- Add one-sentence summaries and status labels to the publications page.
- Add a CV link and one or two concrete academic trust signals on the homepage/About page.
- Compress the largest images and make PDF downloads more intentional.

### Phase 2: content-first polish

- Create a short `For students` / `Work with me` page.
- Add a `Notes` page for hosted PDFs.
- Curate `Start here` sections for the blog and publications.

### Phase 3: structural cleanup

- Split `src/pages/offers.astro` into content/data plus rendering components.
- Unify blog listing/tag/pagination logic.
- Improve the image pipeline and rich embed strategy.
- Add a minimal CI or smoke-test layer.

## Bottom line

This is already a good academic website. It has a real point of view, a strong writing voice, and a much clearer research identity than most personal academic sites.

The next step is not to make it flashier. The next step is to make the best scientific material easier to discover, easier to skim, and slightly lighter to load.

If I were choosing only three things to do next, I would do these:

1. Strengthen the research-first pages: homepage, About, and Publications.
2. Make the site lighter by improving media/embeds and fixing the duplicate blog pagination route.
3. Refactor the Ideas page so it stays rich without becoming the long-term maintenance bottleneck.
