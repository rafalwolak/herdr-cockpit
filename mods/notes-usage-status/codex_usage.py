"""Read Codex account windows or a Herdr Chat host's own rollout."""

import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import time


def windows(snapshot, duration, used, reset):
    result = []
    for key in ("primary", "secondary"):
        data = snapshot.get(key) or {}
        label = {300: "5h", 10080: "Weekly"}.get(data.get(duration))
        value = data.get(used)
        if label and type(value) in (int, float) and 0 <= value <= 100:
            result.append({"label": label, "left": 100 - value, "reset": data.get(reset)})
    return result


def read_account():
    codex = shutil.which("codex")
    if not codex:
        return []
    with subprocess.Popen([codex, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, bufsize=0) as proc:
        buffer = b""
        def send(request):
            proc.stdin.write(json.dumps(request).encode() + b"\n")

        try:
            send({"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "herdr_notes_usage", "version": "1"}, "capabilities": {}}})
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if b"\n" not in buffer:
                    if not select.select([proc.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                        break
                    chunk = os.read(proc.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    buffer += chunk
                    continue
                line, buffer = buffer.split(b"\n", 1)
                reply = json.loads(line)
                if reply.get("id") == 1 and "result" in reply:
                    send({"method": "initialized"})
                    send({"id": 2, "method": "account/rateLimits/read"})
                if reply.get("id") == 2:
                    result = reply.get("result") or {}
                    view = (result.get("rateLimitsByLimitId") or {}).get("codex") or result.get("rateLimits") or {}
                    return windows(view, "windowDurationMins", "usedPercent", "resetsAt")
            return []
        finally:
            proc.stdin.close()
            try:
                proc.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                proc.kill()


def chat_usage(chat, terminal):
    if not chat or Path(chat).name != chat:
        return None
    root = Path(os.environ.get("HERDR_APP_HOME") or Path.home() / ".config/herdr-app")
    reg = json.loads((root / "data/herdr-chat/chats" / (chat + ".json")).read_text())
    if reg.get("provider") != "codex" or (reg.get("terminal") and reg["terminal"] != terminal):
        return None
    path = Path(reg.get("sessionFile") or "")
    if not (path.name.startswith("rollout-") and path.suffix == ".jsonl"):
        return None
    with path.open("rb") as stream:
        start = max(0, stream.seek(0, 2) - 8 * 1024 * 1024)
        stream.seek(start)
        if start:
            stream.readline()
        for line in reversed(stream.read().splitlines()):
            if b'"token_count"' not in line:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                continue
            data = event.get("payload") or {}
            if event.get("type") != "event_msg" or data.get("type") != "token_count":
                continue
            info = data.get("info") or {}
            size = info.get("model_context_window")
            used = (info.get("last_token_usage") or {}).get("total_tokens")
            left = max(0, min(100, (1 - used / size) * 100)) if size and used is not None else None
            quota = data.get("rate_limits") or {}
            return {"left": left, "size": size, "windows":
                    windows(quota, "window_minutes", "used_percent", "resets_at")
                    if quota.get("limit_id") in (None, "codex") else []}
    return None


if __name__ == "__main__":
    try:
        result = read_account() if sys.argv[1] == "account" else chat_usage(*sys.argv[2:4])
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        result = None
    print(json.dumps(result, allow_nan=False))
