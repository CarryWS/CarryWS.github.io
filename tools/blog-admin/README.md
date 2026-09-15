# 写博客工具（blog-admin）

给这个纯静态站点（GitHub Pages）用的本地博客编辑器：创建、修改、删除文章，
自动生成 `blog.html` 列表页，图片上传、实时预览、一键发布。

零依赖，只用 Node.js 标准库（需要 Node 18+，推荐 22/24）。

## 启动

```bash
# Linux / macOS
./tools/blog-admin/start.sh

# Windows
tools\blog-admin\start.bat

# 或者直接
node tools/blog-admin/server.js
```

浏览器会自动打开 <http://127.0.0.1:7878/admin/>。

可选参数：

```bash
node tools/blog-admin/server.js --port 7878 --host 127.0.0.1 --no-open
```

同一个端口也托管整站，所以直接访问 <http://127.0.0.1:7878/blog.html> 就能看线上效果。

> 该工具只监听 `127.0.0.1`，是**本地**工具：静态站点没有后端，写文件必须在你自己电脑上跑。
> 不要把 `node` 服务暴露到公网。

## 云服务器常驻（systemd）

线上那份站点在云服务器的 `/opt/site/CarryWS.github.io`，nginx 直接托管这个目录；
后台由 systemd 托管（不是 SSH 里前台跑），所以断开 SSH、服务器重启都不影响它：

```bash
sudo systemctl status blog-admin      # 状态
sudo systemctl restart blog-admin     # 改完 server.js 后重启
sudo journalctl -u blog-admin -f      # 实时日志
```

单元文件 `/etc/systemd/system/blog-admin.service`：`User=admin`、
`WorkingDirectory=/opt/site/CarryWS.github.io`、
`ExecStart=/usr/bin/node tools/blog-admin/server.js --host 127.0.0.1 --port 7878 --no-open`、
`Restart=always`。端口 `7878` 就是这里的默认值（服务器上 `8787` 已被 frps 占用）。

> 后台**没有任何认证**：谁能连上 7878，谁就能改文件、删文章、触发 git 提交。
> 所以永远保持 `--host 127.0.0.1`，并且**不要**在 nginx 里给它加 `proxy_pass`。
> 从外面访问走 SSH 隧道：`ssh -L 7878:127.0.0.1:7878 admin@<服务器>`。

> 服务端仓库用 `https://` 远程且没有凭证，**「发布」按钮在服务器上会 push 失败**
> （`git add` / `commit` 会成功，但推不上去，还留下一个没推的本地提交）。
> 提交和推送在本地做，服务器只负责保存与展示。

## 界面能做什么

| 功能 | 说明 |
| --- | --- |
| 新建文章 | 右上角「＋ 新建文章」，填标题 → 保存，文件名默认 `<日期>-<标题>.html` |
| 修改文章 | 左侧点选文章 → 改内容 → 保存（Ctrl+S）；改文件名 = 重命名文件 |
| 删除文章 | 「删除」按钮，二次确认后从磁盘移除 |
| 草稿 | 勾选后不出现在列表页，并在文章里写入 `noindex` |
| 图片 | 「图片」按钮 / 直接粘贴截图 / 拖拽图片到编辑区，自动存到 `blog/images/` 并插入语法 |
| 预览 | 「预览」按钮，右侧实时渲染成最终页面样式 |
| 重建索引 | 根据 `blog/` 目录重新生成 `blog.html`（保存时会自动执行） |
| 发布 | `git add blog blog.html` → `git commit` → `git push`，推送后 GitHub Pages 自动更新 |

快捷键：`Ctrl+S` 保存、`Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+K` 链接、`Tab` 缩进。

## 正文格式

默认 **Markdown**，保存时渲染成 HTML 写进文章页，同时把 Markdown 原文放在
`<template id="blog-source">` 里，所以以后还能接着改，不会丢源码。

- 支持：标题、**粗体**、*斜体*、~~删除线~~、`行内代码`、代码块、引用、有序/无序列表、分隔线、链接、图片
- 单个换行渲染为 `<br>`（对中文更友好）
- 可以直接写原始 HTML（`<img>`、`<div>` 等）
- 老的 HTML 文章会被识别为 **HTML 模式**，原样保留，不会被改写

HTML 模式下工具栏会插入对应的 HTML 标签。

## 文章文件长这样

`blog/2026-09-15-hello.html`：

```html
<head>
  <title>标题 | CarryWS</title>
  <meta name="description" content="摘要，列表页显示这段">
  <meta name="keywords" content="标签1, 标签2">
  <meta name="post-date" content="2026-09-15">
  <meta name="author" content="CarryWS">
  ...
</head>
<body>
  <p><a href="/blog.html">← Back</a></p>
  <h1>标题</h1>
  <p class="date">2026-09-15</p>

  …渲染好的正文…

  <template id="blog-source">…Markdown 原文…</template>
</body>
```

元信息都写在 HTML 里，没有独立的数据库 / JSON 索引文件，
所以手工新建的 HTML 文件同样能被 `blog.html` 收录。

## 命令行用法

不想开浏览器时：

```bash
node tools/blog-admin/cli.js list
node tools/blog-admin/cli.js new "文章标题" --tags 折腾,docker --content draft.md
node tools/blog-admin/cli.js show 2026-09-15-hello.html
node tools/blog-admin/cli.js delete 2026-09-15-hello.html
node tools/blog-admin/cli.js build
```

## 测试

```bash
node --test tools/blog-admin/test/blog.test.js
```

## 目录结构

```
tools/blog-admin/
├── server.js          本地 HTTP 服务 + REST API（/admin/api/*）
├── cli.js             命令行工具
├── start.sh / .bat    启动脚本
├── lib/
│   ├── posts.js       文章解析、创建、修改、删除、索引生成
│   └── markdown.js    极简 Markdown 渲染器
├── public/            后台前端（index.html / app.js / style.css）
└── test/blog.test.js  单元测试
```

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/api/status` | 站点路径、git 分支与改动数 |
| GET | `/admin/api/posts` | 文章列表（含元信息） |
| GET | `/admin/api/posts/:slug` | 读取单篇（含正文） |
| POST | `/admin/api/posts` | 新建 |
| PUT | `/admin/api/posts/:slug` | 修改（`slug` 变化即重命名文件） |
| DELETE | `/admin/api/posts/:slug` | 删除 |
| POST | `/admin/api/preview` | 渲染预览 HTML |
| POST | `/admin/api/upload` | 上传图片（base64 dataURL） |
| GET | `/admin/api/images` | 图片列表 |
| POST | `/admin/api/build` | 重建 `blog.html` |
| POST | `/admin/api/publish` | git add / commit / push |

## 说明

- 每次保存/删除都会**自动重建** `blog.html`；这个文件是生成物，别手工改了。
- `blog.html.bak` 是早期的旧版备份，工具不会动它。
- 发布接口只会提交 `blog/` 和 `blog.html`；工具本身的改动请自己 `git add tools/` 后单独提交。
- 想撤销误删：文件已被 git 跟踪的话，`git checkout -- blog/<文件名>` 就能找回。
