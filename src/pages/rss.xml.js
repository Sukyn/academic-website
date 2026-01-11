import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const posts = (await getCollection("posts", ({ data }) => {
    return import.meta.env.PROD ? data.draft !== true : true;
  })).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: "Colin Blake - Blog",
    description: "Research notes and writing.",
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description ?? "",
      link: `/blog/${post.id}/`,
    })),
  });
}
