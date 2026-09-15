'use strict';

/* 博客管理后台前端逻辑（零依赖） */

const $ = (id) => document.getElementById(id);

const el = {
  list: $('post-list'),
  search: $('search'),
  title: $('title'),
  date: $('date'),
  slug: $('slug'),
  tags: $('tags'),
  description: $('description'),
  mode: $('mode'),
  draft: $('draft'),
  content: $('content'),
  preview: $('preview'),
  previewFrame: $('preview-frame'),
  statusDot: $('status-dot'),
  statusMsg: $('status-msg'),
  editState: $('edit-state'),
  countInfo: $('count-info'),
  gitInfo: $('git-info'),
  toolbarHint: $('toolbar-hint'),
  fileInput: $('file-input'),
  modal: $('modal'),
  modalTitle: $('modal-title'),
  modalText: $('modal-text'),
  modalExtra: $('modal-extra'),
  modalOk: $('modal-ok'),
  modalCancel: $('modal-cancel'),
};

const state = {
  posts: [],
  originalSlug: null,
  currentFile: null,
  dirty: false,
  previewTimer: null,
  previewOn: false,
  meta: { today: '', suggestedSlug: '' },
};

/* ------------------------------------------------------------ 基础工具 */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && data.error) || `请求失败 (${res.status})`);
  return data;
}

function setStatus(message, kind = '') {
  el.statusMsg.textContent = message;
  el.statusDot.className = `dot ${kind}`;
  if (kind === 'ok' || kind === 'err') {
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => { el.statusDot.className = 'dot'; }, 4000);
  }
}

function setDirty(value) {
  state.dirty = value;
  el.editState.textContent = value
    ? '● 未保存的修改'
    : (state.originalSlug ? `已保存：blog/${state.originalSlug}` : '未选中文章');
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function modal({ title, text, html, okText = '确定', showInput = false, placeholder = '' }) {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalText.textContent = text || '';
    el.modalText.style.display = text ? '' : 'none';
    el.modalExtra.innerHTML = '';

    let input = null;
    if (html) {
      el.modalExtra.innerHTML = html;
    }
    if (showInput) {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = placeholder;
      el.modalExtra.appendChild(input);
    }

    el.modalOk.textContent = okText;
    el.modal.classList.add('on');
    if (input) setTimeout(() => input.focus(), 30);

    const close = (value) => {
      el.modal.classList.remove('on');
      el.modalOk.onclick = null;
      el.modalCancel.onclick = null;
      el.modal.onkeydown = null;
      resolve(value);
    };

    el.modalOk.onclick = () => close(input ? input.value : true);
    el.modalCancel.onclick = () => close(null);
    el.modal.onkeydown = (event) => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || input)) close(input ? input.value : true);
    };
  });
}

/* ------------------------------------------------------------ 列表 */

async function loadStatus() {
  try {
    const info = await api('/admin/api/status');
    state.meta = info;
    el.gitInfo.textContent = [
      info.isGitRepo ? `git:${info.branch}` : '非 git 仓库',
      info.isGitRepo ? `${info.dirty} 个改动` : '',
      info.siteRoot,
    ].filter(Boolean).join(' · ');
  } catch (error) {
    el.gitInfo.textContent = error.message;
  }
}

async function loadPosts(selectSlug) {
  const data = await api('/admin/api/posts');
  state.posts = data.posts;
  renderList();
  el.countInfo.textContent = `共 ${state.posts.length} 篇`;
  if (selectSlug) {
    const found = state.posts.find((p) => p.slug === selectSlug);
    if (found) await openPost(found.slug);
  }
}

