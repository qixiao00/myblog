import type { APIRoute, APIContext } from "astro";
import { z } from "zod";
import { AdminError, SESSION_COOKIE, checkLoginRate, decodeSession, encodeSession, env, readJson, requireSameOrigin, saveSession } from "../../../lib/admin/security";
import { changeComment, initializePassword, listComments, loginPassword, passwordStatus, replyComment, verifyAdmin } from "../../../lib/admin/comments";
import { PostInput, deletePost, getImage, getPost, githubToken, listPosts, repository, savePost, uploadImage, verifyOwner } from "../../../lib/admin/posts";
import { previewMarkdown } from "../../../lib/admin/preview";

export const prerender = false;
const credentials = z.object({ password: z.string().min(1).max(200), githubToken: z.string().trim().min(1).max(512).optional() });
const commentChange = z.object({ id: z.string().min(1).max(120), action: z.enum(["hide", "restore", "pin", "unpin", "delete"]) });

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

const handler: APIRoute = async (context: APIContext) => {
  const { request, url, cookies, params } = context;
  const action = params.action || "";
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    if (request.method === "GET" && action === "bootstrap") {
      return json({ passwordSet: await passwordStatus(), owner: repository().owner });
    }
    if (request.method === "POST" && action === "logout") {
      cookies.delete(SESSION_COOKIE, { path: "/" });
      return json({ ok: true });
    }
    if (request.method === "POST" && (action === "login" || action === "setup")) {
      checkLoginRate(context.clientAddress || "unknown");
      const input = credentials.parse(await readJson(request, 4096));
      // Check the encryption configuration before changing the provider password.
      const tokenForRepo = env("ADMIN_GITHUB_TOKEN") || input.githubToken;
      if (action === "setup") {
        if (input.password.length < 12) throw new AdminError(400, "首次设置的密码至少需要 12 个字符。");
        if (!tokenForRepo) throw new AdminError(400, "首次初始化需要 GitHub 凭据验证仓库所有者身份。");
        await verifyOwner(tokenForRepo);
      } else if (input.githubToken) {
        await verifyOwner(input.githubToken);
      }
      // This never sets a cookie before the password has been verified.
      encodeSession({ token: "0".repeat(32), expires: Date.now() + 1000 });
      const token = action === "setup" ? await initializePassword(input.password) : await loginPassword(input.password);
      saveSession(cookies, { token, ...(input.githubToken ? { githubToken: input.githubToken } : {}) });
      return json({ ok: true });
    }

    const session = decodeSession(cookies.get(SESSION_COOKIE)?.value);
    if (!session) throw new AdminError(401, "请先登录后台。");
    await verifyAdmin(session);

    if (request.method === "GET") {
      if (action === "session") return json({ authenticated: true, repository: repository().name, connected: Boolean(env("ADMIN_GITHUB_TOKEN") || session.githubToken) });
      if (action === "posts") return json(url.searchParams.has("path") ? await getPost(session, url.searchParams.get("path")!) : { posts: await listPosts(session) });
      if (action === "comments") {
        const page = Math.max(1, Math.min(500, Math.floor(Number(url.searchParams.get("page"))) || 1));
        const type = url.searchParams.get("type") || "";
        if (!["", "all", "visible", "hidden"].includes(type)) throw new AdminError(400, "留言筛选不正确。");
        // Twikoo uses visible/hidden to filter moderation state.
        return json(await listComments(session, page, (url.searchParams.get("keyword") || "").slice(0, 200), type === "all" ? "" : type.toUpperCase()));
      }
      if (action === "image") {
        const image = await getImage(session, (url.searchParams.get("path") || "").slice(0, 300));
        return new Response(new Uint8Array(image.bytes), { headers: { "Content-Type": image.mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (action === "export-comments") {
        const all: unknown[] = [];
        for (let page = 1; page <= 500; page++) {
          const result = await listComments(session, page, "", "");
          all.push(...result.data);
          if (!result.data.length || all.length >= result.count) break;
          if (page === 500) throw new AdminError(413, "留言数量超过单次导出上限。");
        }
        return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), results: all }, null, 2), {
          headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="comments-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
        });
      }
    }
    if (request.method === "POST") {
      if (action === "connect") {
        const input = z.object({ token: z.string().trim().min(1).max(512) }).parse(await readJson(request, 2048));
        await verifyOwner(input.token);
        saveSession(cookies, { token: session.token, githubToken: input.token });
        return json({ ok: true });
      }
      if (action === "posts") return json(await savePost(session, PostInput.parse(await readJson(request))));
      if (action === "comments") {
        const input = commentChange.parse(await readJson(request, 4096));
        await changeComment(session, input.id, input.action);
        return json({ ok: true });
      }
      if (action === "reply") {
        const input = z.object({
          id: z.string().min(1).max(120), parentId: z.string().max(120).optional(),
          url: z.string().max(300).refine((value) => value === "/guestbook" || value.startsWith("/notes/")),
          content: z.string().trim().min(1).max(5000), nick: z.string().trim().min(1).max(50), mail: z.email().max(254),
        }).parse(await readJson(request, 25_000));
        await replyComment(session, input, url.origin);
        return json({ ok: true });
      }
      if (action === "preview") {
        const input = z.object({ content: z.string().max(700_000), path: z.string().max(220) }).parse(await readJson(request));
        return json({ html: await previewMarkdown(input.content, input.path) });
      }
      if (action === "upload") {
        githubToken(session);
        const limit = 4 * 1024 * 1024;
        if (Number(request.headers.get("content-length")) > limit + 16_384) throw new AdminError(413, "图片最大支持 4 MB。");
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > limit) throw new AdminError(400, "请选择不超过 4 MB 的图片。");
        const bytes = Buffer.from(await file.arrayBuffer());
        let extension = "";
        if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = "png";
        else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) extension = "jpg";
        else if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) extension = "gif";
        else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") extension = "webp";
        if (!extension) throw new AdminError(400, "仅支持 PNG、JPEG、GIF 和 WebP 图片。");
        return json(await uploadImage(session, bytes, extension));
      }
    }
    if (request.method === "DELETE" && action === "posts") {
      const input = z.object({ path: z.string().max(220), sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(await readJson(request, 4096));
      await deletePost(session, input.path, input.sha);
      return json({ ok: true });
    }
    return json({ message: "后台接口不存在。" }, 404);
  } catch (error) {
    if (error instanceof AdminError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message || "填写内容不正确。" }, 400);
    // Never include upstream bodies, credentials or session content in responses/logs.
    console.error("[Admin] Request failed", error instanceof Error ? error.name : "UnknownError");
    return json({ message: "操作暂时失败，请稍后重试。" }, 500);
  }
};

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
