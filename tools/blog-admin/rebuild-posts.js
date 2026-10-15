'use strict';

/**
 * 把已有的博客文章全部重刷一遍，使其套用最新的页面模板。
 *
 * 为什么需要它：
 *   文章页的样式与 <head> 结构由 tools/blog-admin/lib/posts.js 的模板决定，
 *   而模板只在新保存文章时生效。改了模板（比如加主题切换）之后，
 *   老文章仍是旧结构，必须重刷一次。
 *
 * 做法：
 *   直接调用生成器自己的 parsePost / buildPostHtml，而不是在这里手写 HTML ——
 *   这样重刷结果与以后新建的文章结构完全一致，不会出现两套模板。
 *   markdown 文章从 <template id="blog-source"> 重新渲染；
 *   html 文章原样保留正文（parsePost 提取出的 body 会被重新包进新模板）。
 *
 * 用法：
 *   node tools/blog-admin/rebuild-posts.js            # 预演，只打印将要发生的变化
 *   node tools/blog-admin/rebuild-posts.js --write    # 真正写入
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  BLOG_DIR,
  INDEX_FILE,
  parsePost,
  buildPostHtml,
  buildIndex,
  listSlugs,
} = require('./lib/posts');

const WRITE = process.argv.includes('--write');

function fmtSize(n) {
  return (n / 1024).toFixed(1) + ' KB';
}

async function main() {
  const slugs = await listSlugs();
  console.log(`发现 ${slugs.length} 篇文章${WRITE ? '' : '（预演模式，加 --write 才写入）'}\n`);

  const rows = [];
  for (const slug of slugs) {
    const file = path.join(BLOG_DIR, slug);
    const before = await fsp.readFile(file, 'utf8');
    const post = parsePost(before, slug);
    const after = buildPostHtml(post);

    // 安全检查：markdown 源必须原样保留，否则重刷会损坏文章内容
    const afterPost = parsePost(after, slug);
    const sourceKept = post.content === afterPost.content;
    const titleKept = post.title === afterPost.title;
    const dateKept = post.date === afterPost.date;

    const changed = before !== after;
    if (WRITE && changed) await fsp.writeFile(file, after, 'utf8');

    rows.push({
      slug,
      mode: post.mode,
      changed,
      sourceKept,
      titleKept,
      dateKept,
      before: Buffer.byteLength(before),
      after: Buffer.byteLength(after),
    });
  }

  console.log('文件'.padEnd(28), '模式'.padEnd(6), '变化', ' 源保留', '体积');
  console.log('-'.repeat(76));
  for (const r of rows) {
    const flags = [r.sourceKept ? 'ok' : '源被改!', r.titleKept ? '' : '标题被改!', r.dateKept ? '' : '日期被改!']
      .filter(Boolean).join(' ');
    console.log(
      r.slug.padEnd(28),
      r.mode.padEnd(6),
      (r.changed ? '是  ' : '无  '),
      ' ' + flags.padEnd(6),
      fmtSize(r.before) + ' → ' + fmtSize(r.after)
    );
  }

  const broken = rows.filter((r) => !r.sourceKept || !r.titleKept || !r.dateKept);
  const changed = rows.filter((r) => r.changed);

  console.log(`\n需要更新：${changed.length} 篇；内容校验异常：${broken.length} 篇`);

  if (!WRITE) {
    console.log('\n（预演结束，未写入任何文件）');
    return;
  }

  if (broken.length) {
    console.error('\n有文章未通过校验，索引页不再重建，请先检查上面的标记。');
    process.exitCode = 1;
    return;
  }

  const result = await buildIndex();
  console.log(`索引页已重建：blog.html（${result.count} 篇已发布）`);
  console.log(`位置：${path.relative(process.cwd(), INDEX_FILE)}`);
}

main().catch((err) => {
  console.error('失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
