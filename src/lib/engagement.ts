import { SITE_VIEW_PREFIX, SITE_STARTED_KEY } from "./site-views";
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
    const [summary] = await sql<{ site_views: number; post_views: number; started: Date | null }[]>`
      select
        coalesce(sum(views) filter (where starts_with(slug, ${SITE_VIEW_PREFIX}) and slug <> ${SITE_STARTED_KEY}), 0)::bigint as site_views,
        coalesce(sum(views) filter (where not starts_with(slug, ${SITE_VIEW_PREFIX})), 0)::bigint as post_views,
        min(updated_at) filter (where slug = ${SITE_STARTED_KEY}) as started
      from post_views
    `;
    const topPosts = await sql<PostView[]>`
      select slug, views::bigint from post_views
      where not starts_with(slug, ${SITE_VIEW_PREFIX})
      order by views desc limit ${topN}
    `;
    const topPages = await sql<PostView[]>`
      select substring(slug from ${SITE_VIEW_PREFIX.length + 1}::integer) as slug, views::bigint from post_views
      where starts_with(slug, ${SITE_VIEW_PREFIX}) and slug <> ${SITE_STARTED_KEY}
      order by views desc limit ${topN}
    `;
    return { siteViews: Number(summary?.site_views || 0), postViews: Number(summary?.post_views || 0), siteStarted: summary?.started?.toISOString() || null,
      topPosts: topPosts.map(row => ({ ...row, views: Number(row.views) })), topPages: topPages.map(row => ({ ...row, views: Number(row.views) })) };
  } catch {
    return { siteViews: null, postViews: null, siteStarted: null, topPosts: [], topPages: [] };
  }
}
