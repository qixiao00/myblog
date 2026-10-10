import { parse, stringify } from "yaml";
import { AdminError } from "./security";

export function readFrontmatter(text: string): { data: Record<string, unknown>; content: string } {
  const match = text.replace(/^\uFEFF/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { data: {}, content: text };
  try {
    const data = parse(match[1], { maxAliasCount: 50 });
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) throw new Error("Invalid metadata");
    return { data: data || {}, content: text.replace(/^\uFEFF/, "").slice(match[0].length) };
  } catch { throw new AdminError(400, "文章的 YAML 信息格式不正确，请先修正。 "); }
}

export function writeFrontmatter(content: string, data: Record<string, unknown>) {
  return `---\n${stringify(data, { aliasDuplicateObjects: false })}---\n\n${content}`;
}
