import { siteViewKey } from "../src/lib/site-views";
import { commentSource } from "../src/lib/admin/comment-source";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { AdminError, encodeSession, decodeSession, requireSameOrigin, readJson, SESSION_COOKIE } from "../src/lib/admin/security";
import { safePostPath, savePost, verifyOwner } from "../src/lib/admin/posts";
import { newPostPath } from "../src/lib/admin/post-path";
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


test("account push permission cannot substitute for token Contents write permission", async () => {
  let probeBody: unknown;
  mockFetch((url, body, method) => {
    if (url.endsWith("/user")) return response({ login: "qixiao00" });
    if (method === "PUT") { probeBody = body; return response({ message: "Resource not accessible by personal access token" }, 403); }
    return response({ permissions: { push: true } });
  });
  await assert.rejects(verifyOwner("read-only-token"), /Contents/);
  assert.deepEqual(probeBody, {});
  const ctx = context("connect", "POST", { token: "read-only-token" }, encodeSession(session));
  const originalCookie = ctx.jar.get(SESSION_COOKIE);
  mockFetch((_url, body, method) => {
    if (body.event === "GET_CONFIG") return response({ config: { IS_ADMIN: true } });
    if (_url.endsWith("/user")) return response({ login: "qixiao00" });
    return method === "PUT" ? response({}, 403) : response({ permissions: { push: true } });
  });
  assert.equal((await POST(ctx as any)).status, 403); assert.equal(ctx.jar.get(SESSION_COOKIE), originalCookie);
});
test("a write-capable token reaches validation without creating a commit", async () => {
  mockFetch((url, body, method) => {
    if (url.endsWith("/user")) return response({ login: "qixiao00" });
    if (method === "PUT") { assert.deepEqual(body, {}); return response({ message: "Invalid request" }, 422); }
    return response({ permissions: { push: true } });
  });
  assert.equal(await verifyOwner("write-token"), "qixiao00");
});
test("new article paths are generated from fixed categories and sanitized titles", async () => {
  assert.equal(newPostPath("友人帐", "猫"), "友人帐/猫.md");
  assert.equal(newPostPath("心情", "../春天/雨?"), "心情/-春天-雨-.md");
  assert.throws(() => newPostPath("随笔", "标题")); assert.throws(() => newPostPath("心情", "..."));
  let writeUrl = "";
  mockFetch((url, _body, method) => { assert.equal(method, "PUT"); writeUrl = decodeURIComponent(url); return response({ content: { sha: "2".repeat(40) }, commit: { html_url: "https://example.test/commit" } }); });
  const saved = await savePost(session, { path: "wrong/place.md", category: "友人帐", title: "猫", date: "2026-10-14", description: "", tags: [], draft: true, content: "正文" });
  assert.equal(saved.path, "友人帐/猫.md"); assert.ok(writeUrl.endsWith("/vault/友人帐/猫.md"));
});

test("session reports a connected read-only token without claiming publishing is ready", async () => {
  mockFetch((_url, body, method) => body.event === "GET_CONFIG" ? response({ config: { IS_ADMIN: true } }) : response({}, method === "PUT" ? 403 : 200));
  const result = await GET(context("session", "GET", undefined, encodeSession(session)) as any);
  assert.equal(result.status, 200); const state = await result.json(); assert.equal(state.connected, true); assert.equal(state.canWrite, false); assert.match(state.writeError, /Contents/);
});

test("comment sources show labels and never turn untrusted URLs into links", () => {
  assert.deepEqual(commentSource("/guestbook/"), { label: "留言板", href: "/guestbook" });
  const url = "/notes/" + encodeURIComponent("心情") + "/" + encodeURIComponent("闹钟是八点十分");
  assert.equal(commentSource(url).label, "闹钟是八点十分");
  assert.equal(commentSource(url, [{ path: "心情/闹钟是八点十分.md", title: "真正的文章标题" }]).label, "真正的文章标题");
  assert.equal(commentSource("javascript:alert(1)").href, "");
  assert.equal(commentSource("/notes/../admin").href, "");
});
test("site counters normalize public URLs and exclude APIs, admin, and unsafe paths", () => {
  assert.equal(siteViewKey("/?utm_source=test"), "@site:/");
  assert.equal(siteViewKey("/guestbook/"), "@site:/guestbook");
  assert.equal(siteViewKey("/notes/%E5%BF%83%E6%83%85/%E9%9B%AA"), "@site:/notes/心情/雪");
  for (const page of ["/admin", "/api/admin/stats", "//evil.example", "/notes/../admin", "/notes/%zz", "/notes/%00"]) assert.throws(() => siteViewKey(page));
});


