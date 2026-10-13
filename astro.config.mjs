// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://colin-blake.eu/",
  compressHTML: true,
  integrations: [
    sitemap({
      filter: (page) => !/^\/(offers|circuits)(\/|$)/.test(new URL(page).pathname),
    }),
  ],
});
