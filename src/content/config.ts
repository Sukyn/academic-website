import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const posts = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/posts" }),
  schema: z.object({
    title: z.string().min(1),
    date: z.coerce.date(),
    tags: z.array(z.string().min(1)).default([]),
    draft: z.boolean().optional().default(false),
    description: z.string().optional(),
    coverImage: z.string().optional(),
    coverImageAlt: z.string().optional(),
    coverCaption: z.string().optional(),
  }),
});


export const collections = { posts };