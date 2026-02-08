// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro";

import remarkCallouts from "./src/plugins/remark-callouts.js";

export default defineConfig({
  site: "https://colin-blake.eu/",
  markdown: {
    // ✅ important: don't highlight ```mermaid blocks
    syntaxHighlight: {
      excludeLangs: ["mermaid"],
    },
    remarkPlugins: [remarkMath, remarkCallouts],
    rehypePlugins: [[rehypeKatex, { output: "html" }]],
  },
  integrations: [
    mdx({
      // ✅ same for MDX pipeline
      syntaxHighlight: {
        excludeLangs: ["mermaid"],
      },
      remarkPlugins: [remarkMath, remarkCallouts],
      rehypePlugins: [[rehypeKatex, { output: "html" }]],
    }),

    // ✅ Sentry error monitoring
    sentry({
      // PUBLIC_* = accessible côté client (normal pour un DSN)
      dsn: import.meta.env.PUBLIC_SENTRY_DSN,

      // ✅ Upload sourcemaps only in production builds
      // This prevents local/dev builds from failing if token is missing.
      sourceMapsUploadOptions: import.meta.env.PROD
        ? {
            // Recommandé: mets ces valeurs en variables d'env sur Vercel
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
          }
        : undefined,
    }),

    sitemap(),
  ],
});
