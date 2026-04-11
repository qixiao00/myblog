import { getDb } from "./db";

export type Comment = {
  id: number;
  slug: string;
  nickname: string;
  content: string;
  createdAt: string;
};

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

export async function getCommentsBySlug(slug: string, limit = 100) {
  try {
    const sql = getDb();
    const rows = await sql<Comment[]>`
      select
        id,
        slug,
        nickname,
        content,
        created_at as "createdAt"
      from comments
      where slug = ${slug}
        and status = 'approved'
      order by created_at desc
      limit ${limit}
    `;

    return rows;
  } catch {
    return [];
  }
}

export async function getStatsOverview(topN = 20) {
  try {
    const sql = getDb();

    const [siteViews] = await sql<{ views: number }[]>`
      select coalesce(sum(views), 0)::int as views
      from post_views
    `;

    const [comments] = await sql<{ comments: number }[]>`
      select count(*)::int as comments
      from comments
      where status = 'approved'
    `;

    const topPosts = await sql<PostView[]>`
      select slug, views::int
      from post_views
      order by views desc
      limit ${topN}
    `;

    return {
      siteViews: siteViews?.views ?? 0,
      comments: comments?.comments ?? 0,
      topPosts,
    };
  } catch {
    return {
      siteViews: 0,
      comments: 0,
      topPosts: [],
    };
  }
}
