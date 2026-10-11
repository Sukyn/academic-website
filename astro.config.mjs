// @ts-check
import { defineConfig, defineAstroFontProvider } from "astro/config";
import sitemap from "@astrojs/sitemap";

const googleFonts = defineAstroFontProvider({
  entrypoint: "./src/lib/googleFontProvider.mjs",
});

export default defineConfig({
  site: "https://colin-blake.eu/",
  experimental: {
    fonts: [
      {
        provider: googleFonts,
        name: "Grenze Gotisch",
        cssVariable: "--font-display",
        // Keep Google's original variable-font build for identical heading metrics.
        weights: [400, 500, 600, 700],
        styles: ["normal"],
        subsets: ["latin", "latin-ext", "vietnamese"],
        fallbacks: ["Georgia", "serif"],
        optimizedFallbacks: false,
        display: "swap",
      },
      {
        provider: googleFonts,
        name: "Spectral",
        cssVariable: "--font-body",
        weights: [400, 600, 700],
        styles: ["normal"],
        subsets: [
          "latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "vietnamese",
        ],
        fallbacks: ["Iowan Old Style", "Georgia", "serif"],
        optimizedFallbacks: false,
        display: "swap",
      },
      {
        provider: googleFonts,
        name: "Spectral",
        cssVariable: "--font-body",
        weights: [400],
        styles: ["italic"],
        subsets: [
          "latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "vietnamese",
        ],
        fallbacks: ["Iowan Old Style", "Georgia", "serif"],
        optimizedFallbacks: false,
        display: "swap",
      },
      {
        provider: googleFonts,
        name: "Alegreya Sans",
        cssVariable: "--font-ui",
        // Keep the current weight set: CSS weight 600 resolves to 700.
        weights: [400, 500, 700],
        styles: ["normal"],
        subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "vietnamese"],
        fallbacks: [
          "Avenir Next", "Segoe UI", "Helvetica Neue", "Arial", "sans-serif",
        ],
        optimizedFallbacks: false,
        display: "swap",
      },
      {
        provider: googleFonts,
        name: "Space Mono",
        cssVariable: "--font-mono",
        weights: [400, 700],
        styles: ["normal"],
        subsets: ["latin", "latin-ext", "vietnamese"],
        fallbacks: [
          "Cascadia Code", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace",
        ],
        optimizedFallbacks: false,
        display: "swap",
      },
    ],
  },
  integrations: [
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/offers"),
    }),
  ],
});
