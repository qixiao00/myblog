import { createHash } from "node:crypto";
import { getTwikooUpstreamUrl } from "../twikoo";
import { AdminError, type AdminSession } from "./security";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export async function twikoo(event: string, data: Record<string, unknown> = {}, token?: string) {
  const url = getTwikooUpstreamUrl();
  if (!url) throw new AdminError(503, "留言服务尚未配置。");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, event, ...(token ? { accessToken: token } : {}) }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new AdminError(502, "留言服务暂时无法连接，请稍后再试。"); }
  if (!response.ok) throw new AdminError(502, "留言服务暂时不可用。");
  const result = await response.json();
  return result as Record<string, any>;
}

export async function passwordStatus() {
  const result = await twikoo("GET_PASSWORD_STATUS");
  if (typeof result.status !== "boolean") throw new AdminError(502, "留言后端无法返回管理员状态。");
  return result.status;
}

export async function loginPassword(password: string) {
  const token = createHash("md5").update(password).digest("hex");
  const result = await twikoo("LOGIN", { password: token });
  if (result.code !== 0) throw new AdminError(401, "管理员密码不正确。");
  await verifyAdmin({ token, expires: Date.now() + 1000 });
  return token;
}

export async function initializePassword(password: string) {
  if (await passwordStatus()) throw new AdminError(409, "管理员已经初始化，请直接登录。");
  const result = await twikoo("SET_PASSWORD", { password: createHash("md5").update(password).digest("hex") });
  if (result.code !== 0) throw new AdminError(409, "无法设置管理员密码，请刷新后重试。");
  return loginPassword(password);
}

export async function verifyAdmin(session: AdminSession) {
  const result = await twikoo("GET_CONFIG", {}, session.token);
  if (result.config?.IS_ADMIN !== true) throw new AdminError(401, "登录已失效，请重新登录。");
}

export async function listComments(session: AdminSession, page: number, keyword: string, type: string) {
  const result = await twikoo("COMMENT_GET_FOR_ADMIN", { per: 20, page, keyword, type }, session.token);
  if (result.code) throw new AdminError(502, "无法加载留言。");
  return { count: Number(result.count || 0), data: Array.isArray(result.data) ? result.data.map((row: Record<string, unknown>) => ({ ...row, _id: row.id || row._id })) : [] };
}

export async function changeComment(session: AdminSession, id: string, action: "hide" | "restore" | "pin" | "unpin" | "delete") {
  const result = action === "delete"
    ? await twikoo("COMMENT_DELETE_FOR_ADMIN", { id }, session.token)
    : await twikoo("COMMENT_SET_FOR_ADMIN", { id, set: action === "hide" || action === "restore" ? { isSpam: action === "hide" } : { top: action === "pin" } }, session.token);
  if (result.code) throw new AdminError(502, "留言操作失败，请刷新后重试。");
}

export async function replyComment(session: AdminSession, input: { id: string; parentId?: string; url: string; content: string; nick: string; mail: string }, origin: string) {
  const html = sanitizeHtml(await marked.parse(input.content, { breaks: true }), { allowedTags: sanitizeHtml.defaults.allowedTags, allowedAttributes: { a: ["href", "title"] }, allowedSchemes: ["http", "https", "mailto"] });
  const result = await twikoo("COMMENT_SUBMIT", {
    nick: input.nick, mail: input.mail, link: origin, ua: "Paper Trail Admin", url: input.url,
    href: `${origin}${input.url}`, pid: input.parentId || input.id, rid: input.id, comment: html,
  }, session.token);
  if (!result.id) throw new AdminError(502, "回复未发送成功，请检查留言服务的验证码及反垃圾配置后重试。");
}
