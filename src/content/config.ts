import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const posts = defineCollection({
  // Load Markdown + MDX posts from this folder
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),

  // Frontmatter schema (Deliverable 2: title, date, tags)
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()),
    draft: z.boolean().optional().default(false),

    // optional but useful (RSS + SEO)
    description: z.string().optional(),

    // ✅ Deliverable 3: cover image (optional)
    coverImage: z.string().optional(),
    coverImageAlt: z.string().optional(),
    coverCaption: z.string().optional(),
  }),
});

export const collections = { posts };
