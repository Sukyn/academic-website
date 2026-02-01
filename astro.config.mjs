// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import sitemap from "@astrojs/sitemap";

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
    sitemap(),
  ],
});
