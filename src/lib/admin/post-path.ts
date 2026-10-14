export const POST_CATEGORIES = ["心情", "友人帐"] as const;
export type PostCategory = typeof POST_CATEGORIES[number];

export function newPostPath(category: string, title: string) {
  if (!(POST_CATEGORIES as readonly string[]).includes(category)) throw new Error("请选择心情或友人帐。");
  const filename = title.normalize("NFC").trim()
    .replace(/[\\/:*?"<>|#\x00-\x1f]/g, "-")
    .replace(/^[. ]+|[. ]+$/g, "").slice(0, 100).replace(/[. ]+$/g, "");
  if (!filename) throw new Error("请填写有效的文章标题。");
  return `${category}/${filename}.md`;
}
