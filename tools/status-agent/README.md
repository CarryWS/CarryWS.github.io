# status-agent

首页左下角「Local Server CPU / Minecraft Server」的数据链路：

```
Server B (M720Q, 运行 mc-paper)
  /opt/status-push/agent.py  ──POST /api/status/push (X-Token)──▶  carryws.xyz (nginx)
                                                                      │
                                                          127.0.0.1:8899 (receiver.py)
                                                                      │
                                                      /var/lib/status-push/status.json
                                                                      │
                                                          GET /api/status (nginx alias)
                                                                      │
                                                              index.html 轮询
```

之前采集脚本是手工跑的，Server B 重启后就没了，`status.json` 停在最后一次推送，
页面便把 MC 一直显示成 offline。现在 agent 由 systemd 托管，开机自启、崩溃自动重启。

## 部署（Server B）

```bash
sudo mkdir -p /opt/status-push
sudo install -m 0755 agent.py /opt/status-push/agent.py

# token 与站点 /etc/status-push.token 保持一致，权限 600 root
sudo install -m 0600 /dev/null /etc/status-push.env
sudo tee /etc/status-push.env >/dev/null <<'EOF'
STATUS_PUSH_URL=https://carryws.xyz/api/status/push
STATUS_PUSH_TOKEN=<token>
MC_HOST=127.0.0.1
MC_PORT=25565
INTERVAL=30
EOF

sudo install -m 0644 status-agent.service /etc/systemd/system/status-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now status-agent
```

## 验证

```bash
sudo systemctl status status-agent --no-pager
sudo journalctl -u status-agent -n 20 --no-pager
curl -s https://carryws.xyz/api/status | python3 -m json.tool
```

`ts` 应该接近当前时间，`mc.online` 应为 `true`。

## 前端字段

`cpu`(number) · `mem.percent` · `mem.total_gb` · `uptime`(s) · `temp`(°C) ·
`mc.online` · `mc.players` · `mc.max` · `mc.version` · `mc.motd` · `ts`(unix s)
