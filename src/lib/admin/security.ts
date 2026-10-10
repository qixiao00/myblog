import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AstroCookies } from "astro";

export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function env(name: string) {
  return process.env[name] ?? import.meta.env?.[name];
}

export const SESSION_COOKIE = "paper_trail_admin";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
export type AdminSession = { token: string; githubToken?: string; expires: number };

function key() {
  const secret = env("ADMIN_SESSION_SECRET") || env("POSTGRES_URL");
  if (!secret || secret.length < 32) throw new AdminError(503, "后台登录密钥尚未配置。");
  return createHash("sha256").update(`paper-trail/admin/session/v1:${secret}`).digest();
}

export function encodeSession(session: AdminSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decodeSession(value?: string): AdminSession | null {
  if (!value || value.length > 3800) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
    if (!/^[a-f0-9]{32}$/.test(session.token) || !Number.isFinite(session.expires) || session.expires <= Date.now()) return null;
    if (session.githubToken !== undefined && (typeof session.githubToken !== "string" || session.githubToken.length > 512)) return null;
    return session;
  } catch { return null; }
}

export function saveSession(cookies: AstroCookies, session: Omit<AdminSession, "expires">) {
  const full = { ...session, expires: Date.now() + SESSION_SECONDS * 1000 };
  cookies.set(SESSION_COOKIE, encodeSession(full), {
    httpOnly: true, secure: import.meta.env?.PROD ?? process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_SECONDS,
  });
  return full;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AdminError(403, "请从本站后台提交操作。");
}

export function verifyCredentials(username: string, password: string) {
  const [salt, digest] = (env("ADMIN_PASSWORD_HASH") || "").split(":");
  if (!/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(digest || "")) throw new AdminError(503, "后台账号尚未配置。");
  const validPassword = timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, "hex"));
  if (username !== (env("ADMIN_USERNAME") || "admin") || !validPassword) throw new AdminError(401, "账号或密码不正确。");
}

// A bounded guard in each server worker.
const loginAttempts = new Map<string, { count: number; reset: number }>();
export function checkLoginRate(address: string) {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) if (entry.reset <= now) loginAttempts.delete(ip);
  if (loginAttempts.size >= 5000 && !loginAttempts.has(address)) throw new AdminError(429, "登录请求过多，请稍后再试。");
  const entry = loginAttempts.get(address) ?? { count: 0, reset: now + 15 * 60_000 };
  entry.count++;
  loginAttempts.set(address, entry);
  if (entry.count > 10) throw new AdminError(429, "登录尝试过多，请 15 分钟后再试。");
}

export async function readJson(request: Request, maxBytes = 1024 * 1024) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AdminError(415, "需要 JSON 请求。");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new AdminError(413, "内容过大。");
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AdminError(413, "内容过大。");
  try { return JSON.parse(text); } catch { throw new AdminError(400, "请求格式不正确。"); }
}