function renderList() {
  const keyword = el.search.value.trim().toLowerCase();
  const posts = state.posts.filter((post) => {
    if (!keyword) return true;
    return [post.title, post.slug, (post.tags || []).join(' '), post.summary]
      .join(' ').toLowerCase().includes(keyword);
  });

  if (!posts.length) {
    el.list.innerHTML = `<p class="empty">${state.posts.length ? '没有匹配的文章' : '还没有文章，点右上角「新建文章」'}</p>`;
    return;
  }

  el.list.innerHTML = posts.map((post) => {
    const tags = (post.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    return `<div class="item${post.slug === state.originalSlug ? ' active' : ''}" data-slug="${escapeHtml(post.slug)}">
      <span class="t">${escapeHtml(post.title || post.slug)}</span>
      <span class="d">${escapeHtml(post.date)}${post.draft ? ' <span class="draft">草稿</span>' : ''}${tags}</span>
    </div>`;
  }).join('');

  el.list.querySelectorAll('.item').forEach((node) => {
    node.addEventListener('click', () => openPost(node.dataset.slug));
  });
}

async function openPost(slug) {
  if (state.dirty && !(await confirmDiscard())) return;
  try {
    const { post } = await api(`/admin/api/posts/${encodeURIComponent(slug)}`);
    fill(post);
    state.originalSlug = post.slug;
    state.currentFile = post.file;
    renderList();
    setDirty(false);
    setStatus(`已打开 blog/${post.slug}`, '');
    schedulePreview();
  } catch (error) {
    setStatus(error.message, 'err');
  }
}

function fill(post) {
  el.title.value = post.title || '';
  el.date.value = post.date || state.meta.today || '';
  el.slug.value = post.slug || '';
  el.tags.value = (post.tags || []).join(', ');
  el.description.value = post.description || '';
  el.mode.value = post.mode === 'html' ? 'html' : 'markdown';
  el.draft.checked = Boolean(post.draft);
  el.content.value = post.content || '';
  updateModeHint();
}

function newPost() {
  state.originalSlug = null;
  state.currentFile = null;
  fill({
    title: '',
    date: state.meta.today || new Date().toISOString().slice(0, 10),
    slug: state.meta.suggestedSlug || `${new Date().toISOString().slice(0, 10)}-post.html`,
    tags: [],
    description: '',
    mode: 'markdown',
    draft: false,
    content: '',
  });
  renderList();
  setDirty(false);
  el.title.focus();
  setStatus('新建文章：填好标题后点「保存」', '');
  schedulePreview();
}

async function confirmDiscard() {
  const answer = await modal({
    title: '放弃未保存的修改？',
    text: '当前文章有改动还没保存，继续操作会丢失这些内容。',
    okText: '放弃修改',
  });
  if (answer) { setDirty(false); return true; }
  return false;
}

/* ------------------------------------------------------------ 保存 / 删除 */

function collect() {
  return {
    originalSlug: state.originalSlug,
    title: el.title.value.trim(),
    date: el.date.value,
    slug: el.slug.value.trim(),
    tags: el.tags.value,
    description: el.description.value.trim(),
    mode: el.mode.value,
    draft: el.draft.checked,
    content: el.content.value,
  };
}

async function save() {
  const payload = collect();
  if (!payload.title) { setStatus('标题不能为空', 'err'); el.title.focus(); return; }
  if (!payload.slug) payload.slug = state.meta.suggestedSlug;

  setStatus('保存中…', 'busy');
  try {
    const result = state.originalSlug
      ? await api(`/admin/api/posts/${encodeURIComponent(state.originalSlug)}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/admin/api/posts', { method: 'POST', body: JSON.stringify(payload) });

    state.originalSlug = result.post.slug;
    state.currentFile = result.post.file;
    el.slug.value = result.post.slug;
    setDirty(false);
    await loadPosts();
    renderList();
    setStatus(`已保存 blog/${result.post.slug}，blog.html 索引已更新（${result.index.count} 篇）`, 'ok');
    schedulePreview();
  } catch (error) {
    setStatus(`保存失败：${error.message}`, 'err');
  }
}

async function removePost() {
  if (!state.originalSlug) { setStatus('还没有保存过的文章，无需删除', 'err'); return; }
  const slug = state.originalSlug;
  const answer = await modal({
    title: '删除文章',
    text: `确定要删除 blog/${slug} 吗？文件会从磁盘移除，此操作不可撤销。`,
    okText: '删除',
  });
  if (!answer) return;

  setStatus('删除中…', 'busy');
  try {
    await api(`/admin/api/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    state.originalSlug = null;
    state.currentFile = null;
    state.dirty = false;
    fill({ title: '', date: state.meta.today, slug: '', tags: [], mode: 'markdown', content: '' });
    await loadPosts();
    setDirty(false);
    setStatus(`已删除 blog/${slug}`, 'ok');
    updatePreview();
  } catch (error) {
    setStatus(`删除失败：${error.message}`, 'err');
  }
}

/* ------------------------------------------------------------ 预览 */

function schedulePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(updatePreview, 350);
}

async function updatePreview() {
  if (!state.previewOn) return;
  try {
    const res = await fetch('/admin/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
    });
    const html = await res.text();
    el.previewFrame.srcdoc = html;
  } catch (error) {
    el.previewFrame.srcdoc = `<pre>${escapeHtml(error.message)}</pre>`;
  }
}

