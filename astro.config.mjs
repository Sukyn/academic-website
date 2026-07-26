// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import sentry from "@sentry/astro";

export default defineConfig({
  site: "https://colin-blake.eu/",
  integrations: [
    sentry({
      org: "colinblake",
      project: "academic-website",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
    sitemap(),
  ],
});
