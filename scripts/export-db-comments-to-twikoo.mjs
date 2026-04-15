import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";

const outputPath = process.argv[2] || "./twikoo-import-from-db.json";

const readEnvFile = async (path) => {
  try {
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/);
    const env = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      env[key] = value;
    }

    return env;
  } catch {
    return {};
  }
};

const fileEnv = {
  ...(await readEnvFile(".env.local")),
  ...(await readEnvFile(".env")),
};

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  fileEnv.DATABASE_URL ||
  fileEnv.POSTGRES_URL;

if (!databaseUrl) {
  console.error("Missing DATABASE_URL or POSTGRES_URL.");
  process.exit(1);
}

const sql = postgres(databaseUrl);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toCommentHtml = (content) => {
  const escaped = escapeHtml(content).replace(/\r?\n/g, "<br />");
  return `<p>${escaped}</p>`;
};

const toMailMd5 = (mail) => {
  const normalized = String(mail ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return createHash("md5").update(normalized).digest("hex");
};

const toTimestamp = (value) => {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
};

const toUrl = (slug) => (slug === "__guestbook__" ? "/guestbook" : `/notes/${slug}`);

const rows = await sql`
  select
    id,
    parent_id as "parentId",
    slug,
    email,
    nickname,
    content,
    likes,
    created_at as "createdAt",
    created_at as "updatedAt"
  from comments
  where status = 'approved'
  order by created_at asc, id asc
`;

const idToTwikooId = new Map(rows.map((row) => [row.id, `legacy-${row.id}`]));
const idToParentId = new Map(rows.map((row) => [row.id, row.parentId]));

const rootCache = new Map();
const findRootId = (id) => {
  if (rootCache.has(id)) return rootCache.get(id);
  const seen = new Set();
  let current = id;
  let parentId = idToParentId.get(current);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    current = parentId;
    parentId = idToParentId.get(current);
  }
  rootCache.set(id, current);
  return current;
};

const comments = rows.map((row) => {
  const likes = Math.max(0, Math.trunc(Number(row.likes) || 0));
  const ups = Array.from(
    { length: Math.min(likes, 500) },
    (_, index) => `legacy-like-${row.id}-${index + 1}`,
  );

  const mapped = {
    _id: idToTwikooId.get(row.id),
    uid: `legacy-user-${row.id}`,
    nick: row.nickname || "Anonymous",
    mail: row.email || "",
    mailMd5: toMailMd5(row.email),
    link: "",
    ua: "",
    ip: "",
    master: false,
    url: toUrl(row.slug),
    href: toUrl(row.slug),
    comment: toCommentHtml(row.content),
    isSpam: false,
    created: toTimestamp(row.createdAt),
    updated: toTimestamp(row.updatedAt),
    ups,
    downs: [],
  };

  if (row.parentId) {
    const pid = idToTwikooId.get(row.parentId);
    if (pid) {
      mapped.pid = pid;
      mapped.rid = idToTwikooId.get(findRootId(row.id));
    }
  }

  return mapped;
});

await writeFile(outputPath, JSON.stringify({ results: comments }, null, 2), "utf8");
await sql.end({ timeout: 5 });

const guestbookCount = comments.filter((item) => item.url === "/guestbook").length;
const noteCount = comments.length - guestbookCount;
console.log(
  `Exported ${comments.length} comments (${guestbookCount} guestbook / ${noteCount} note) to ${outputPath}`,
);