function togglePreview(force) {
  state.previewOn = force == null ? !state.previewOn : force;
  el.preview.classList.toggle('on', state.previewOn);
  $('btn-preview').textContent = state.previewOn ? '关闭预览' : '预览';
  if (state.previewOn) updatePreview();
}

/* ------------------------------------------------------------ 编辑器辅助 */

function updateModeHint() {
  el.toolbarHint.textContent = el.mode.value === 'html'
    ? 'HTML 模式：正文直接写入页面 body'
    : 'Markdown：单换行 = <br>，可直接写 HTML';
}

function surround(before, after = before, placeholder = '') {
  const area = el.content;
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const selected = area.value.slice(start, end) || placeholder;
  const text = before + selected + after;
  area.setRangeText(text, start, end, 'end');
  area.selectionStart = start + before.length;
  area.selectionEnd = start + before.length + selected.length;
  area.focus();
}

function prefixLines(prefix, { ordered = false } = {}) {
  const area = el.content;
  const start = area.value.lastIndexOf('\n', area.selectionStart - 1) + 1;
  const end = area.selectionEnd;
  const block = area.value.slice(start, end) || '';
  const lines = block.split('\n');
  const text = lines
    .map((line, index) => `${ordered ? `${index + 1}. ` : prefix}${line}`)
    .join('\n');
  area.setRangeText(text, start, end, 'end');
  area.focus();
}

function insertText(text) {
  const area = el.content;
  const start = area.selectionStart;
  area.setRangeText(text, start, area.selectionEnd, 'end');
  area.focus();
}

const isHtml = () => el.mode.value === 'html';

function applyInsert(kind) {
  if (isHtml()) {
    const map = {
      h2: ['<h2>', '</h2>', '小标题'],
      h3: ['<h3>', '</h3>', '小标题'],
      bold: ['<strong>', '</strong>', '加粗'],
      italic: ['<em>', '</em>', '斜体'],
      strike: ['<del>', '</del>', '删除线'],
      code: ['<code>', '</code>', 'code'],
      quote: ['<blockquote>', '</blockquote>', '引用内容'],
      ul: ['<ul>\n  <li>', '</li>\n</ul>', '列表项'],
      ol: ['<ol>\n  <li>', '</li>\n</ol>', '列表项'],
      hr: ['\n<hr>\n', '', ''],
      link: ['<a href="https://example.com">', '</a>', '链接文字'],
    };
    const [before, after, placeholder] = map[kind] || ['', '', ''];
    surround(before, after, placeholder);
    return;
  }

  switch (kind) {
    case 'h2': prefixLines('## '); break;
    case 'h3': prefixLines('### '); break;
    case 'bold': surround('**', '**', '加粗'); break;
    case 'italic': surround('*', '*', '斜体'); break;
    case 'strike': surround('~~', '~~', '删除线'); break;
    case 'code': surround('`', '`', 'code'); break;
    case 'quote': prefixLines('> '); break;
    case 'ul': prefixLines('- '); break;
    case 'ol': prefixLines('', { ordered: true }); break;
    case 'hr': insertText('\n---\n'); break;
    case 'link': surround('[', '](https://example.com)', '链接文字'); break;
    default: break;
  }
}

/* ------------------------------------------------------------ 图片上传 */

async function uploadFiles(files) {
  const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
  if (!images.length) return;

  for (const file of images) {
    setStatus(`上传 ${file.name}…`, 'busy');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const image = await api('/admin/api/upload', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, dataUrl }),
      });
      const alt = file.name.replace(/\.[^.]+$/, '');
      insertText(isHtml()
        ? `\n<img src="${image.url}" alt="${alt}">\n`
        : `\n![${alt}](${image.url})\n`);
      setDirty(true);
      schedulePreview();
      setStatus(`已插入 ${image.url}`, 'ok');
    } catch (error) {
      setStatus(`上传失败：${error.message}`, 'err');
    }
  }
}

