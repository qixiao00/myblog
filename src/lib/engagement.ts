import { getDb } from "./db";

export type PostView = {
  slug: string;
  views: number;
};

export async function getPostViews(slug: string) {
  try {
    const sql = getDb();
    const [row] = await sql<{ views: number }[]>`
      select views
      from post_views
      where slug = ${slug}
      limit 1
    `;

    return row?.views ?? 0;
  } catch {
    return 0;
  }
}

export async function getViewStats(topN = 20) {
  try {
    const sql = getDb();

    const [siteViews] = await sql<{ views: number }[]>`
      select coalesce(sum(views), 0)::int as views
      from post_views
    `;

    const topPosts = await sql<PostView[]>`
      select slug, views::int
      from post_views
      order by views desc
      limit ${topN}
    `;

    return {
      siteViews: siteViews?.views ?? 0,
      topPosts,
    };
  } catch {
    return {
      siteViews: 0,
      topPosts: [],
    };
  }
}
