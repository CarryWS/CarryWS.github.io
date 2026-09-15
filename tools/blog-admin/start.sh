#!/usr/bin/env bash
# 启动本地博客后台
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node tools/blog-admin/server.js "$@"
