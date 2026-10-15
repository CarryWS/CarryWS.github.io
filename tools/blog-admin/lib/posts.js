'use strict';

/**
 * 博客文章读写核心：解析、创建、修改、删除文章文件，并重建 blog.html 索引。
 *
 * 一篇文章 = blog/<slug>.html，页面自带内联样式，直接由 GitHub Pages / nginx 提供。
 * 元信息写在 <head> 的 <meta> 里（description / keywords / post-date / robots），
 * Markdown 原文保存在文件末尾的 <template id="blog-source"> 中，
 * 这样文章页是纯静态 HTML，同时编辑器又能无损地继续编辑。
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { render, toPlainText, escapeHtml, unescapeHtml } = require('./markdown');

const SITE_ROOT = path.resolve(__dirname, '..', '..', '..');
const BLOG_DIR = path.join(SITE_ROOT, 'blog');
const IMAGES_DIR = path.join(BLOG_DIR, 'images');
const INDEX_FILE = path.join(SITE_ROOT, 'blog.html');

const SITE_NAME = 'CarryWS';
const DEFAULT_SUMMARY_LENGTH = 100;

// ---------------------------------------------------------------- 工具函数

function assertSafeSlug(slug) {
  const value = String(slug == null ? '' : slug).trim();
  if (!value) throw new Error('文件名不能为空');
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error('文件名不能包含路径分隔符或 ".."');
  }
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(value)) {
    throw new Error('文件名只能包含字母、数字、下划线、连字符、点或中文');
  }
  if (!/\.html?$/i.test(value)) throw new Error('文件名必须以 .html 结尾');
  return value;
}

function slugToFile(slug) {
  const safe = assertSafeSlug(slug);
  return path.join(BLOG_DIR, safe);
}

function normalizeDate(input) {
  const value = String(input == null ? '' : input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function today() {
  return normalizeDate(new Date());
}

/** 规范化 HH:MM 或 HH:MM:SS；非法输入返回空串 */
function normalizeTime(input) {
  const match = String(input == null ? '' : input).trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return '';
  const [hh, mm, ss] = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  if (hh > 23 || mm > 59 || ss > 59) return '';
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

/** 当前本地时间 HH:MM:SS：新建文章时写入 <meta name="post-time">，用于同一天文章的排序 */
function nowTime() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags == null ? '' : tags)
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 由标题生成默认文件名（中文标题回退为 post） */
function suggestSlug(title, date) {
  const ascii = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${normalizeDate(date)}-${ascii || 'post'}.html`;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, length = DEFAULT_SUMMARY_LENGTH) {
  const value = String(text || '').trim();
  if (value.length <= length) return value;
  return value.slice(0, length);
}

// ---------------------------------------------------------------- HTML 解析

function readMeta(html, name) {
  const tag = html.match(new RegExp(`<meta[^>]*\\bname=["']${name}["'][^>]*>`, 'i'));
  if (!tag) return '';
  const content = tag[0].match(/\bcontent=["']([\s\S]*?)["']/i);
  return content ? unescapeHtml(content[1]).trim() : '';
}

/** 解析文章 HTML，得到结构化数据 */
function parsePost(html, slug) {
  const titleFromTag = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const titleFromH1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const title = stripTags(
    titleFromTag.replace(new RegExp(`\\s*\\|\\s*${SITE_NAME}\\s*$`), '') || titleFromH1
  );

  const date =
    readMeta(html, 'post-date') ||
    stripTags((html.match(/<p class="date"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '') ||
    '';

  const tags = normalizeTags(readMeta(html, 'keywords'));
  const description = readMeta(html, 'description');
  const draft = /<meta[^>]*\bname=["']robots["'][^>]*\bnoindex/i.test(html) ||
    /^true$/i.test(readMeta(html, 'draft'));

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;

  const sourceMatch = body.match(/<template[^>]*id=["']blog-source["'][^>]*>([\s\S]*?)<\/template>/i);
  const source = sourceMatch ? unescapeHtml(sourceMatch[1]).replace(/^\n/, '').replace(/\s+$/, '') : null;

  body = body
    .replace(/<template[^>]*id=["']blog-source["'][\s\S]*?<\/template>/i, '')
    // 主题切换按钮属于模板，不是正文；不剥掉的话下次保存会被重复写进文章
    .replace(/<button[^>]*class=["'][^"']*\btheme-toggle\b[^"']*["'][\s\S]*?<\/button>/i, '')
    // 返回链接属于模板，不是正文（允许带 class 等属性）
    .replace(/<p[^>]*>\s*<a[^>]*href=["']\/blog\.html["'][\s\S]*?<\/a>\s*<\/p>/i, '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
    .replace(/<p class="date"[^>]*>[\s\S]*?<\/p>/i, '')
    .replace(/<p class="tags"[^>]*>[\s\S]*?<\/p>/i, '')
    .trim();

  return {
    slug,
    title,
    date: normalizeDate(date || today()),
    time: normalizeTime(readMeta(html, 'post-time')),
    tags,
    description,
    draft,
    mode: source === null ? 'html' : 'markdown',
    content: source === null ? body : source,
  };
}

// ---------------------------------------------------------------- 页面模板

/** 主题按钮：两个图标都写进标记，用 CSS 按 [data-theme] 显隐，免去图标互换脚本 */
const BLOG_BUTTON = [
  '<button type="button" class="theme-toggle" aria-label="切换深浅色主题" title="切换深色 / 浅色">',
  '  <svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-13.5a1.25 1.25 0 0 1 1.25 1.25v1.5a1.25 1.25 0 0 1-2.5 0v-1.5A1.25 1.25 0 0 1 12 3.5zm0 13.5a1.25 1.25 0 0 1 1.25 1.25v1.5a1.25 1.25 0 0 1-2.5 0v-1.5A1.25 1.25 0 0 1 12 17zm8.5-6.25a1.25 1.25 0 0 1-1.25 1.25h-1.5a1.25 1.25 0 0 1 0-2.5h1.5A1.25 1.25 0 0 1 20.5 10.75zm-13.5 0a1.25 1.25 0 0 1-1.25 1.25h-1.5a1.25 1.25 0 0 1 0-2.5h1.5A1.25 1.25 0 0 1 7 10.75zm10.6-5.1a1.25 1.25 0 0 1 0 1.77l-1.06 1.06a1.25 1.25 0 0 1-1.77-1.77l1.06-1.06a1.25 1.25 0 0 1 1.77 0zM9.23 15.29a1.25 1.25 0 0 1 0 1.77l-1.06 1.06a1.25 1.25 0 0 1-1.77-1.77l1.06-1.06a1.25 1.25 0 0 1 1.77 0zm9.54 2.83a1.25 1.25 0 0 1-1.77 0l-1.06-1.06a1.25 1.25 0 0 1 1.77-1.77l1.06 1.06a1.25 1.25 0 0 1 0 1.77zM9.23 6.23a1.25 1.25 0 0 1-1.77 0L6.4 5.17a1.25 1.25 0 0 1 1.77-1.77l1.06 1.06a1.25 1.25 0 0 1 0 1.77z"/></svg>',
  '  <svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.6A9 9 0 0 1 9.4 3.3a9 9 0 1 0 11.3 11.3z"/></svg>',
  '</button>',
].join('\n');

/** <head> 里的样式与首屏防闪白脚本（深浅两套颜色都在 theme.css / blog.css 里） */
const BLOG_HEAD_ASSETS = [
  '<link rel="stylesheet" type="text/css" href="/assets/css/theme.css">',
  '<link rel="stylesheet" type="text/css" href="/assets/css/blog.css">',
  // 必须在样式之后、首屏绘制之前落定 data-theme，否则浅色下会先闪一下深色
  `<script>(function(H){var s=null;try{s=localStorage.getItem('theme')}catch(e){}` +
    `var m=/[?&]theme=(light|dark)\\b/.exec(location.search);` +
    `H.setAttribute('data-theme',m?m[1]:(s==='light'||s==='dark')?s:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'));` +
    `})(document.documentElement)</script>`,
  '<script src="/assets/js/theme.js"></script>',
].join('\n');

/** 渲染正文（markdown 模式）或直接使用 HTML（html 模式） */
function renderBody(content, mode) {
  if (mode === 'html') return String(content || '').trim();
  return render(content);
}

function buildPostHtml(post) {
  const title = String(post.title || '无标题').trim();
  const date = normalizeDate(post.date);
  const time = normalizeTime(post.time);
  const tags = normalizeTags(post.tags);
  const body = renderBody(post.content, post.mode);
  const description = truncate(
    String(post.description || '').trim() || toPlainText(body) || title,
    200
  );

  const head = [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)} | ${SITE_NAME}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="keywords" content="${escapeHtml(tags.join(', '))}">`,
    `<meta name="post-date" content="${date}">`,
    time ? `<meta name="post-time" content="${time}">` : '',
    `<meta name="author" content="${SITE_NAME}">`,
    post.draft ? '<meta name="robots" content="noindex, nofollow">' : '',
    '<link rel="icon" type="image/png" href="/favicon.png">',
    BLOG_HEAD_ASSETS,
    '</head>',
  ].filter(Boolean);

  const footer = tags.length
    ? `\n  <p class="tags">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</p>\n`
    : '';

  const sourceTemplate =
    post.mode === 'markdown'
      ? `\n  <template id="blog-source">${escapeHtml(String(post.content || '').trim())}</template>\n`
      : '';

  return [
    ...head,
    '<body>',
    BLOG_BUTTON,
    '  <p class="back"><a href="/blog.html">← Back</a></p>',
    `  <h1>${escapeHtml(title)}</h1>`,
    `  <p class="date">${date}</p>`,
    '',
    body,
    footer + sourceTemplate,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- 读取文章

async function ensureDirs() {
  await fsp.mkdir(BLOG_DIR, { recursive: true });
  await fsp.mkdir(IMAGES_DIR, { recursive: true });
}

async function listSlugs() {
  await ensureDirs();
  const entries = await fsp.readdir(BLOG_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

async function readPost(slug) {
  const file = slugToFile(slug);
  const html = await fsp.readFile(file, 'utf8');
  const stat = await fsp.stat(file);
  const post = parsePost(html, assertSafeSlug(slug));
  const plain = toPlainText(post.content);
  return {
    ...post,
    file,
    url: `/blog/${encodeURIComponent(post.slug)}`,
    size: stat.size,
    mtime: stat.mtimeMs,
    summary: truncate(post.description || plain, DEFAULT_SUMMARY_LENGTH),
  };
}

/** 排序键：日期 + 时间（没有时间的按 00:00:00 看待） */
function postSortKey(post) {
  return `${post.date || ''} ${normalizeTime(post.time) || '00:00:00'}`;
}

/**
 * 文章排序：日期倒序 → 同一天按 post-time 倒序 → 最后按文件名。
 * 同一天的多篇文章靠 post-time 区分先后，避免退化成按文件名排序。
 */
function comparePosts(a, b) {
  const ka = postSortKey(a);
  const kb = postSortKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return String(a.slug).localeCompare(String(b.slug));
}

async function listPosts({ includeDrafts = true } = {}) {
  const slugs = await listSlugs();
  const posts = [];
  for (const slug of slugs) {
    try {
      const post = await readPost(slug);
      if (!includeDrafts && post.draft) continue;
      posts.push(post);
    } catch (error) {
      posts.push({ slug, title: slug, error: error.message, date: '', draft: false, tags: [] });
    }
  }
  posts.sort(comparePosts);
  return posts;
}

async function postExists(slug) {
  try {
    await fsp.access(slugToFile(slug));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 写入文章

async function savePost(input) {
  await ensureDirs();
  const mode = input.mode === 'html' ? 'html' : 'markdown';
  const title = String(input.title || '').trim();
  if (!title) throw new Error('标题不能为空');

  const date = normalizeDate(input.date);
  const targetSlug = assertSafeSlug(input.slug || input.filename || suggestSlug(title, date));
  const originalSlug = input.originalSlug ? assertSafeSlug(input.originalSlug) : null;
  const creating = !originalSlug;

  if (creating && (await postExists(targetSlug))) {
    throw new Error(`文件 blog/${targetSlug} 已存在，请换一个文件名`);
  }

  // 创建时间：新建时打上当前时间；修改已有文章时保留它原来的时间（改名也不变），
  // 否则同一天的文章每保存一次就会重排一次。
  let time = normalizeTime(input.time);
  if (!time && originalSlug && (await postExists(originalSlug))) {
    try {
      const oldHtml = await fsp.readFile(slugToFile(originalSlug), 'utf8');
      time = normalizeTime(parsePost(oldHtml, originalSlug).time);
    } catch {
      time = '';
    }
  }
  if (!time && creating) time = nowTime();

  const post = {
    slug: targetSlug,
    title,
    date,
    time,
    tags: normalizeTags(input.tags),
    description: String(input.description || '').trim(),
    draft: Boolean(input.draft),
    mode,
    content: String(input.content == null ? '' : input.content),
  };

  await fsp.writeFile(slugToFile(targetSlug), buildPostHtml(post), 'utf8');

  // 重命名：写新文件后删除旧文件
  if (originalSlug && originalSlug !== targetSlug) {
    const oldFile = slugToFile(originalSlug);
    if (await postExists(originalSlug)) await fsp.unlink(oldFile);
  }

  return readPost(targetSlug);
}

async function deletePost(slug) {
  const safe = assertSafeSlug(slug);
  const file = slugToFile(safe);
  await fsp.unlink(file);
  return { slug: safe, deleted: true };
}

// ---------------------------------------------------------------- 图片上传

function safeImageName(name) {
  const ext = (path.extname(String(name || '')).toLowerCase() || '.png').replace(/[^.a-z0-9]/g, '');
  const base = path
    .basename(String(name || 'image'), path.extname(String(name || '')))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${normalizeDate(new Date())}-${base || 'image'}${ext}`;
}

async function saveImage({ name, base64, dataUrl }) {
  await ensureDirs();
  const raw = dataUrl || base64 || '';
  const match = String(raw).match(/^data:([\w/+.-]+);base64,(.*)$/s);
  const payload = match ? match[2] : raw;
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) throw new Error('图片内容为空');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB');

  const extFromMime = match ? `.${(match[1].split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')}` : '';
  let filename = safeImageName(extFromMime && !path.extname(String(name || '')) ? `image${extFromMime}` : name);
  let target = path.join(IMAGES_DIR, filename);
  let counter = 1;
  while (fs.existsSync(target)) {
    const ext = path.extname(filename);
    target = path.join(IMAGES_DIR, `${filename.slice(0, -ext.length)}-${counter}${ext}`);
    counter += 1;
  }
  await fsp.writeFile(target, buffer);
  return { file: path.basename(target), url: `images/${path.basename(target)}`, size: buffer.length };
}

// ---------------------------------------------------------------- 索引页

function buildIndexHtml(posts) {
  const published = posts.filter((p) => !p.draft);

  const items = published
    .map((post) => {
      const href = `blog/${encodeURIComponent(post.slug)}`;
      const tags = (post.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
      const summary = escapeHtml(post.summary || '');
      return [
        '  <div class="post" data-title="' + escapeHtml(post.title) + '" data-tags="' +
          escapeHtml((post.tags || []).join(' ')) + '" data-text="' + escapeHtml(post.summary || '') + '">',
        `    <h2><a href="${href}">${escapeHtml(post.title)}</a>${tags}</h2>`,
        `    <div class="date">${escapeHtml(post.date)}</div>`,
        summary ? `    <p class="summary">${summary}</p>` : '',
        '  </div>',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const body = published.length
    ? items
    : '  <p class="empty">还没有文章，去 tools/blog-admin 写一篇吧。</p>';

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog | ${SITE_NAME}</title>
<meta name="description" content="${SITE_NAME} 的博客">
<link rel="icon" type="image/png" href="/favicon.png">
${BLOG_HEAD_ASSETS}
</head>
<body>
${BLOG_BUTTON}
  <p class="back"><a href="/">← Back</a></p>
  <h1>Blog</h1>
  <input id="search" class="search" type="search" placeholder="搜索标题、标签或摘要…" autocomplete="off">
  <p class="count" id="count">共 ${published.length} 篇文章</p>

${body}

<script>
  (function () {
    var input = document.getElementById('search');
    var count = document.getElementById('count');
    var posts = Array.prototype.slice.call(document.querySelectorAll('.post'));
    var total = posts.length;
    function apply() {
      var q = (input.value || '').trim().toLowerCase();
      var shown = 0;
      posts.forEach(function (el) {
        var haystack = [el.dataset.title, el.dataset.tags, el.dataset.text].join(' ').toLowerCase();
        var match = !q || haystack.indexOf(q) !== -1;
        el.style.display = match ? '' : 'none';
        if (match) shown += 1;
      });
      count.textContent = q ? '匹配 ' + shown + ' / ' + total + ' 篇文章' : '共 ' + total + ' 篇文章';
    }
    input.addEventListener('input', apply);
  })();
</script>
</body>
</html>
`;
}

async function buildIndex() {
  const posts = await listPosts({ includeDrafts: false });
  const html = buildIndexHtml(posts);
  await fsp.writeFile(INDEX_FILE, html, 'utf8');
  return { file: INDEX_FILE, count: posts.length, html };
}

/** 站内所有文章用到的图片 */
async function listImages() {
  await ensureDirs();
  const entries = await fsp.readdir(IMAGES_DIR, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e) => {
        const stat = await fsp.stat(path.join(IMAGES_DIR, e.name));
        return { name: e.name, url: `images/${e.name}`, size: stat.size, mtime: stat.mtimeMs };
      })
  );
  return files.sort((a, b) => b.mtime - a.mtime);
}

module.exports = {
  SITE_ROOT,
  BLOG_DIR,
  IMAGES_DIR,
  INDEX_FILE,
  DEFAULT_SUMMARY_LENGTH,
  assertSafeSlug,
  suggestSlug,
  normalizeDate,
  normalizeTime,
  nowTime,
  normalizeTags,
  today,
  truncate,
  toPlainText,
  parsePost,
  buildPostHtml,
  buildIndexHtml,
  renderBody,
  listPosts,
  comparePosts,
  postSortKey,
  listSlugs,
  readPost,
  savePost,
  deletePost,
  saveImage,
  listImages,
  buildIndex,
  escapeHtml,
};
