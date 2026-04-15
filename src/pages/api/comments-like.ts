import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "../../lib/db";

const Payload = z.object({
  commentId: z.coerce.number().int().positive(),
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json().catch(() => null);
    const parsed = Payload.safeParse(payload);

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
    const [row] = await sql<{ likes: number }[]>`
      update comments
      set likes = likes + 1
      where id = ${parsed.data.commentId}
      returning likes::int
    `;

    if (!row) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Comment not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        likes: row.likes,
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
