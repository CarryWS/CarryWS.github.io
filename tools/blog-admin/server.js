'use strict';

/**
 * 博客管理后台（本地工具，仅监听 127.0.0.1）
 *
 *   node tools/blog-admin/server.js [--port 7878] [--host 127.0.0.1] [--no-open]
 *
 * 启动后浏览器打开 http://127.0.0.1:7878/admin/ 即可写博客。
 * 同一个端口也会托管整站静态文件，方便随时预览 blog.html 与文章页。
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const posts = require('./lib/posts');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SITE_ROOT = posts.SITE_ROOT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.gifv': 'video/mp4',
};

const BLOCKED = new Set(['secret.txt', '.git', '.gitignore', '.env']);

function parseArgs(argv) {
  const args = { port: 7878, host: '127.0.0.1', open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]) || args.port;
    else if (arg === '--host') args.host = argv[++i] || args.host;
    else if (arg === '--no-open') args.open = false;
  }
  return args;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('请求体不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    sendText(res, 404, 'Not Found');
    return;
  }
  if (stat.isDirectory()) {
    return serveStatic(res, path.join(filePath, 'index.html'));
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: SITE_ROOT }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), code: error ? error.code : 0 });
    });
  });
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/admin\/api\/?/, '');
  const method = req.method.toUpperCase();

  // GET /admin/api/status
  if (route === 'status' && method === 'GET') {
    const gitStatus = await runGit(['status', '--porcelain']);
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    return sendJson(res, 200, {
      siteRoot: SITE_ROOT,
      blogDir: posts.BLOG_DIR,
      isGitRepo: branch.ok,
      branch: branch.ok ? branch.stdout : null,
      dirty: gitStatus.ok ? gitStatus.stdout.split('\n').filter(Boolean).length : 0,
      today: posts.today(),
      suggestedSlug: posts.suggestSlug('', posts.today()),
    });
  }

  // GET /admin/api/posts
  if (route === 'posts' && method === 'GET') {
    const list = await posts.listPosts();
    return sendJson(res, 200, { posts: list });
  }

  // /admin/api/posts/:slug
  const slugMatch = route.match(/^posts\/(.+)$/);
  if (slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]);
    if (method === 'GET') {
      const post = await posts.readPost(slug);
      return sendJson(res, 200, { post });
    }
    if (method === 'DELETE') {
      await posts.deletePost(slug);
      const index = await posts.buildIndex();
      return sendJson(res, 200, { deleted: slug, index: { count: index.count } });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      const saved = await posts.savePost({ ...body, originalSlug: body.originalSlug || slug });
      const index = await posts.buildIndex();
      return sendJson(res, 200, { post: saved, index: { count: index.count } });
    }
  }

  // POST /admin/api/posts  -> 新建
  if (route === 'posts' && method === 'POST') {
    const body = await readBody(req);
    const saved = await posts.savePost(body);
    const index = await posts.buildIndex();
    return sendJson(res, 201, { post: saved, index: { count: index.count } });
  }

  // POST /admin/api/preview
  if (route === 'preview' && method === 'POST') {
    const body = await readBody(req);
    const html = posts.buildPostHtml({
      title: body.title || '预览',
      date: body.date,
      tags: body.tags,
      description: body.description,
      draft: Boolean(body.draft),
      mode: body.mode,
      content: body.content,
    });
    // 预览用的 iframe 地址在 /admin/ 下，用 <base> 让 images/xxx.png 这类相对路径能解析
    const previewHtml = html.replace('<head>', '<head>\n<base href="/blog/">');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(previewHtml);
  }

  // POST /admin/api/upload
  if (route === 'upload' && method === 'POST') {
    const body = await readBody(req);
    const image = await posts.saveImage(body);
    return sendJson(res, 201, image);
  }

  // GET /admin/api/images
  if (route === 'images' && method === 'GET') {
    return sendJson(res, 200, { images: await posts.listImages() });
  }

  // POST /admin/api/build
  if (route === 'build' && method === 'POST') {
    const index = await posts.buildIndex();
    return sendJson(res, 200, { rebuilt: true, count: index.count });
  }

  // POST /admin/api/publish  { message }
  if (route === 'publish' && method === 'POST') {
    const body = await readBody(req);
    const isRepo = await runGit(['rev-parse', '--is-inside-work-tree']);
    if (!isRepo.ok) return sendJson(res, 400, { error: '当前目录不是 git 仓库' });

    await posts.buildIndex();
    const add = await runGit(['add', '--', 'blog', 'blog.html']);
    if (!add.ok) return sendJson(res, 500, { error: 'git add 失败', detail: add.stderr });

    const message = String(body.message || '').trim() ||
      `blog: update posts (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;
    const commit = await runGit(['commit', '-m', message]);
    if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      return sendJson(res, 500, { error: 'git commit 失败', detail: (commit.stderr || commit.stdout).trim() });
    }
    const push = await runGit(['push']);
    return sendJson(res, 200, {
      committed: commit.ok,
      pushed: push.ok,
      message,
      detail: [commit.stdout, push.stdout, push.stderr].filter(Boolean).join('\n').trim(),
    });
  }

  return sendJson(res, 404, { error: `未知接口: ${method} ${url.pathname}` });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname === '/admin') {
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }

    if (url.pathname.startsWith('/admin/api/')) {
      return await handleApi(req, res, url);
    }

    if (url.pathname === '/admin/' || url.pathname === '/admin/index.html') {
      return await serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (url.pathname.startsWith('/admin/')) {
      const rel = decodeURIComponent(url.pathname.slice('/admin/'.length));
      const target = path.resolve(PUBLIC_DIR, rel);
      if (!target.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');
      return await serveStatic(res, target);
    }

    // 整站静态资源
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(SITE_ROOT, rel || 'index.html');
    if (!target.startsWith(SITE_ROOT)) return sendText(res, 403, 'Forbidden');
    const top = path.relative(SITE_ROOT, target).split(path.sep)[0].toLowerCase();
    if (BLOCKED.has(top) || BLOCKED.has(path.basename(target).toLowerCase())) {
      return sendText(res, 403, 'Forbidden');
    }
    if (url.pathname === '/') return await serveStatic(res, path.join(SITE_ROOT, 'index.html'));
    return await serveStatic(res, target);
  } catch (error) {
    const status = /不存在|ENOENT/.test(error.message) ? 404 : 400;
    return sendJson(res, status, { error: error.message });
  }
});

function main() {
  const args = parseArgs(process.argv.slice(2));
  server.listen(args.port, args.host, () => {
    const url = `http://${args.host}:${args.port}/admin/`;
    process.stdout.write([
      '',
      '  ┌──────────────────────────────────────────────┐',
      '  │  CarryWS 博客后台已启动                      │',
      '  └──────────────────────────────────────────────┘',
      '',
      `   写博客   ${url}`,
      `   看博客   http://${args.host}:${args.port}/blog.html`,
      `   站点目录 ${SITE_ROOT}`,
      '',
      '   按 Ctrl+C 退出',
      '',
      '',
    ].join('\n'));

    if (args.open) {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      execFile(cmd, cmdArgs, () => {});
    }
  });
}

if (require.main === module) main();

module.exports = { server, main };
