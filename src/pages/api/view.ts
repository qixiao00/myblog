import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "../../lib/db";

const ViewPayload = z.object({
  slug: z.string().trim().min(1).max(240),
});

export const POST: APIRoute = async ({ request }) => {
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

    const [row] = await sql<{ views: number }[]>`
      insert into post_views (slug, views)
      values (${slug}, 1)
      on conflict (slug)
      do update set
        views = post_views.views + 1,
        updated_at = now()
      returning views::int
    `;

    return new Response(
      JSON.stringify({
        ok: true,
        views: row?.views ?? 1,
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
