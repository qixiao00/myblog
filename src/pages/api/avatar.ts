import type { APIRoute } from "astro";
import { z } from "zod";
import { getAvatarByEmail } from "../../lib/avatar";

const Query = z.object({
  email: z.email().trim().max(180),
});

export const GET: APIRoute = async ({ url }) => {
  const parsed = Query.safeParse({
    email: url.searchParams.get("email") ?? "",
  });

  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Invalid email",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const avatar = getAvatarByEmail(parsed.data.email, parsed.data.email);
  return new Response(
    JSON.stringify({
      ok: true,
      ...avatar,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
