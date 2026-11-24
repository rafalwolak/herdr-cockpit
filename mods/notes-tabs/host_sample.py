"""One read-only host sample for the Notes toolbar."""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path


def output(*argv):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=3,
                            env=dict(os.environ, LC_ALL="C"))
    return result.stdout if result.returncode == 0 else ""


def linux_network():
    routes = (line.split() for line in Path("/proc/net/route").read_text().splitlines()[1:])
    defaults = sorted((int(r[6]), r[0]) for r in routes
                      if len(r) >= 8 and r[1] == "00000000" and int(r[3], 16) & 1)
    if defaults:
        name = defaults[0][1]
    else:
        ipv6 = Path("/proc/net/ipv6_route")
        if not ipv6.exists():
            return None
        name = next((r[-1] for line in ipv6.read_text().splitlines() if (r := line.split())
                     and r[:2] == ["0" * 32, "00"] and r[-1] != "lo"), None)
        if not name:
            return None
    base = Path("/sys/class/net") / name / "statistics"
    return [name, int((base / "rx_bytes").read_text()), int((base / "tx_bytes").read_text())]


def linux():
    cpu = [int(v) for v in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]
    mem = {k: int(v) * 1024 for k, v in re.findall(r"^(\w+):\s+(\d+) kB", Path("/proc/meminfo").read_text(), re.M)}
    available = mem.get("MemAvailable", mem["MemFree"] + mem.get("Cached", 0) + mem.get("Buffers", 0))
    try:
        net = linux_network()
    except OSError:
        net = None
    return dict(cpu=[sum(cpu), cpu[3] + cpu[4]], memory=[mem["MemTotal"] - available, mem["MemTotal"]],
                swap=[mem["SwapTotal"] - mem["SwapFree"], mem["SwapTotal"]], network=net,
                uptime=float(Path("/proc/uptime").read_text().split()[0]))


def mac_cpu():
    import ctypes as c
    lib = c.CDLL("/usr/lib/libSystem.B.dylib")
    ticks = (c.c_uint32 * 4)()
    count = c.c_uint32(4)
    # HOST_CPU_LOAD_INFO reports user, system, idle and nice clock ticks.
    status = lib.host_statistics(lib.mach_host_self(), 3, ticks, c.byref(count))
    return [sum(ticks), ticks[2]] if status == 0 and count.value == 4 else None


def mac_network():
    route = output("/sbin/route", "-n", "get", "default")
    match = re.search(r"^\s*interface:\s*(\S+)", route, re.M)
    if not match:
        return None
    name = match[1]
    lines = output("/usr/sbin/netstat", "-ibnI", name).splitlines()
    if not lines:
        return None
    header = lines[0].split()
    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 3 or not fields[2].startswith("<Link#"):
            continue
        # Align from the right; tunnel interfaces have an empty address column.
        return [name, int(fields[header.index("Ibytes") - len(header)]),
                int(fields[header.index("Obytes") - len(header)])]
    return None


def mac():
    total, swap_info, boot = output("/usr/sbin/sysctl", "-n", "hw.memsize", "vm.swapusage", "kern.boottime").splitlines()
    vm = output("/usr/bin/vm_stat")
    page = re.search(r"page size of (\d+) bytes", vm)
    pages = dict(re.findall(r"^([^:\n]+):\s+(\d+)\.", vm, re.M))
    fields = ("Pages active", "Pages wired down", "Pages occupied by compressor")
    used = sum(int(pages[k]) for k in fields) * int(page[1]) if page and all(k in pages for k in fields) else None
    units = {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}
    swap = {k: int(float(v) * units[u]) for k, v, u in re.findall(r"(used|total)\s*=\s*([\d.]+)([KMGT])", swap_info)}
    start = re.search(r"sec\s*=\s*(\d+)", boot)
    return dict(cpu=mac_cpu(), memory=[min(used, int(total)), int(total)] if used is not None else None,
                swap=[swap["used"], swap["total"]] if {"used", "total"} <= swap.keys() else None,
                uptime=time.time() - int(start[1]) if start else None, network=mac_network())


def sample():
    if sys.platform == "darwin":
        data = mac()
        system = "macOS"
    elif sys.platform.startswith("linux"):
        data = linux()
        system = "Linux"
    else:
        raise SystemExit("This host requires macOS or Linux.")
    disk = shutil.disk_usage(Path.home())
    return dict(data, system=system, host=platform.node(), cores=os.cpu_count(), clock=time.monotonic(),
                load=os.getloadavg(), disk=[disk.used, disk.free])


if __name__ == "__main__":
    print(json.dumps(sample(), separators=(",", ":"), allow_nan=False))
