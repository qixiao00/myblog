export const SITE_VIEW_PREFIX = "@site:";
export const SITE_STARTED_KEY = "@site:started";

export function siteViewKey(page: string) {
  if (!page.startsWith("/") || page.startsWith("//") || page.includes("\\")) throw new Error("Invalid page");
  const encoded = page.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let path: string;
  try { path = decodeURIComponent(encoded).normalize("NFC"); } catch { throw new Error("Invalid page"); }
  if (path.length > 300 || /[\x00-\x1f]/.test(path) || path.split("/").some(part => part === "." || part === "..")) throw new Error("Invalid page");
  if (!["/", "/notes", "/guestbook", "/stats"].includes(path) && !path.startsWith("/notes/")) throw new Error("Not a public page");
  return `${SITE_VIEW_PREFIX}${path}`;
}
