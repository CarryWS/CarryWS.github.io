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
    .replace(/<p>\s*<a[^>]*href=["']\/blog\.html["'][\s\S]*?<\/a>\s*<\/p>/i, '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '')
    .replace(/<p class="date"[^>]*>[\s\S]*?<\/p>/i, '')
    .replace(/<p class="tags"[^>]*>[\s\S]*?<\/p>/i, '')
    .trim();

  return {
    slug,
    title,
    date: normalizeDate(date || today()),
    tags,
    description,
    draft,
    mode: source === null ? 'html' : 'markdown',
    content: source === null ? body : source,
  };
}

// ---------------------------------------------------------------- 页面模板

const POST_STYLE = `  html { background: black; }
  body { color: #6C7486; font-family: "Courier New", monospace;
         max-width: 720px; margin: 0 auto; padding: 60px 24px; line-height: 1.8; }
  a { color: #99A3BA; text-decoration: none; border-bottom: 1px dotted #6C7486; }
  a:hover { color: #E4ECFA; }
  h1 { color: #E4ECFA; font-size: 26px; letter-spacing: 1px; }
  h2 { color: #E4ECFA; font-size: 18px; margin-top: 32px; }
  h3 { color: #E4ECFA; font-size: 16px; margin-top: 24px; }
  .date { color: #3F4656; font-size: 13px; }
  code { background: #111; padding: 2px 6px; color: #99A3BA; }
  pre { background: #111; padding: 12px; overflow-x: auto; color: #99A3BA; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; border: 1px solid #242836; }
  blockquote { border-left: 2px solid #242836; margin-left: 0; padding-left: 14px; color: #3F4656; }
  hr { border: none; border-top: 1px solid #242836; margin: 28px 0; }
  ul, ol { padding-left: 22px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #242836; padding: 4px 10px; }
  .tags { margin-top: 40px; font-size: 13px; color: #3F4656; }
  .tags span { border: 1px solid #242836; padding: 1px 8px; margin-right: 6px; }
  ::selection { background: #222; color: #99A3BA; }`;

/** 渲染正文（markdown 模式）或直接使用 HTML（html 模式） */
function renderBody(content, mode) {
  if (mode === 'html') return String(content || '').trim();
  return render(content);
}

function buildPostHtml(post) {
  const title = String(post.title || '无标题').trim();
  const date = normalizeDate(post.date);
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
    `<meta name="author" content="${SITE_NAME}">`,
    post.draft ? '<meta name="robots" content="noindex, nofollow">' : '',
    '<link rel="icon" type="image/png" href="/favicon.png">',
    '<style>',
    POST_STYLE,
    '</style>',
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
    '  <p><a href="/blog.html">← Back</a></p>',
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
  posts.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(a.slug).localeCompare(String(b.slug));
  });
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

  const post = {
    slug: targetSlug,
    title,
    date,
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

const INDEX_STYLE = `  html { background: black; }
  body { color: #6C7486; font-family: "Courier New", monospace;
         max-width: 720px; margin: 0 auto; padding: 60px 24px; line-height: 1.8; }
  a { color: #99A3BA; text-decoration: none; border-bottom: 1px dotted #6C7486; }
  a:hover { color: #E4ECFA; border-bottom-color: #99A3BA; }
  .back { font-size: 14px; }
  h1 { color: #E4ECFA; font-size: 28px; letter-spacing: 2px; }
  .search { width: 100%; box-sizing: border-box; background: #0b0b0b; color: #E4ECFA;
            border: 1px solid #242836; padding: 8px 12px; font-family: inherit;
            font-size: 14px; margin: 6px 0 10px; outline: none; }
  .search:focus { border-color: #3F4656; }
  .count { font-size: 13px; color: #3F4656; margin: 0 0 12px; }
  .post { border-bottom: 1px solid #242836; padding: 18px 0; }
  .post h2 { font-size: 18px; margin: 0 0 6px; }
  .post h2 a { color: #E4ECFA; border: none; }
  .post h2 a:hover { color: #99A3BA; }
  .date { font-size: 13px; color: #3F4656; }
  .summary { margin: 4px 0 0; font-size: 14px; }
  .tag { font-size: 12px; color: #3F4656; border: 1px solid #242836;
         padding: 0 6px; margin-left: 8px; }
  .empty { color: #3F4656; font-style: italic; }
  ::selection { background: #222; color: #99A3BA; }`;

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
<style>
${INDEX_STYLE}
</style>
</head>
<body>
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
  normalizeTags,
  today,
  truncate,
  toPlainText,
  parsePost,
  buildPostHtml,
  buildIndexHtml,
  renderBody,
  listPosts,
  listSlugs,
  readPost,
  savePost,
  deletePost,
  saveImage,
  listImages,
  buildIndex,
  escapeHtml,
};