test("category changes move a file in one commit and retain comments, views, redirects and metadata", async () => {
  const originalSha = "1".repeat(40), headSha = "2".repeat(40), baseTree = "3".repeat(40), newTree = "4".repeat(40), newBlob = "5".repeat(40), nextCommit = "6".repeat(40);
  const operations: string[] = []; let movedData: any, expectedBlob = "";
  mockFetch((url, body, method) => {
    operations.push(method + " " + url);
    if (url.includes("/git/ref/heads/")) return response({ object: { sha: headSha } });
    if (method === "GET" && url.includes("/git/commits/")) return response({ tree: { sha: baseTree } });
    if (method === "GET" && url.includes("/git/trees/")) return response({ truncated: false, tree: [{ path: "vault/心情/猫.md", sha: originalSha, type: "blob" }] });
    if (url.includes("/contents/")) return response({ content: Buffer.from("---\ncustom: keep\n---\nold").toString("base64"), sha: originalSha });
    if (method === "POST" && url.endsWith("/git/trees")) {
      assert.equal(body.base_tree, baseTree); assert.equal(body.tree[0].sha, null); assert.equal(body.tree[0].path, "vault/心情/猫.md"); assert.equal(body.tree[1].path, "vault/友人帐/猫.md");
      movedData = readFrontmatter(body.tree[1].content);
      const bytes = Buffer.from(body.tree[1].content, "utf8"); expectedBlob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      return response({ sha: newTree, tree: [{ path: "vault", type: "tree", sha: newBlob }] });
    }
    if (method === "POST" && url.endsWith("/git/commits")) { assert.deepEqual(body.parents, [headSha]); return response({ sha: nextCommit, html_url: "https://example.test/commit" }); }
    if (method === "PATCH") { assert.equal(body.force, false); assert.equal(body.sha, nextCommit); return response({ object: { sha: nextCommit } }); }
    throw new Error("Unexpected request");
  });
  const result = await savePost(session, { path: "心情/猫.md", sha: originalSha, category: "友人帐", title: "猫", date: "2026-10-14", description: "", tags: [], draft: false, content: "正文" });
  assert.equal(result.path, "友人帐/猫.md"); assert.equal(result.sha, expectedBlob); assert.equal(movedData.data.custom, "keep");
  assert.equal(movedData.data.viewSlug, "心情/猫"); assert.equal(movedData.data.commentPath, "/notes/" + encodeURIComponent("心情") + "/" + encodeURIComponent("猫")); assert.deepEqual(movedData.data.redirectFrom, ["心情/猫"]); assert.equal(movedData.data.sourcePath, "心情/猫.md");
  assert.ok(operations.at(-1)?.startsWith("PATCH")); assert.equal(operations.filter(op => op.startsWith("PUT")).length, 0);
});
test("moving an article refuses collisions and stale revisions without creating a commit", async () => {
  let writes = 0;
  for (const collision of [true, false]) {
    mockFetch((url, _body, method) => {
      if (method !== "GET") { writes++; throw new Error("Must not write"); }
      if (url.includes("/git/ref/")) return response({ object: { sha: "2".repeat(40) } });
      if (url.includes("/git/commits/")) return response({ tree: { sha: "3".repeat(40) } });
      return response({ truncated: false, tree: [{ path: "vault/心情/猫.md", sha: (collision ? "1" : "9").repeat(40) }, ...(collision ? [{ path: "vault/友人帐/猫.md", sha: "7".repeat(40) }] : [])] });
    });
    await assert.rejects(savePost(session, { path: "心情/猫.md", sha: "1".repeat(40), category: "友人帐", title: "猫", date: "2026-10-14", description: "", tags: [], draft: false, content: "正文" }), collision ? /同名/ : /已被更新/);
  }
  assert.equal(writes, 0);
});
