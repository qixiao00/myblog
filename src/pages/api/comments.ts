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
  parentId: z.coerce.number().int().positive().optional(),
  redirectTo: z.string().trim().optional(),
});

function getRegionFromHeaders(headers: Headers) {
  const city = headers.get("x-vercel-ip-city")?.trim() ?? "";
  const region = headers.get("x-vercel-ip-country-region")?.trim() ?? "";
  const country = headers.get("x-vercel-ip-country")?.trim() ?? "";
  const parts = [country, region, city].filter(Boolean);
  return parts.length ? parts.join(" / ") : "未知地区";
}

function parseClientInfo(userAgent: string) {
  const ua = userAgent.toLowerCase();

  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome/")
      ? "Chrome"
      : ua.includes("firefox/")
        ? "Firefox"
        : ua.includes("safari/") && !ua.includes("chrome/")
          ? "Safari"
          : ua.includes("micromessenger/")
            ? "WeChat"
            : "Unknown Browser";

  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("android")
      ? "Android"
      : ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")
        ? "iOS"
        : ua.includes("mac os") || ua.includes("macintosh")
          ? "macOS"
          : ua.includes("linux")
            ? "Linux"
            : "Unknown OS";

  return `${browser} · ${os}`;
}

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
      parentId: number | null;
      slug: string;
      email: string;
      nickname: string;
      content: string;
      likes: number;
      ipRegion: string;
      clientInfo: string;
      createdAt: string;
    }[]>`
      select
        id,
        parent_id as "parentId",
        slug,
        email,
        nickname,
        content,
        likes,
        ip_region as "ipRegion",
        client_info as "clientInfo",
        created_at as "createdAt"
      from comments
      where slug = ${parsed.data.slug}
        and status = 'approved'
      order by created_at asc
      limit 100
    `;

    const comments = rows.map((row) => {
      const { avatarUrl, avatarFallbackUrl } = getAvatarByEmail(
        row.email,
        `${row.id}-${row.nickname}`,
      );

      return {
        id: row.id,
        parentId: row.parentId,
        slug: row.slug,
        nickname: row.nickname,
        content: row.content,
        likes: row.likes,
        ipRegion: row.ipRegion,
        clientInfo: row.clientInfo,
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
    const { slug, email, nickname, content, parentId, redirectTo } = parsed.data;
    const normalizedEmail = normalizeEmail(email);
    const ipRegion = getRegionFromHeaders(request.headers);
    const clientInfo = parseClientInfo(request.headers.get("user-agent") ?? "");

    await sql`
      insert into comments (slug, parent_id, email, nickname, content, likes, ip_region, client_info, status)
      values (${slug}, ${parentId ?? null}, ${normalizedEmail}, ${nickname}, ${content}, 0, ${ipRegion}, ${clientInfo}, 'approved')
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
