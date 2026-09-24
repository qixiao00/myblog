import type { APIRoute } from "astro";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../../lib/db";

const ViewPayload = z.object({
  slug: z.string().trim().min(1).max(240),
});

const VISITOR_COOKIE = "paper_trail_visitor";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const payload = await request.json().catch(() => null);
    const parsed = ViewPayload.safeParse(payload);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Invalid payload",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const sql = getDb();
    const { slug } = parsed.data;
    const storedVisitorId = cookies.get(VISITOR_COOKIE)?.value;
    const visitorId = storedVisitorId && UUID_PATTERN.test(storedVisitorId)
      ? storedVisitorId
      : randomUUID();
    const visitorHash = createHash("sha256").update(visitorId).digest("hex");
    const viewedOn = new Date().toISOString().slice(0, 10);

    const [row] = await sql<{ views: number }[]>`
      with counted as (
        insert into post_view_visitors (slug, visitor_hash, viewed_on)
        values (${slug}, ${visitorHash}, ${viewedOn}::date)
        on conflict (slug, visitor_hash)
        do update set viewed_on = excluded.viewed_on
        where post_view_visitors.viewed_on < excluded.viewed_on
        returning slug
      ), updated as (
        insert into post_views (slug, views)
        select slug, 1 from counted where true
        on conflict (slug)
        do update set
          views = post_views.views + 1,
          updated_at = now()
        returning views
      )
      select coalesce(
        (select views from updated),
        (select views from post_views where slug = ${slug}),
        0
      )::int as views
    `;

    if (!storedVisitorId || storedVisitorId !== visitorId) {
      cookies.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        sameSite: "lax",
        secure: import.meta.env.PROD,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        views: row?.views ?? 0,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Database not ready",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
