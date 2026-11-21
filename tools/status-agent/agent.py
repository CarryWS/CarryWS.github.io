#!/usr/bin/env python3
"""Collect local host metrics + Minecraft status and push them to carryws.xyz.

The website's /api/status serves /var/lib/status-push/status.json, which is
written by the receiver at https://carryws.xyz/api/status/push.  This agent is
the producer side and is meant to run as a systemd service on the machine that
hosts the Minecraft server (Server B).

Environment:
    STATUS_PUSH_TOKEN   shared token (required)
    STATUS_PUSH_URL     receiver URL (default: https://carryws.xyz/api/status/push)
    MC_HOST             Minecraft host (default: 127.0.0.1)
    MC_PORT             Minecraft port (default: 25565)
    INTERVAL            seconds between pushes (default: 30)
"""

import json
import os
import socket
import struct
import sys
import time
import urllib.request

PUSH_URL = os.environ.get("STATUS_PUSH_URL", "https://carryws.xyz/api/status/push")
TOKEN = os.environ.get("STATUS_PUSH_TOKEN", "").strip()
MC_HOST = os.environ.get("MC_HOST", "127.0.0.1")
MC_PORT = int(os.environ.get("MC_PORT", "25565"))
INTERVAL = max(10, int(os.environ.get("INTERVAL", "30")))

THERMAL = "/sys/class/thermal/thermal_zone0/temp"


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


# ---------- host metrics ----------

def read_cpu_times():
    with open("/proc/stat") as f:
        parts = f.readline().split()
    # user nice system idle iowait irq softirq steal guest guest_nice
    values = [int(x) for x in parts[1:9]]
    idle = values[3] + values[4]
    return idle, sum(values)


class CpuSampler:
    def __init__(self):
        self.prev = read_cpu_times()

    def percent(self):
        idle, total = read_cpu_times()
        d_idle = idle - self.prev[0]
        d_total = total - self.prev[1]
        self.prev = (idle, total)
        if d_total <= 0:
            return 0.0
        return round(100.0 * (1.0 - d_idle / d_total), 1)


def read_mem():
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, _, rest = line.partition(":")
            info[key] = int(rest.split()[0])  # kB
    total_kb = info.get("MemTotal", 0)
    avail_kb = info.get("MemAvailable", info.get("MemFree", 0))
    total_gb = round(total_kb / 1024 / 1024, 1)
    percent = round(100.0 * (total_kb - avail_kb) / total_kb, 1) if total_kb else 0.0
    return {"percent": percent, "total_gb": total_gb}


def read_uptime():
    with open("/proc/uptime") as f:
        return int(float(f.readline().split()[0]))


def read_temp():
    try:
        with open(THERMAL) as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except (OSError, ValueError):
        return None


# ---------- Minecraft server list ping ----------

def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _read_varint(buf, pos):
    value = 0
    for i in range(5):
        b = buf[pos]
        pos += 1
        value |= (b & 0x7F) << (7 * i)
        if not b & 0x80:
            return value, pos
    raise ValueError("varint too long")


def _recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("connection closed")
        data += chunk
    return data


def _motd_text(description):
    if isinstance(description, str):
        return description
    if isinstance(description, dict):
        text = description.get("text", "")
        for extra in description.get("extra", []) or []:
            text += _motd_text(extra)
        return text
    return ""


def mc_status():
    """Query the local Minecraft server with the Server List Ping protocol."""
    offline = {"online": False, "players": 0, "max": 0, "version": "", "motd": ""}
    host_b = MC_HOST.encode()
    try:
        with socket.create_connection((MC_HOST, MC_PORT), timeout=4) as s:
            s.settimeout(4)
            # protocol 767 (1.21) is accepted by Paper for status requests
            handshake = b"".join([
                _varint(0),
                _varint(767),
                _varint(len(host_b)), host_b,
                struct.pack(">H", MC_PORT),
                _varint(1),  # next state: status
            ])
            s.sendall(_varint(len(handshake)) + handshake)
            s.sendall(_varint(1) + _varint(0))  # status request

            # read packet length (1-5 byte varint)
            header = s.recv(1)
            if not header:
                raise ConnectionError("no response")
            buf = header
            while header[0] & 0x80:
                header = s.recv(1)
                if not header:
                    raise ConnectionError("truncated length")
                buf += header
            length, _ = _read_varint(buf, 0)

            payload = _recv_exact(s, length)
            _, pos = _read_varint(payload, 0)          # packet id
            slen, pos = _read_varint(payload, pos)     # json string length
            data = json.loads(payload[pos:pos + slen].decode("utf-8", "replace"))

        players = data.get("players") or {}
        return {
            "online": True,
            "players": int(players.get("online", 0) or 0),
            "max": int(players.get("max", 0) or 0),
            "version": str((data.get("version") or {}).get("name", "") or ""),
            "motd": _motd_text(data.get("description")),
        }
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ConnectionError) as exc:
        log("minecraft ping failed: %s" % exc)
        return offline


# ---------- push ----------

def collect(cpu_sampler):
    payload = {
        "cpu": cpu_sampler.percent(),
        "mem": read_mem(),
        "uptime": read_uptime(),
        "temp": read_temp(),
        "mc": mc_status(),
        "ts": int(time.time()),
    }
    return payload


def push(payload):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        PUSH_URL,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Token": TOKEN,
            "User-Agent": "carryws-status-agent/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError("unexpected HTTP %s" % resp.status)


def main():
    if not TOKEN:
        log("STATUS_PUSH_TOKEN is empty, refusing to start")
        return 2

    once = "--once" in sys.argv
    cpu_sampler = CpuSampler()
    log("agent started: push=%s mc=%s:%s interval=%ss" % (PUSH_URL, MC_HOST, MC_PORT, INTERVAL))
    time.sleep(1)  # let the first CPU sample cover a real interval

    failures = 0
    while True:
        try:
            payload = collect(cpu_sampler)
            push(payload)
            if failures or once:
                log("push ok: cpu=%s%% mem=%s%% temp=%s mc=%s/%s" % (
                    payload["cpu"], payload["mem"]["percent"], payload["temp"],
                    payload["mc"]["players"], payload["mc"]["max"]))
            failures = 0
        except Exception as exc:  # keep the loop alive on transient network errors
            failures += 1
            log("push failed (%d): %s" % (failures, exc))
        if once:
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
