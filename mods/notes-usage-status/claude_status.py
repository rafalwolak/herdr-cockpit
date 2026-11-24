"""Publish Claude's statusLine metrics to its Herdr terminal, then run the user's renderer."""

import fcntl
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


def percentage(value):
    if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100:
        return value
    return None


def metrics(data):
    ctx = data.get("context_window") or {}
    left = percentage(ctx.get("remaining_percentage"))
    used = percentage(ctx.get("used_percentage"))
    if left is None and used is not None:
        left = 100 - used
    size = ctx.get("context_window_size")
    windows = []
    for field, label in (("five_hour", "5h"), ("seven_day", "Weekly")):
        w = (data.get("rate_limits") or {}).get(field) or {}
        used = percentage(w.get("used_percentage"))
        if used is not None:
            reset = w.get("resets_at")
            windows.append({"label": label, "left": 100 - used,
                            "reset": reset if type(reset) in (int, float) and reset > 0 else None})
    return {"left": left, "size": size if type(size) is int and size > 0 else None, "windows": windows}


def publish(raw):
    terminal = os.environ.get("HC_TERMINAL_ID", "")
    if not re.fullmatch(r"t[0-9a-z]+", terminal):
        return
    data = json.loads(raw)
    session = data.get("session_id")
    hc = shutil.which("hc") or str(Path.home() / ".local/bin/hc")
    if not session:
        return
    values = metrics(data)
    cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "herdr-notes-usage"
    cache.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (cache / terminal).open("a+") as stamp:
        fcntl.flock(stamp, fcntl.LOCK_EX)
        stamp.seek(0)
        signature = json.dumps([session, os.getppid(), values], separators=(",", ":"))
        if stamp.read() == signature and time.time() - os.fstat(stamp.fileno()).st_mtime < 60:
            return
        result = subprocess.run([hc, "get", terminal, "--json"], check=True,
                                capture_output=True, timeout=1)
        info = json.loads(result.stdout)
        process = info.get("foreground") or {}
        pid = process.get("pid")
        if not pid:
            return
        registry = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "sessions" / f"{pid}.json"
        if registry.is_file():
            if json.loads(registry.read_text()).get("sessionId") != session:
                return
        elif process.get("name") != "claude":
            return
        label = "notes.claude-usage"
        encoded = json.dumps(dict(values, pid=pid), separators=(",", ":"), allow_nan=False)
        if (info.get("labels") or {}).get(label) != encoded:
            subprocess.run([hc, "label", terminal, f"{label}={encoded}"], check=True,
                           capture_output=True, timeout=1)
        stamp.seek(0)
        stamp.truncate()
        stamp.write(signature)


if __name__ == "__main__":
    raw = sys.stdin.buffer.read()
    try:
        publish(raw)
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
        # A closed Herdr terminal must not interrupt Claude's original status line.
        pass
    if len(sys.argv) > 1:
        sys.exit(subprocess.run(["/bin/sh", "-c", sys.argv[1]], input=raw).returncode)
