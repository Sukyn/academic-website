import { getCollection, type CollectionEntry } from "astro:content";

export const POSTS_PER_PAGE = 5;

export type BlogPost = CollectionEntry<"posts">;

export async function getVisiblePosts() {
  return (await getCollection("posts", ({ data }) => {
    return import.meta.env.PROD ? data.draft !== true : true;
  })).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function getPageCount(
  postCount: number,
  postsPerPage = POSTS_PER_PAGE
) {
  return Math.max(1, Math.ceil(postCount / postsPerPage));
}

export function getPostsForPage(
  posts: BlogPost[],
  page: number,
  postsPerPage = POSTS_PER_PAGE
) {
  const start = (page - 1) * postsPerPage;
  return posts.slice(start, start + postsPerPage);
}

export function getBlogPageHref(page: number) {
  return page <= 1 ? "/blog" : `/blog/page/${page}`;
}
