// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://colin-blake.eu/",
  integrations: [
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/offers"),
    }),
  ],
});
