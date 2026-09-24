const UPSTREAM_TIMEOUT_MS = 15_000;

export function getTwikooUpstreamUrl() {
  const value =
    process.env.TWIKOO_UPSTREAM_URL ??
    import.meta.env.TWIKOO_UPSTREAM_URL ??
    process.env.PUBLIC_TWIKOO_ENV_ID ??
    import.meta.env.PUBLIC_TWIKOO_ENV_ID;

  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function getTwikooCommentCount(urls: string[]) {
  const upstreamUrl = getTwikooUpstreamUrl();
  if (!upstreamUrl) return null;
  if (urls.length === 0) return 0;

  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "GET_COMMENTS_COUNT", urls, includeReply: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = await response.json() as {
      data?: Array<{ url?: string; count?: number }>;
    };
    const counts = payload.data;
    if (!Array.isArray(counts)) return null;

    return counts.reduce((total, row) => total + (Number.isFinite(row.count) ? row.count! : 0), 0);
  } catch (error) {
    console.error("[Twikoo] Failed to load comment count", error);
    return null;
  }
}
