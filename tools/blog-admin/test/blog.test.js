'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { render, toPlainText } = require('../lib/markdown');
const posts = require('../lib/posts');

test('markdown: 标题、段落与强调', () => {
  const html = render('## 小标题\n\n这是 **加粗** 和 *斜体* 以及 `code`。');
  assert.match(html, /<h2>小标题<\/h2>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test('markdown: 列表、引用、分隔线、代码块', () => {
  const html = render('- a\n- b\n\n> 引用\n\n---\n\n```bash\ndocker compose up -d\n```');
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>引用<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<pre><code class="language-bash">docker compose up -d<\/code><\/pre>/);
});

test('markdown: 链接、图片、转义与危险协议', () => {
  const html = render('[官网](https://carryws.xyz) ![图](images/a.png) <script>alert(1)</script>');
  assert.match(html, /<a href="https:\/\/carryws\.xyz" target="_blank" rel="noopener">官网<\/a>/);
  assert.match(html, /<img src="images\/a\.png" alt="图">/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const unsafe = render('[点我](javascript:alert(1))');
  assert.ok(!/javascript:/.test(unsafe), 'javascript: 协议应被拦截');
});

test('markdown: toPlainText 生成摘要', () => {
  const text = toPlainText('## 标题\n\n这是 **正文**，带 [链接](https://a.b)。');
  assert.equal(text, '标题 这是 正文，带 链接。');
});

test('posts: 能解析现有文章的元信息与正文', async () => {
  const post = await posts.readPost('first-post.html');
  assert.equal(post.title, '你好，世界');
  assert.equal(post.date, '2026-08-22');
  assert.equal(post.mode, 'html');
  assert.match(post.content, /爆炸谷/);
  assert.ok(!post.content.includes('<h1>'), '正文不应包含标题');
  assert.ok(!post.content.includes('← Back'), '正文不应包含返回链接');
});

test('posts: 生成的文章可以再次解析（往返一致）', async () => {
  const draft = {
    slug: 'tmp-roundtrip.html',
    title: '往返测试',
    date: '2026-01-02',
    tags: ['折腾', 'docker'],
    description: '摘要',
    draft: false,
    mode: 'markdown',
    content: '## 小节\n\n正文 `code`。\n\n![图](images/x.png)',
  };
  const html = posts.buildPostHtml(draft);
  const parsed = posts.parsePost(html, 'tmp-roundtrip.html');

  assert.equal(parsed.title, '往返测试');
  assert.equal(parsed.date, '2026-01-02');
  assert.deepEqual(parsed.tags, ['折腾', 'docker']);
  assert.equal(parsed.mode, 'markdown');
  assert.equal(parsed.content, draft.content);
  assert.match(posts.renderBody(parsed.content, parsed.mode), /<h2>小节<\/h2>/);
});

test('posts: slug 校验阻止路径穿越', () => {
  assert.throws(() => posts.assertSafeSlug('../Secret.txt'));
  assert.throws(() => posts.assertSafeSlug('a/b.html'));
  assert.throws(() => posts.assertSafeSlug('x.txt'));
  assert.equal(posts.assertSafeSlug('2026-01-01-hello.html'), '2026-01-01-hello.html');
});

test('posts: 索引页只收录非草稿并按日期倒序', () => {
  const html = posts.buildIndexHtml([
    { slug: 'a.html', title: 'A', date: '2026-01-01', tags: ['x'], summary: 'sa', draft: false },
    { slug: 'b.html', title: 'B', date: '2026-02-02', tags: [], summary: 'sb', draft: false },
    { slug: 'c.html', title: 'C', date: '2026-03-03', tags: [], summary: 'sc', draft: true },
  ]);
  assert.ok(html.indexOf('B') < html.indexOf('A'));
  assert.ok(!html.includes('>C<'), '草稿不应出现在索引');
  assert.match(html, /blog\/a\.html/);
  assert.match(html, /共 2 篇文章/);
});

test('posts: 现有 blog.html 与生成结果逐字节一致', async () => {
  const fs = require('fs');
  const list = await posts.listPosts({ includeDrafts: false });
  assert.ok(list.length >= 4, '至少应识别出 4 篇文章');
  const html = posts.buildIndexHtml(list);
  for (const post of list) {
    assert.ok(html.includes(`blog/${post.slug}`), `${post.slug} 应出现在索引中`);
  }
  // blog.html 是生成物：磁盘上的内容必须与 buildIndex 的输出完全一致（忽略换行差异）
  const onDisk = fs.readFileSync(posts.INDEX_FILE, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(html.replace(/\r\n/g, '\n'), onDisk, 'blog.html 与生成结果不一致：别手工改它，跑一次「重建索引」');
});

test('posts: post-time 元信息可往返', () => {
  const base = {
    slug: 'x.html',
    title: 'T',
    date: '2026-01-02',
    tags: [],
    draft: false,
    mode: 'markdown',
    content: '正文',
  };
  const withTime = posts.buildPostHtml({ ...base, time: '20:03:56' });
  assert.match(withTime, /<meta name="post-time" content="20:03:56">/);
  assert.equal(posts.parsePost(withTime, 'x.html').time, '20:03:56');

  const noTime = posts.buildPostHtml(base);
  assert.ok(!noTime.includes('post-time'), '没有时间就不该写这个 meta');

  assert.equal(posts.normalizeTime('9:5'), '09:05:00');
  assert.equal(posts.normalizeTime('25:00'), '', '非法时间应被丢弃');
  assert.equal(posts.normalizeTime('20:03'), '20:03:00');
});

test('posts: 同一天按 post-time 倒序，无时间的最后按文件名', () => {
  const list = [
    { slug: 'a.html', date: '2026-09-15', time: '' },
    { slug: 'b.html', date: '2026-09-15', time: '20:03:00' },
    { slug: 'c.html', date: '2026-09-15', time: '09:00:00' },
    { slug: 'd.html', date: '2026-09-16', time: '' },
  ];
  const sorted = list.slice().sort(posts.comparePosts).map((p) => p.slug);
  assert.deepEqual(sorted, ['d.html', 'b.html', 'c.html', 'a.html']);
});
