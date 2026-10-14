export function commentSource(url: string | undefined, posts: Array<{ path: string; title: string }> = []) {
  const raw = (url || "").split(/[?#]/)[0].replace(/\/+$/, "");
  let path = raw;
  try { path = decodeURIComponent(raw).normalize("NFC"); } catch { /* Old malformed paths still get a readable fallback. */ }
  if (path === "/guestbook") return { label: "留言板", href: "/guestbook" };
  if (path.startsWith("/notes/") && !path.includes("\\") && !/[\x00-\x1f]/.test(path)) {
    const relative = path.slice(7);
    if (relative.split("/").some(part => !part || part === "." || part === "..")) return { label: "文章评论", href: "" };
    const post = posts.find(post => post.path.replace(/\.md$/i, "").normalize("NFC") === relative);
    return { label: post?.title || relative.split("/").pop() || "文章评论", href: `/notes/${relative.split("/").map(encodeURIComponent).join("/")}` };
  }
  return { label: "其他页面", href: "" };
}
