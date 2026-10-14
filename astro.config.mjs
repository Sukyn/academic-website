// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://www.colin-blake.eu/",
  compressHTML: true,
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "connect-src 'self' blob:",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "worker-src 'self'",
      ],
      // Games and KaTeX set layout attributes; executable code still needs hashes.
      styleDirective: {
        resources: [
          { resource: "'self'", kind: "element" },
          { resource: "'unsafe-inline'", kind: "attribute" },
        ],
      },
    },
  },
  integrations: [
    sitemap({
      filter: (page) => !/^\/(offers|circuits)(\/|$)/.test(new URL(page).pathname),
    }),
  ],
});
