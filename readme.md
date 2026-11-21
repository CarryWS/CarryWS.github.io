# CarryWS的个人主页源码仓库
个人主页，使用github pages部署（最早是这样）
不过现在有了自己的域名：https://carryws.xyz，所以本仓库的GitHub Pages部署没用了，会根据CNAME自动跳转至该域名。
本仓库尽量保持版本与该域名的版本相同。（不过我有时也会忘了git push）
## 写博客

博客文章放在 `blog/`，列表页是 `blog.html`。用自带的本地后台来写：

```bash
./tools/blog-admin/start.sh      # Windows: tools\blog-admin\start.bat
```

浏览器会自动打开 http://127.0.0.1:7878/admin/ ，可以新建/修改/删除文章、上传图片、
实时预览、一键 git 发布，保存时自动重建 `blog.html`。

命令行版本：`node tools/blog-admin/cli.js list|new|delete|build`。
详细说明见 [tools/blog-admin/README.md](tools/blog-admin/README.md)。