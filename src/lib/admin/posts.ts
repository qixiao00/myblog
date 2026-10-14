import { readFrontmatter, writeFrontmatter } from "./frontmatter";
import { newPostPath, POST_CATEGORIES } from "./post-path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AdminError, env, type AdminSession } from "./security";

export function repository() {
  const name = env("ADMIN_GITHUB_REPO") || "qixiao00/myblog";
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new AdminError(503, "仓库配置不正确。");
  return { name, owner: name.split("/")[0], branch: env("ADMIN_GITHUB_BRANCH") || "master" };
}

export function githubToken(session: AdminSession) {
  const token = session.githubToken || env("ADMIN_GITHUB_TOKEN");
  if (!token) throw new AdminError(412, "请先在后台设置中连接博客仓库。");
  return token;
}

async function githubRequest(path: string, token: string, method = "GET", data?: unknown) {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new AdminError(502, "暂时无法连接文章仓库，请稍后重试。"); }
  return response;
}

async function github<T>(path: string, token: string, method = "GET", data?: unknown): Promise<T> {
  const response = await githubRequest(path, token, method, data);
  if (response.status === 409 || response.status === 422) throw new AdminError(409, "文章已被其他操作更新。请重新加载最新内容后保存。");
  if (response.status === 401) throw new AdminError(403, "GitHub 令牌已失效，请在后台设置中重新连接。");
  if (response.status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") throw new AdminError(429, "GitHub 请求额度暂时用完，请稍后再试。");
    throw new AdminError(403, method === "GET" ? "GitHub 令牌无法读取仓库，请检查授权的仓库。" : "令牌缺少 Contents 写入权限。请在 GitHub 将 myblog 的 Contents 改为 Read and write，保存后重试。");
  }
  if (response.status === 404) throw new AdminError(404, "文章或仓库不存在，请检查仓库权限。");
  if (!response.ok) throw new AdminError(502, "文章仓库操作失败，请稍后再试。");
  return await response.json() as T;
}

export async function verifyWriteAccess(token: string) {
  // Empty JSON has neither message nor content, so GitHub cannot create a commit.
  // Its permission check runs first: a write-capable token reaches validation (422).
  const response = await githubRequest(`/repos/${repository().name}/contents/vault/.admin-permission-check.md`, token, "PUT", {});
  if (response.status === 422) return;
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new AdminError(429, "GitHub 请求额度暂时用完，请稍后再试。");
  if (response.status === 401) throw new AdminError(403, "GitHub 令牌已失效，请重新连接。");
  if (response.status === 403 || response.status === 404) throw new AdminError(403, "令牌缺少 Contents 写入权限。请在 GitHub 将 myblog 的 Contents 改为 Read and write，保存后重试。");
  throw new AdminError(502, "无法确认仓库写入权限，请稍后重试。");
}

export async function verifyOwner(token: string) {
  const repo = repository();
  const user = await github<{ login: string }>("/user", token);
  if (user.login.toLowerCase() !== repo.owner.toLowerCase()) throw new AdminError(403, "只能使用博客仓库所有者的 GitHub 凭据。");
  const details = await github<{ permissions?: { push?: boolean } }>(`/repos/${repo.name}`, token);
  if (!details.permissions?.push) throw new AdminError(403, "此凭据没有博客仓库的编辑权限。");
  await verifyWriteAccess(token);
  return user.login;
}

