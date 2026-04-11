import type { APIRoute } from "astro";
import { z } from "zod";
import { getDb } from "../../lib/db";

const CommentQuery = z.object({
  slug: z.string().trim().min(1).max(240),
});

const CommentPayload = z.object({
  slug: z.string().trim().min(1).max(240),
  nickname: z.string().trim().min(1).max(30),
  content: z.string().trim().min(1).max(1000),
  redirectTo: z.string().trim().optional(),
});

export const GET: APIRoute = async ({ url }) => {
  try {
    const parsed = CommentQuery.safeParse({
      slug: url.searchParams.get("slug"),
    });

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Missing slug",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const sql = getDb();
    const rows = await sql<{
      id: number;
      slug: string;
      nickname: string;
      content: string;
      createdAt: string;
    }[]>`
      select
        id,
        slug,
        nickname,
        content,
        created_at as "createdAt"
      from comments
      where slug = ${parsed.data.slug}
        and status = 'approved'
      order by created_at desc
      limit 100
    `;

    return new Response(
      JSON.stringify({
        ok: true,
        comments: rows,
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

export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let input: unknown;

    if (contentType.includes("application/json")) {
      input = await request.json().catch(() => null);
    } else {
      const formData = await request.formData();
      input = Object.fromEntries(formData);
    }

    const parsed = CommentPayload.safeParse(input);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Invalid comment payload",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const sql = getDb();
    const { slug, nickname, content, redirectTo } = parsed.data;

    await sql`
      insert into comments (slug, nickname, content, status)
      values (${slug}, ${nickname}, ${content}, 'approved')
    `;

    if (!contentType.includes("application/json")) {
      const safeRedirect = redirectTo?.startsWith("/") ? redirectTo : `/notes/${slug}`;
      return redirect(`${safeRedirect}#comments`, 303);
    }

    return new Response(
      JSON.stringify({
        ok: true,
      }),
      {
        status: 201,
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