/* ------------------------------------------------------------ 发布 / 索引 */

async function rebuildIndex() {
  setStatus('重建索引中…', 'busy');
  try {
    const result = await api('/admin/api/build', { method: 'POST', body: '{}' });
    await loadPosts();
    setStatus(`blog.html 已重建，共 ${result.count} 篇文章`, 'ok');
  } catch (error) {
    setStatus(`重建失败：${error.message}`, 'err');
  }
}

async function publish() {
  const message = await modal({
    title: '发布到 GitHub',
    text: '将执行：git add blog blog.html → git commit → git push。',
    okText: '提交并推送',
    showInput: true,
    placeholder: '提交信息，留空则自动生成',
  });
  if (message === null) return;

  setStatus('发布中…', 'busy');
  try {
    const result = await api('/admin/api/publish', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    await loadStatus();
    setStatus(
      result.pushed ? `已推送：${result.message}` : `已提交但推送失败（${result.detail || '检查远程仓库'}）`,
      result.pushed ? 'ok' : 'err'
    );
  } catch (error) {
    setStatus(`发布失败：${error.message}`, 'err');
  }
}

/* ------------------------------------------------------------ 事件绑定 */

function bind() {
  el.title.addEventListener('input', () => setDirty(true));
  el.date.addEventListener('input', () => setDirty(true));
  el.slug.addEventListener('input', () => setDirty(true));
  el.tags.addEventListener('input', () => setDirty(true));
  el.description.addEventListener('input', () => setDirty(true));
  el.draft.addEventListener('change', () => setDirty(true));
  el.mode.addEventListener('change', () => { updateModeHint(); setDirty(true); });
  el.content.addEventListener('input', () => { setDirty(true); schedulePreview(); });

  el.search.addEventListener('input', renderList);

  $('btn-slug').addEventListener('click', () => {
    const date = el.date.value || state.meta.today;
    const title = el.title.value;
    const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    el.slug.value = `${date}-${ascii || 'post'}.html`;
    setDirty(true);
  });

  $('btn-new').addEventListener('click', async () => {
    if (state.dirty && !(await confirmDiscard())) return;
    newPost();
  });

  $('btn-save').addEventListener('click', save);
  $('btn-delete').addEventListener('click', removePost);
  $('btn-preview').addEventListener('click', () => togglePreview());
  $('btn-build').addEventListener('click', rebuildIndex);
  $('btn-publish').addEventListener('click', publish);
  $('btn-image').addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    uploadFiles(el.fileInput.files);
    el.fileInput.value = '';
  });

  document.querySelectorAll('[data-insert]').forEach((button) => {
    button.addEventListener('click', () => applyInsert(button.dataset.insert));
  });

  el.content.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      insertText('  ');
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); save(); }
    else if (key === 'b') { event.preventDefault(); applyInsert('bold'); }
    else if (key === 'i') { event.preventDefault(); applyInsert('italic'); }
    else if (key === 'k') { event.preventDefault(); applyInsert('link'); }
  });

  el.content.addEventListener('paste', (event) => {
    const files = event.clipboardData && event.clipboardData.files;
    if (files && files.length) {
      event.preventDefault();
      uploadFiles(files);
    }
  });

  ['dragenter', 'dragover'].forEach((type) => {
    el.content.addEventListener(type, (event) => {
      event.preventDefault();
      el.content.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.content.addEventListener(type, (event) => {
      event.preventDefault();
      el.content.classList.remove('dragover');
    });
  });
  el.content.addEventListener('drop', (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) uploadFiles(files);
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  });
}

async function init() {
  bind();
  setStatus('就绪');
  await loadStatus();
  if (!el.date.value && state.meta.today) el.date.value = state.meta.today;
  try {
    await loadPosts();
    if (state.posts.length) {
      await openPost(state.posts[0].slug);
    } else {
      newPost();
    }
  } catch (error) {
    setStatus(`加载失败：${error.message}`, 'err');
  }
}

init();
