import test from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { AdminError, encodeSession, decodeSession, requireSameOrigin, readJson, SESSION_COOKIE } from "../src/lib/admin/security";
import { safePostPath, savePost } from "../src/lib/admin/posts";
import { readFrontmatter } from "../src/lib/admin/frontmatter";
import { previewMarkdown } from "../src/lib/admin/preview";
import { loginPassword, listComments, changeComment, replyComment } from "../src/lib/admin/comments";
import { GET, POST } from "../src/pages/api/admin/[...action]";

process.env.ADMIN_SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
process.env.TWIKOO_UPSTREAM_URL = "https://comments.example.test";
delete process.env.ADMIN_GITHUB_TOKEN;
const session = { token: "a".repeat(32), githubToken: "test-only-github-token", expires: Date.now() + 60_000 };
const realFetch = globalThis.fetch;
const response = (data: unknown, status = 200) => Response.json(data, { status });
function mockFetch(fn: (url: string, body: any, method: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (url: any, init?: RequestInit) => fn(String(url), init?.body ? JSON.parse(String(init.body)) : {}, init?.method || "GET")) as typeof fetch;
}
test.afterEach(() => { globalThis.fetch = realFetch; });
function context(action: string, method = "GET", data?: unknown, cookie?: string) {
  const url = new URL(`https://blog.example.test/api/admin/${action}`);
  const jar = new Map<string, string>(); if (cookie) jar.set(SESSION_COOKIE, cookie);
  const request = new Request(url, { method, headers: { origin: url.origin, "content-type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const options: any[] = [];
  return { request, url, params: { action }, clientAddress: "127.0.0.1", cookies: { get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: (name: string, value: string, option: unknown) => { jar.set(name, value); options.push(option); }, delete: (name: string) => jar.delete(name) }, jar, options };
}

test("session is confidential, authenticated, expiring and revoked by key rotation", () => {
  const cookie = encodeSession(session); assert.ok(!cookie.includes(session.githubToken)); assert.deepEqual(decodeSession(cookie), session);
  const bytes = Buffer.from(cookie, "base64url"); bytes[30] ^= 1; assert.equal(decodeSession(bytes.toString("base64url")), null);
  assert.equal(decodeSession(encodeSession({ ...session, expires: Date.now() - 1 })), null);
  const secret = process.env.ADMIN_SESSION_SECRET; process.env.ADMIN_SESSION_SECRET = "rotated-test-key-at-least-32-characters"; assert.equal(decodeSession(cookie), null); process.env.ADMIN_SESSION_SECRET = secret;
});
test("mutations reject foreign and missing Origin; JSON has a byte limit", async () => {
  assert.throws(() => requireSameOrigin(new Request("https://blog.example.test/api/admin/posts", { headers: { origin: "https://evil.example" } })), AdminError);
  assert.throws(() => requireSameOrigin(new Request("https://blog.example.test/api/admin/posts")), AdminError);
  requireSameOrigin(new Request("https://blog.example.test/api/admin/posts", { headers: { origin: "https://blog.example.test" } }));
  await assert.rejects(readJson(new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify("超出长度") }), 5), /内容过大/);
});
test("article writes stay inside the Markdown vault", () => {
  assert.equal(safePostPath("摄影/春天.md"), "vault/摄影/春天.md");
  for (const path of ["../README.md", "a/../../secret.md", "/a.md", "a\\b.md", ".env.md", "assets/pic.md", "foo.md?ref=main"]) assert.throws(() => safePostPath(path), AdminError);
});
test("preview strips executable markup, escapes and uses authenticated images", async () => {
  const html = await previewMarkdown('<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n![[assets/相片.jpg]]\n\n![](bad%path.jpg)', "随笔/test.md");
  assert.ok(!html.includes("<script")); assert.ok(!html.includes("onerror")); assert.ok(!/href="javascript:/i.test(html)); assert.ok(html.includes("/api/admin/image?path=")); assert.ok(html.includes("target=\"_blank\""));
});
test("save refuses stale SHA without writing; preserves extra metadata", async () => {
  const oldSha = "1".repeat(40), newSha = "2".repeat(40); let writes = 0, stored = "";
  const article = { path: "随笔/test.md", sha: oldSha, title: "新标题", date: "2026-10-10", description: "", tags: ["摄影"], draft: true, content: "# 正文" };
  mockFetch((_url, body, method) => { if (method === "GET") return response({ sha: newSha }); writes++; return response(body); });
  await assert.rejects(savePost(session, article), /已被更新/); assert.equal(writes, 0);
  mockFetch((_url, body, method) => { if (method === "GET") return response({ sha: oldSha, content: Buffer.from("---\ntitle: old\ncustom: keep-me\n---\nold").toString("base64") }); writes++; stored = Buffer.from(body.content, "base64").toString(); return response({ content: { sha: newSha }, commit: { html_url: "https://github.com/test/commit" } }); });
  const saved = await savePost(session, article); assert.equal(saved.sha, newSha); assert.equal(writes, 1); const parsed = readFrontmatter(stored); assert.equal(parsed.data.custom, "keep-me"); assert.equal(parsed.data.draft, true); assert.ok(parsed.content.includes("# 正文"));
});
test("public setup cannot change the provider password", async () => {
  let requested = false; mockFetch(() => { requested = true; throw new Error("Unexpected request"); });
  const result = await POST(context("setup", "POST", { password: "test-password", githubToken: "test" }) as any);
  assert.equal(result.status, 404); assert.equal(requested, false);
});
test("wrong account or password cannot reach Twikoo", async () => {
  const salt = "1".repeat(32); process.env.ADMIN_PASSWORD_HASH = `${salt}:${scryptSync("test-password", salt, 64).toString("hex")}`;
  let requested = false; mockFetch(() => { requested = true; throw new Error("Unexpected request"); });
  for (const data of [{ username: "wrong", password: "test-password" }, { username: "admin", password: "wrong" }]) {
    const ctx = context("login", "POST", data); assert.equal((await POST(ctx as any)).status, 401); assert.equal(ctx.jar.size, 0);
  }
  assert.equal(requested, false);
});
test("account login initializes Twikoo only after verification and creates an HttpOnly session", async () => {
  const salt = "1".repeat(32); process.env.ADMIN_PASSWORD_HASH = `${salt}:${scryptSync("test-password", salt, 64).toString("hex")}`;
  let changed = false;
  mockFetch((_url, body) => { if (body.event === "GET_PASSWORD_STATUS") return response({ status: false }); if (body.event === "SET_PASSWORD") { changed = true; return response({ code: 0 }); } if (body.event === "LOGIN") return response({ code: 0 }); if (body.event === "GET_CONFIG") return response({ config: { IS_ADMIN: true } }); throw new Error("Unexpected request"); });
  const ctx = context("login", "POST", { username: "admin", password: "test-password" }); const result = await POST(ctx as any);
  assert.equal(result.status, 200); assert.ok(changed); assert.equal(ctx.options[0].httpOnly, true); assert.equal(ctx.options[0].sameSite, "strict"); assert.ok(decodeSession(ctx.jar.get(SESSION_COOKIE)));
});
test("protected APIs reject anonymous, expired and revoked identities", async () => {
  for (const cookie of [undefined, encodeSession({ ...session, expires: Date.now() - 1 })]) { const result = await GET(context("posts", "GET", undefined, cookie) as any); assert.equal(result.status, 401); }
  mockFetch(() => response({ config: { IS_ADMIN: false } })); const revoked = await GET(context("posts", "GET", undefined, encodeSession(session)) as any); assert.equal(revoked.status, 401);
});
test("Twikoo password and comment operations follow the existing provider protocol", async () => {
  const requests: any[] = [];
  mockFetch((_url, body) => { requests.push(body); if (body.event === "LOGIN") return response({ code: 0 }); if (body.event === "GET_CONFIG") return response({ config: { IS_ADMIN: true } }); if (body.event === "COMMENT_GET_FOR_ADMIN") return response({ count: 1, data: [{ _id: "comment-1", comment: "hello" }] }); if (body.event === "COMMENT_SUBMIT") return response({ id: "new-reply" }); return response({ code: 0 }); });
  const token = await loginPassword("test-password"); assert.equal(token, createHash("md5").update("test-password").digest("hex"));
  const list = await listComments(session, 2, "hello", "HIDDEN"); assert.equal(list.data[0]._id, "comment-1"); assert.equal(requests.find(r => r.event === "COMMENT_GET_FOR_ADMIN").type, "HIDDEN");
  await changeComment(session, "comment-1", "hide"); assert.deepEqual(requests.at(-1).set, { isSpam: true });
  await replyComment(session, { id: "reply-1", parentId: "root-1", url: "/guestbook", content: "**感谢**<script>bad()</script>", nick: "博主", mail: "author@example.test" }, "https://blog.example.test");
  assert.equal(requests.at(-1).pid, "root-1"); assert.equal(requests.at(-1).rid, "reply-1"); assert.ok(!requests.at(-1).comment.includes("<script"));
});

test("image upload validates bytes and commits to the attachment directory", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  let uploaded = "";
  mockFetch((url, body) => { if (body.event === "GET_CONFIG") return response({ config: { IS_ADMIN: true } }); assert.match(url, /\/contents\/vault\/assets\/uploads\//); uploaded = body.content; return response({ content: { sha: "3".repeat(40) } }); });
  const ctx = context("upload", "POST", undefined, encodeSession(session));
  const form = new FormData(); form.set("file", new File([Buffer.from(png, "base64")], "photo.png", { type: "image/png" }));
  ctx.request = new Request(ctx.url, { method: "POST", headers: { origin: ctx.url.origin }, body: form });
  const result = await POST(ctx as any); assert.equal(result.status, 200); assert.equal(uploaded, png); assert.match((await result.json()).url, /^\/_vault\/assets\/uploads\/.*\.png$/);
  const invalid = new FormData(); invalid.set("file", new File(["<script>bad()</script>"], "fake.png", { type: "image/png" }));
  ctx.request = new Request(ctx.url, { method: "POST", headers: { origin: ctx.url.origin }, body: invalid });
  const rejected = await POST(ctx as any); assert.equal(rejected.status, 400);
});
