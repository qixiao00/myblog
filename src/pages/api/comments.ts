import type { APIRoute } from "astro";
import { z } from "zod";
import { getAvatarByEmail, normalizeEmail } from "../../lib/avatar";
import { getDb } from "../../lib/db";

const CommentQuery = z.object({
  slug: z.string().trim().min(1).max(240),
});

const CommentPayload = z.object({
  slug: z.string().trim().min(1).max(240),
  email: z.email().trim().max(180),
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
      email: string;
      nickname: string;
      content: string;
      createdAt: string;
    }[]>`
      select
        id,
        slug,
        email,
        nickname,
        content,
        created_at as "createdAt"
      from comments
      where slug = ${parsed.data.slug}
        and status = 'approved'
      order by created_at desc
      limit 100
    `;

    const comments = rows.map((row) => {
      const { avatarUrl, avatarFallbackUrl } = getAvatarByEmail(
        row.email,
        `${row.id}-${row.nickname}`,
      );

      return {
        id: row.id,
        slug: row.slug,
        nickname: row.nickname,
        content: row.content,
        createdAt: row.createdAt,
        avatarUrl,
        avatarFallbackUrl,
      };
    });

    return new Response(
      JSON.stringify({
        ok: true,
        comments,
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
    const { slug, email, nickname, content, redirectTo } = parsed.data;
    const normalizedEmail = normalizeEmail(email);

    await sql`
      insert into comments (slug, email, nickname, content, status)
      values (${slug}, ${normalizedEmail}, ${nickname}, ${content}, 'approved')
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
