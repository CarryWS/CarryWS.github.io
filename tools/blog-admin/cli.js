#!/usr/bin/env node
'use strict';

/**
 * 命令行版博客工具（不想开浏览器时用）
 *
 *   node tools/blog-admin/cli.js list
 *   node tools/blog-admin/cli.js new "文章标题" [--tags 折腾,docker] [--content 正文.md] [--date 2026-01-01]
 *   node tools/blog-admin/cli.js show <slug>
 *   node tools/blog-admin/cli.js delete <slug>
 *   node tools/blog-admin/cli.js build
 */

const fs = require('fs');
const posts = require('./lib/posts');

function usage() {
  process.stdout.write(`CarryWS 博客命令行工具

  list                              列出所有文章
  new "<标题>" [选项]               新建文章
      --slug <文件名>               指定文件名（默认按日期+标题生成）
      --date <YYYY-MM-DD>           日期
      --tags <a,b>                  标签
      --summary <文本>              摘要
      --content <文件>              从文件读取正文（Markdown）
      --html                        正文按 HTML 处理
      --draft                       标记为草稿
  show <slug>                       输出文章信息
  delete <slug>                     删除文章
  build                             重新生成 blog.html
`);
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (['html', 'draft'].includes(key)) flags[key] = true;
      else flags[key] = argv[++i];
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case 'list': {
      const list = await posts.listPosts();
      if (!list.length) return process.stdout.write('（还没有文章）\n');
      for (const post of list) {
        process.stdout.write(
          `${post.date}  ${post.draft ? '[草稿] ' : ''}${post.title}  (blog/${post.slug})\n`
        );
      }
      return undefined;
    }

    case 'new': {
      const title = flags._[0];
      if (!title) throw new Error('缺少标题');
      const content = flags.content ? fs.readFileSync(flags.content, 'utf8') : '';
      const post = await posts.savePost({
        title,
        date: flags.date,
        slug: flags.slug,
        tags: flags.tags,
        description: flags.summary,
        draft: Boolean(flags.draft),
        mode: flags.html ? 'html' : 'markdown',
        content,
      });
      const index = await posts.buildIndex();
      process.stdout.write(`已创建 blog/${post.slug}（索引现有 ${index.count} 篇）\n`);
      return undefined;
    }

    case 'show': {
      const post = await posts.readPost(flags._[0]);
      process.stdout.write(`${JSON.stringify({ ...post, content: undefined }, null, 2)}\n\n${post.content}\n`);
      return undefined;
    }

    case 'delete': {
      const slug = flags._[0];
      if (!slug) throw new Error('缺少文件名');
      await posts.deletePost(slug);
      const index = await posts.buildIndex();
      process.stdout.write(`已删除 blog/${slug}（索引现有 ${index.count} 篇）\n`);
      return undefined;
    }

    case 'build': {
      const index = await posts.buildIndex();
      process.stdout.write(`blog.html 已生成，共 ${index.count} 篇\n`);
      return undefined;
    }

    default:
      usage();
      return undefined;
  }
}

main().catch((error) => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});
