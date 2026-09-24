import type { APIRoute } from "astro";
import { getTwikooUpstreamUrl } from "../../lib/twikoo";

export const prerender = false;

const MAX_BODY_BYTES = 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

export const POST: APIRoute = async ({ request }) => {
  const upstreamUrl = getTwikooUpstreamUrl();
  if (!upstreamUrl) {
    return Response.json({ message: "Comment service is not configured" }, { status: 503 });
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ message: "Expected JSON" }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ message: "Request too large" }, { status: 413 });
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ message: "Request too large" }, { status: 413 });
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Twikoo proxy] Upstream request failed", error);
    return Response.json({ message: "Comment service unavailable" }, { status: 502 });
  }
};
