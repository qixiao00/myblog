async function recordPageView() {
  const slug = document.querySelector<HTMLElement>("[data-note-slug]")?.dataset.noteSlug;
  try {
    const response = await fetch("/api/view", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: location.pathname, ...(slug ? { slug } : {}) }), keepalive: true });
    if (!response.ok) return;
    const data = await response.json();
    const node = document.querySelector("[data-view-count]");
    if (slug && node && typeof data.views === "number") node.textContent = data.views.toLocaleString("zh-CN");
  } catch { /* Viewing the site must not depend on analytics availability. */ }
}
if (document.visibilityState === "visible") void recordPageView();
else document.addEventListener("visibilitychange", function visible() {
  if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", visible); void recordPageView(); }
});