export function safePostPath(path: string) {
  const relative = path.normalize("NFC");
  if (!relative.endsWith(".md") || relative.length > 220 || relative.startsWith("/") || relative.includes("\\") || /[\x00-\x1f?#]/.test(relative)) throw new AdminError(400, "文章路径不正确。");
  if (relative.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) throw new AdminError(400, "文章路径不正确。");
  if (relative.startsWith("assets/")) throw new AdminError(400, "文章不能放在附件目录。");
  return `vault/${relative}`;
}

function contentUrl(path: string) {
  return `/repos/${repository().name}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function formatDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export function parsePost(path: string, text: string, sha: string) {
  const parsed = readFrontmatter(text);
  const date = formatDate(parsed.data.date);
  return {
    path, sha, sourcePath: typeof parsed.data.sourcePath === "string" ? parsed.data.sourcePath : undefined, viewSlug: typeof parsed.data.viewSlug === "string" ? parsed.data.viewSlug : undefined, title: String(parsed.data.title || path.replace(/\.md$/, "").split("/").pop()),
    date, updated: formatDate(parsed.data.updated), description: String(parsed.data.description || ""),
    tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : typeof parsed.data.tags === "string" ? parsed.data.tags.split(/[,，]/).map((tag: string) => tag.trim()).filter(Boolean) : [],
    draft: parsed.data.draft === true || parsed.data.draft === 1 || ["true", "1", "yes", "y"].includes(String(parsed.data.draft).toLowerCase()), content: parsed.content.trimStart(),
  };
}

type GithubFile = { content: string; sha: string; encoding: string; type: string; size?: number };
export async function getPost(session: AdminSession, path: string) {
  const result = await github<GithubFile>(`${contentUrl(safePostPath(path))}?ref=${encodeURIComponent(repository().branch)}`, githubToken(session));
  if (result.type !== "file" || result.encoding !== "base64") throw new AdminError(413, "这篇文章过大，无法在后台编辑。");
  return { ...parsePost(path, Buffer.from(result.content, "base64").toString("utf8"), result.sha) };
}

export async function listPosts(session: AdminSession) {
  const repo = repository();
  const tree = await github<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> }>(`/repos/${repo.name}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`, githubToken(session));
  if (tree.truncated) throw new AdminError(502, "仓库文件列表过大，无法完整加载。");
  const paths = tree.tree.filter((row) => row.type === "blob" && row.path.startsWith("vault/") && row.path.endsWith(".md")).map((row) => row.path.slice(6));
  const posts: Array<Omit<ReturnType<typeof parsePost>, "content">> = [];
  for (let i = 0; i < paths.length; i += 5) {
    posts.push(...await Promise.all(paths.slice(i, i + 5).map(async (path) => {
      const { content: _content, ...post } = await getPost(session, path);
      return post;
    })));
  }
  return posts.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title, "zh-CN"));
}

export const PostInput = z.object({
  path: z.string().max(220).default(""), category: z.enum(POST_CATEGORIES).optional(), sha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  title: z.string().trim().min(1, "请填写标题。").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "请填写有效日期。"), description: z.string().max(240),
  tags: z.array(z.string().trim().min(1).max(60)).max(30), draft: z.boolean(), content: z.string().max(700_000),
});

async function movePost(session: AdminSession, input: z.infer<typeof PostInput>, destination: string) {
  const token = githubToken(session), repo = repository();
  const oldPath = safePostPath(input.path), nextPath = safePostPath(destination);
  const head = await github<{ object: { sha: string } }>(`/repos/${repo.name}/git/ref/heads/${encodeURIComponent(repo.branch)}`, token);
  const commit = await github<{ tree: { sha: string } }>(`/repos/${repo.name}/git/commits/${head.object.sha}`, token);
  const tree = await github<{ truncated: boolean; tree: Array<{ path: string; sha: string; type: string }> }>(`/repos/${repo.name}/git/trees/${commit.tree.sha}?recursive=1`, token);
  if (tree.truncated) throw new AdminError(502, "仓库列表过大，无法安全移动文章。");
  if (tree.tree.find(file => file.path === oldPath)?.sha !== input.sha) throw new AdminError(409, "文章已被更新，请重新加载后保存。");
  if (tree.tree.some(file => file.path === nextPath)) throw new AdminError(409, "所选分类已有同名文章，请先处理同名文章或选择其他分类。");
  const current = await github<GithubFile>(`${contentUrl(oldPath)}?ref=${head.object.sha}`, token);
  const oldData = readFrontmatter(Buffer.from(current.content, "base64").toString("utf8")).data;
  const oldSlug = input.path.replace(/\.md$/i, "");
  const text = writeFrontmatter(input.content, { ...oldData, title: input.title, date: input.date, updated: new Date().toISOString().slice(0, 10), description: input.description, tags: input.tags, draft: input.draft,
    redirectFrom: [...new Set([...(Array.isArray(oldData.redirectFrom) ? oldData.redirectFrom : []), oldSlug])].filter(slug => slug !== destination.replace(/\.md$/i, "")),
    viewSlug: oldData.viewSlug || oldSlug, commentPath: oldData.commentPath || `/notes/${oldSlug.split("/").map(encodeURIComponent).join("/")}`, sourcePath: oldData.sourcePath || input.path,
  });
  // One tree/commit moves the article atomically; a concurrent branch update rejects the final ref update.
  const nextTree = await github<{ sha: string; tree: Array<{ path: string; sha: string }> }>(`/repos/${repo.name}/git/trees`, token, "POST", { base_tree: commit.tree.sha, tree: [
    { path: oldPath, mode: "100644", type: "blob", sha: null }, { path: nextPath, mode: "100644", type: "blob", content: text },
  ] });
  const nextCommit = await github<{ sha: string; html_url: string }>(`/repos/${repo.name}/git/commits`, token, "POST", { message: `move: ${input.title} → ${input.category}`, tree: nextTree.sha, parents: [head.object.sha] });
  await github(`/repos/${repo.name}/git/refs/heads/${encodeURIComponent(repo.branch)}`, token, "PATCH", { sha: nextCommit.sha, force: false });
  const blob = nextTree.tree.find(file => file.path === nextPath);
  if (!blob) throw new AdminError(502, "文章已移动，请刷新文章列表。");
  return { path: destination, sha: blob.sha, commitUrl: nextCommit.html_url };
}

export async function savePost(session: AdminSession, input: z.infer<typeof PostInput>) {
  if (input.sha && input.category && input.category !== input.path.split("/")[0]) {
    const destination = `${input.category}/${input.path.split("/").pop()}`;
    return movePost(session, input, destination);
  }
  const token = githubToken(session);
  let relativePath = input.path;
  if (!input.sha) {
    try { relativePath = newPostPath(input.category || input.path.split("/")[0], input.title); }
    catch (error) { throw new AdminError(400, error instanceof Error ? error.message : "文章分类不正确。"); }
  }
  const path = safePostPath(relativePath);
  let oldData: Record<string, unknown> = {};
  if (input.sha) {
    const current = await github<GithubFile>(`${contentUrl(path)}?ref=${encodeURIComponent(repository().branch)}`, token);
    if (current.sha !== input.sha) throw new AdminError(409, "文章已被更新，请重新加载后保存。");
    oldData = readFrontmatter(Buffer.from(current.content, "base64").toString("utf8")).data;
  }
  const text = writeFrontmatter(input.content, {
    ...oldData, title: input.title, date: input.date, updated: new Date().toISOString().slice(0, 10),
    description: input.description, tags: input.tags, draft: input.draft,
  });
  const result = await github<{ content: { sha: string }; commit: { html_url: string } }>(contentUrl(path), token, "PUT", {
    message: `${input.draft ? "draft" : "publish"}: ${input.title}`, branch: repository().branch,
    content: Buffer.from(text, "utf8").toString("base64"), ...(input.sha ? { sha: input.sha } : {}),
  });
  return { path: relativePath, sha: result.content.sha, commitUrl: result.commit.html_url };
}

export async function deletePost(session: AdminSession, path: string, sha: string) {
  return github(contentUrl(safePostPath(path)), githubToken(session), "DELETE", { message: `delete: ${path}`, sha, branch: repository().branch });
}

export async function uploadImage(session: AdminSession, bytes: Buffer, extension: string) {
  const path = `assets/uploads/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${extension}`;
  await github(contentUrl(`vault/${path}`), githubToken(session), "PUT", {
    message: "media: upload image", branch: repository().branch, content: bytes.toString("base64"),
  });
  return { url: `/_vault/${path}` };
}

export async function getImage(session: AdminSession, path: string) {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === ".." || part === ".")) throw new AdminError(400, "图片路径不正确。");
  const extension = path.split(".").pop()?.toLowerCase();
  const formats: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  const mime = formats[extension || ""];
  if (!mime) throw new AdminError(400, "仅支持常用图片格式。");
  let file: GithubFile;
  const token = githubToken(session);
  try {
    file = await github<GithubFile>(`${contentUrl(`vault/${path}`)}?ref=${encodeURIComponent(repository().branch)}`, token);
  } catch (error) {
    if (!(error instanceof AdminError) || error.status !== 404) throw error;
    // Obsidian embeds often use only the attachment filename.
    const repo = repository();
    const tree = await github<{ truncated: boolean; tree: Array<{ path: string; type: string }> }>(`/repos/${repo.name}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`, token);
    const filename = path.split("/").pop();
    const matches = tree.tree.filter(row => row.type === "blob" && row.path.startsWith("vault/") && row.path.split("/").pop() === filename);
    if (tree.truncated || matches.length !== 1) throw new AdminError(404, "图片不存在或文件名不唯一，请使用完整附件路径。");
    file = await github<GithubFile>(`${contentUrl(matches[0].path)}?ref=${encodeURIComponent(repo.branch)}`, token);
  }
  if (file.type !== "file") throw new AdminError(404, "图片不存在。");
  if ((file.size || 0) > 8 * 1024 * 1024) throw new AdminError(413, "图片过大，请在发布后查看。");
  const blob = file.encoding === "base64" ? file : await github<{ content: string; encoding: string }>(`/repos/${repository().name}/git/blobs/${file.sha}`, githubToken(session));
  if (blob.encoding !== "base64") throw new AdminError(413, "图片过大，请在发布后查看。");
  return { bytes: Buffer.from(blob.content, "base64"), mime };
}
