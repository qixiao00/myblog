const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const themeButtons = document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]');
function currentTheme() { return document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function updateThemeLabels() { themeButtons.forEach(button => { button.setAttribute('aria-label', currentTheme() === 'dark' ? '切换浅色主题' : '切换深色主题'); button.setAttribute('aria-pressed', String(currentTheme() === 'dark')); }); }
themeButtons.forEach(button => button.addEventListener('click', () => { const theme = currentTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('journal-theme', theme); } catch {} updateThemeLabels(); }));
updateThemeLabels();
const panel = document.querySelector<HTMLElement>('[data-sidebar-panel]');
const backdrop = document.querySelector<HTMLElement>('[data-sidebar-backdrop]');
const toggle = document.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
const main = document.querySelector<HTMLElement>('.blog-main');
function updateDirectoryAccess() { if (panel) panel.inert = innerWidth < 768 && !panel.classList.contains('is-open'); if (main) main.inert = Boolean(panel?.classList.contains('is-open')); }
function closeDirectory() { panel?.classList.remove('is-open'); updateDirectoryAccess(); backdrop?.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); toggle?.setAttribute('aria-expanded', 'false'); }
toggle?.addEventListener('click', () => { if (panel?.classList.contains('is-open')) { closeDirectory(); return; } panel?.classList.add('is-open'); updateDirectoryAccess(); backdrop?.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); toggle.setAttribute('aria-expanded', 'true'); panel?.querySelector<HTMLElement>('button,summary,a')?.focus(); });
backdrop?.addEventListener('click', closeDirectory);
document.querySelectorAll('[data-sidebar-close]').forEach(button => button.addEventListener('click', () => { closeDirectory(); toggle?.focus(); }));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel?.classList.contains('is-open')) { closeDirectory(); toggle?.focus(); } });
window.addEventListener('resize', () => { if (window.innerWidth >= 768) closeDirectory(); else updateDirectoryAccess(); });
updateDirectoryAccess();
document.querySelectorAll<HTMLDetailsElement>('.folder-details').forEach(details => { const children = details.querySelector<HTMLElement>('.folder-children-inner'); const update = () => { if (children) children.inert = !details.open; }; update(); details.addEventListener('toggle', update); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !panel?.classList.contains('is-open')) return;
  const controls = Array.from(panel.querySelectorAll<HTMLElement>('button,a,summary')).filter(element => !element.closest('[inert]'));
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); observer.unobserve(entry.target); } }, { threshold: .08 });
  document.querySelectorAll('[data-reveal]').forEach(element => { element.classList.add('reveal-ready'); observer.observe(element); });
}
let frame = 0;
document.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
  const target = (event.target as HTMLElement).closest<HTMLElement>('.glass-interactive'); if (!target) return;
  cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const rect = target.getBoundingClientRect(); target.style.setProperty('--pointer-x', `${((event.clientX - rect.left) / rect.width) * 100}%`); target.style.setProperty('--pointer-y', `${((event.clientY - rect.top) / rect.height) * 100}%`); });
});
export {};

document.addEventListener('click', event => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-direction]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || reducedMotion.matches) return;
  const direction = link.dataset.direction!; document.documentElement.dataset.navigationDirection = direction;
  try { sessionStorage.setItem('journal-navigation-direction', direction); } catch {}
});
