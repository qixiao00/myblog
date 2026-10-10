export {};
type Post = { path: string; sha?: string; title: string; date: string; description: string; tags: string[]; draft: boolean; content?: string };
type Comment = { _id: string; nick?: string; comment?: string; url?: string; created?: number; isSpam?: boolean; top?: boolean; pid?: string; rid?: string };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const field = (id: string) => el<HTMLInputElement>(id);
const value = (id: string) => field(id).value;
let connected = false, posts: Post[] = [], filter = 'all', view = 'posts', current: Post | null = null, dirty = false, saving = false, page = 1, commentCount = 0, reply: Comment | null = null;
let previewVersion = 0, previewTimer: ReturnType<typeof setTimeout>, noticeTimer: ReturnType<typeof setTimeout>;
function notice(message: string) { el('notice').textContent = message; el('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el('notice').hidden = true, 6000); }
async function api<T = any>(route: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/${route}`, { method, credentials: 'same-origin', headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 && route !== 'login') { el('admin-view').hidden = true; el('login-view').hidden = false; } throw new Error(data.message || '操作失败，请稍后重试。'); }
  return data as T;
}
async function busy(button: HTMLButtonElement, work: () => Promise<void>) { if (button.disabled) return; button.disabled = true; try { await work(); } catch (error) { notice(error instanceof Error ? error.message : '操作失败。'); } finally { button.disabled = false; } }
function button(label: string, work: () => Promise<void>, className = 'button small') { const node = document.createElement('button'); node.type = 'button'; node.className = className; node.textContent = label; node.addEventListener('click', () => void busy(node, work)); return node; }
function text(tag: string, content: string, className = '') { const node = document.createElement(tag); node.textContent = content; node.className = className; return node; }
function empty(target: string, message: string) { el(target).replaceChildren(text('p', message, 'empty-state')); }
function canLeave() { if (saving) { notice('正在保存，请稍候。'); return false; } return !dirty || confirm('还有未保存的修改，确定离开吗？'); }
function switchView(next: string, force = false) {
  if (view === 'editor' && next !== 'editor' && !force && !canLeave()) return;
  if (next !== 'editor') { dirty = false; previewVersion++; }
  view = next;
  for (const name of ['posts', 'editor', 'comments', 'settings']) el(`${name}-view`).hidden = name !== next;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === next || next === 'editor' && node.dataset.view === 'posts'));
  el('breadcrumb').textContent = { posts: '文章', editor: '写作', comments: '读者留言', settings: '后台设置' }[next] || '';
  if (next === 'comments') void loadComments().catch(error => notice(error.message));
}
async function bootstrap() {
  el('retry-bootstrap').hidden = true;
  try {
    const state = await api<{ configured: boolean }>('bootstrap');
    if (!state.configured) throw new Error('后台账号尚未配置，请联系站点管理员。');
    el('login-description').textContent = '输入账号和密码，管理文章与留言。';
    field('login-username').disabled = false; field('login-password').disabled = false;
    el<HTMLButtonElement>('login-submit').disabled = false; el('login-submit').textContent = '登录';
    const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
    if (response.ok) { const session = await response.json(); await enter(session); }
  } catch (error) { el('login-description').textContent = error instanceof Error ? error.message : '无法连接后台。'; el('retry-bootstrap').hidden = false; }
}
async function enter(session?: { connected: boolean; repository: string }) {
  const state = session || await api<{ connected: boolean; repository: string }>('session'); connected = state.connected;
  el('login-view').hidden = true; el('admin-view').hidden = false; field('login-password').value = '';
  el('connection-status').textContent = `${state.repository} · ${connected ? '已连接，可以编辑与发布。' : '尚未连接。留言管理已可使用。'}`;
  el('repo-prompt').hidden = connected; el<HTMLButtonElement>('new-post').disabled = !connected;
  if (dirty && current && view === 'editor') { switchView('editor', true); notice('登录已恢复，未保存的内容仍在编辑器中。'); void preview(); return; }
  switchView('posts', true); if (connected) await loadPosts(); else empty('posts-list', '连接文章仓库后，在这里开始写作。');
}
el<HTMLFormElement>('login-form').addEventListener('submit', event => {
  event.preventDefault(); void busy(el<HTMLButtonElement>('login-submit'), async () => {
    el('login-error').hidden = true;
    try {
      await api('login', 'POST', { username: value('login-username').trim(), password: value('login-password') });
      await enter();
    } catch (error) { el('login-error').textContent = error instanceof Error ? error.message : '登录失败。'; el('login-error').hidden = false; }
  });
});
el('retry-bootstrap').addEventListener('click', () => void bootstrap());
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(node => node.addEventListener('click', () => switchView(node.dataset.view!)));
el('open-settings').addEventListener('click', () => switchView('settings'));
el('back-posts').addEventListener('click', () => switchView('posts'));
el('logout').addEventListener('click', () => void busy(el<HTMLButtonElement>('logout'), async () => { if (!canLeave()) return; await api('logout', 'POST', {}); location.reload(); }));
el('mobile-logout').addEventListener('click', () => el('logout').click());
el<HTMLFormElement>('connect-form').addEventListener('submit', event => { event.preventDefault(); void busy(el<HTMLFormElement>('connect-form').querySelector('button[type="submit"]')!, async () => { await api('connect', 'POST', { token: value('connect-token').trim() }); field('connect-token').value = ''; await enter(); notice('仓库已连接。'); }); });
async function loadPosts() { if (!connected) return; empty('posts-list', '正在读取文章…'); try { posts = (await api<{ posts: Post[] }>('posts')).posts; renderPosts(); } catch (error) { empty('posts-list', error instanceof Error ? error.message : '文章加载失败。'); throw error; } }
function renderPosts() {
  el('all-count').textContent = String(posts.length); el('published-count').textContent = String(posts.filter(p => !p.draft).length); el('draft-count').textContent = String(posts.filter(p => p.draft).length);
  const query = value('post-search').trim().toLowerCase(); const rows = posts.filter(p => (filter === 'all' || p.draft === (filter === 'draft')) && `${p.title} ${p.path} ${p.tags.join(' ')}`.toLowerCase().includes(query));
  el('posts-list').replaceChildren(); if (!rows.length) return empty('posts-list', '还没有符合条件的文章。');
  for (const post of rows) {
    const row = text('article', '', 'post-row'), info = text('div', '', 'post-info'); info.append(text('h2', post.title), text('p', `${post.date || '未设日期'} · ${post.path}`, 'muted'));
    const state = text('span', post.draft ? '草稿' : '已发布', `status-pill ${post.draft ? 'draft' : 'published'}`), actions = text('div', '', 'button-row');
    actions.append(button('编辑', async () => { const full = await api<Post>(`posts?path=${encodeURIComponent(post.path)}`); openEditor(full); }), button('删除', async () => { if (!confirm(`删除「${post.title}」？站点下次部署后会移除这篇文章，Git 历史仍可恢复。`)) return; await api('posts', 'DELETE', { path: post.path, sha: post.sha }); await loadPosts(); notice('文章已删除，等待站点部署。'); }, 'button small danger'));
    row.append(info, state, actions); el('posts-list').append(row);
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(node => node.addEventListener('click', () => { filter = node.dataset.filter!; document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === node)); renderPosts(); }));
field('post-search').addEventListener('input', renderPosts);
el('refresh-posts').addEventListener('click', () => void busy(el<HTMLButtonElement>('refresh-posts'), loadPosts));
el('new-post').addEventListener('click', () => openEditor({ path: '', title: '', date: new Date().toLocaleDateString('sv-SE'), description: '', tags: [], draft: true, content: '' }));
function openEditor(post: Post) {
  current = { ...post }; dirty = false;
  for (const name of ['title', 'path', 'date', 'description', 'content'] as const) field(`post-${name}`).value = post[name] || '';
  field('post-tags').value = post.tags.join('，'); field('post-path').disabled = Boolean(post.sha);
  el('editor-heading').textContent = post.sha ? '编辑文章' : '写一篇'; el('save-state').textContent = post.sha ? `${post.draft ? '草稿' : '已发布'} · ${post.path}` : '新文章尚未保存。';
  switchView('editor', true); updateWords(); void preview();
}
function ensurePath() { if (!current?.sha && !value('post-path').trim() && value('post-title').trim()) field('post-path').value = `随笔/${value('post-title').trim().replace(/[\\/:*?"<>|#\x00-\x1f]/g, '-').slice(0, 100)}.md`; }
function updateWords() { el('word-count').textContent = `${value('post-content').replace(/\s/g, '').length.toLocaleString()} 字`; }
function changed() { dirty = true; el('save-state').textContent = '有未保存的修改。'; updateWords(); clearTimeout(previewTimer); previewTimer = setTimeout(() => void preview(), 450); }
['title', 'path', 'date', 'description', 'tags', 'content'].forEach(name => field(`post-${name}`).addEventListener('input', changed));
field('post-title').addEventListener('blur', ensurePath);
async function preview() {
  if (view !== 'editor' || el('editor-panes').classList.contains('mode-edit')) return;
  const version = ++previewVersion;
  try { const result = await api<{ html: string }>('preview', 'POST', { content: value('post-content'), path: value('post-path') }); if (version === previewVersion && view === 'editor') el('post-preview').innerHTML = result.html || '<p class="muted">文章预览会出现在这里。</p>'; }
  catch (error) { if (version === previewVersion) el('post-preview').textContent = error instanceof Error ? error.message : '预览失败。'; }
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(node => node.addEventListener('click', () => { el('editor-panes').className = `editor-panes mode-${node.dataset.mode}`; document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === node)); void preview(); }));
function insert(before: string, after = '', placeholder = '') { const area = el<HTMLTextAreaElement>('post-content'); const start = area.selectionStart, end = area.selectionEnd; const selected = area.value.slice(start, end) || placeholder; area.setRangeText(before + selected + after, start, end, 'end'); area.focus(); changed(); }
document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(node => node.addEventListener('click', () => { const format = node.dataset.format; if (format === 'bold') insert('**', '**', '文字'); if (format === 'italic') insert('*', '*', '文字'); if (format === 'heading') insert('\n## ', '\n', '标题'); if (format === 'link') insert('[', '](https://)', '链接文字'); }));
async function save(draft: boolean) {
  if (!current || saving) return; ensurePath(); if (!value('post-title').trim() || !value('post-path').trim() || !value('post-date')) throw new Error('请填写标题、文章路径和日期。');
  if (draft && current.sha && !current.draft && !confirm('保存为草稿后，这篇已发布文章会在下次部署时取消公开。继续吗？')) return;
  const input: Post = { path: value('post-path').trim(), title: value('post-title').trim(), date: value('post-date'), description: value('post-description'), tags: value('post-tags').split(/[,，]/).map(tag => tag.trim()).filter(Boolean), draft, content: value('post-content'), ...(current.sha ? { sha: current.sha } : {}) };
  saving = true; const snapshot = JSON.stringify(input); el<HTMLButtonElement>('save-draft').disabled = true; el<HTMLButtonElement>('publish-post').disabled = true;
  try { const result = await api<{ sha: string }>('posts', 'POST', input); current = { ...input, sha: result.sha }; field('post-path').disabled = true;
    field('post-path').value = input.path;
    const now = { ...input, title: value('post-title').trim(), date: value('post-date'), description: value('post-description'), tags: value('post-tags').split(/[,，]/).map(tag => tag.trim()).filter(Boolean), content: value('post-content') };
    dirty = JSON.stringify(now) !== snapshot; el('save-state').textContent = dirty ? '已保存上一份内容，当前还有新修改。' : `${draft ? '草稿已保存' : '文章已提交发布'} · 等待站点部署完成。`;
    posts = posts.filter(p => p.path !== input.path); posts.unshift(current); renderPosts(); notice(draft ? '草稿已保存。' : '文章已提交发布，部署完成后生效。');
  } finally { saving = false; el<HTMLButtonElement>('save-draft').disabled = false; el<HTMLButtonElement>('publish-post').disabled = false; }
}
el('save-draft').addEventListener('click', () => void save(true).catch(error => notice(error.message)));
el('publish-post').addEventListener('click', () => void save(false).catch(error => notice(error.message)));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && view === 'editor') { event.preventDefault(); void save(current?.draft ?? true).catch(error => notice(error.message)); } });
window.addEventListener('beforeunload', event => { if (dirty || saving) event.preventDefault(); });
el('upload-image').addEventListener('click', () => field('image-file').click());
field('image-file').addEventListener('change', () => void busy(el<HTMLButtonElement>('upload-image'), async () => { const file = field('image-file').files?.[0]; if (!file) return; field('image-file').value = ''; if (file.size > 4 * 1024 * 1024) throw new Error('图片最大支持 4 MB。'); const post = current; const data = new FormData(); data.append('file', file); const result = await api<{ url: string }>('upload', 'POST', data); if (current === post && view === 'editor') insert(`\n![图片](${result.url})\n`); notice('图片已保存到仓库。'); }));
function plain(html: string) { return new DOMParser().parseFromString(html, 'text/html').body.textContent || ''; }
async function loadComments() {
  empty('comments-list', '正在读取留言…'); el<HTMLButtonElement>('comments-prev').disabled = true; el<HTMLButtonElement>('comments-next').disabled = true;
  try {
    const result = await api<{ count: number; data: Comment[] }>(`comments?page=${page}&type=${encodeURIComponent(value('comment-filter'))}&keyword=${encodeURIComponent(value('comment-search').trim())}`); commentCount = result.count;
    if (page > 1 && !result.data.length && page > Math.ceil(commentCount / 20)) { page = Math.max(1, Math.ceil(commentCount / 20)); return loadComments(); }
    el('comments-summary').textContent = `当前筛选共 ${commentCount} 条留言，包含文章评论与回复。`; el('comments-page').textContent = `第 ${page} / ${Math.max(1, Math.ceil(commentCount / 20))} 页`; el<HTMLButtonElement>('comments-prev').disabled = page <= 1; el<HTMLButtonElement>('comments-next').disabled = page * 20 >= commentCount;
    el('comments-list').replaceChildren(); if (!result.data.length) return empty('comments-list', '没有符合条件的留言。');
    for (const comment of result.data) {
      const card = text('article', '', 'comment-card'), heading = text('div', '', 'comment-heading'); heading.append(text('strong', comment.nick || '匿名读者'), text('span', `${comment.created ? new Date(comment.created).toLocaleString('zh-CN') : ''} · ${comment.isSpam ? '已隐藏' : '公开'}${comment.top ? ' · 置顶' : ''}`, 'muted'));
      const actions = text('div', '', 'button-row');
      const change = async (action: string) => { if (action === 'delete' && !confirm('永久删除这条留言？删除后无法通过后台恢复。')) return; await api('comments', 'POST', { id: comment._id, action }); await loadComments(); notice('留言已更新。'); };
      actions.append(button('回复', async () => { reply = comment; el('reply-context').textContent = `${comment.nick || '读者'}：${plain(comment.comment || '').slice(0, 120)}`; field('reply-content').value = ''; el<HTMLDialogElement>('reply-dialog').showModal(); }), button(comment.isSpam ? '恢复公开' : '隐藏', () => change(comment.isSpam ? 'restore' : 'hide')));
      if (!comment.rid) actions.append(button(comment.top ? '取消置顶' : '置顶', () => change(comment.top ? 'unpin' : 'pin')));
      actions.append(button('删除', () => change('delete'), 'button small danger'));
      card.append(heading, text('p', plain(comment.comment || ''), 'comment-body'), text('p', comment.url || '', 'comment-source muted'), actions); el('comments-list').append(card);
    }
  } catch (error) { empty('comments-list', error instanceof Error ? error.message : '留言加载失败。'); throw error; }
}
el<HTMLFormElement>('comment-search-form').addEventListener('submit', event => { event.preventDefault(); page = 1; void loadComments().catch(error => notice(error.message)); });
el('comments-prev').addEventListener('click', () => { if (page > 1) { page--; void loadComments().catch(error => notice(error.message)); } });
el('comments-next').addEventListener('click', () => { if (page * 20 < commentCount) { page++; void loadComments().catch(error => notice(error.message)); } });
el('close-reply').addEventListener('click', () => el<HTMLDialogElement>('reply-dialog').close());
el<HTMLFormElement>('reply-form').addEventListener('submit', event => { event.preventDefault(); void busy(el<HTMLFormElement>('reply-form').querySelector('button[type="submit"]')!, async () => { if (!reply) return; await api('reply', 'POST', { id: reply._id, parentId: reply.pid || undefined, url: reply.url, nick: value('reply-nick'), mail: value('reply-mail'), content: value('reply-content') }); el<HTMLDialogElement>('reply-dialog').close(); await loadComments(); notice('回复已发送。'); }); });
el('export-comments').addEventListener('click', () => void busy(el<HTMLButtonElement>('export-comments'), async () => { const data = await api('export-comments'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `comments-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notice('留言已导出。'); }));
void bootstrap();
