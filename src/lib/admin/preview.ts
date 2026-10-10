import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export async function previewMarkdown(content: string, path = "") {
  const folder = path.split("/").slice(0, -1).join("/");
  const markdown = content
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_match, file: string) => `![](/_vault/${file.split("/").map(encodeURIComponent).join("/")})`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => `[${label || target}](/notes/${target.replace(/\.md$/, "").split("/").map(encodeURIComponent).join("/")})`);
  const html = await marked.parse(markdown, { gfm: true, breaks: true });
  return sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "details", "summary", "del"],
    allowedAttributes: { a: ["href", "title", "rel", "target"], img: ["src", "alt", "title", "loading"], code: ["class"], '*': ["id"] },
    allowedSchemes: ["https", "http", "mailto"], allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => ({ tagName: "a", attribs: { ...attributes, target: "_blank", rel: "noopener noreferrer" } }),
      img: (_tag, attributes) => {
        let src = attributes.src || "";
        if (src && !/^(https?:|\/\/|\/)/.test(src)) {
          const resolved = new URL(src, `https://vault.invalid/${folder ? `${folder}/` : ""}`).pathname;
          src = `/_vault${resolved}`;
        }
        if (src.startsWith("/_vault/")) {
          let path = src.slice(8);
          try { path = decodeURIComponent(path); } catch { /* Keep a malformed escape literal. */ }
          src = `/api/admin/image?path=${encodeURIComponent(path)}`;
        }
        return { tagName: "img", attribs: { ...attributes, src, loading: "lazy" } };
      },
    },
  });
}
