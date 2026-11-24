import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { recordHistory, usageSample } from "../mods/notes-usage-status/history.js";
import { claudeLabel, limitTone, quotaWindows, readFooter } from "../mods/notes-usage-status/usage.js";

const mods = new URL("../mods/", import.meta.url);
const unixHost = ["darwin", "linux"].includes(process.platform);

function loadNativeMod(file, exports, bindings = {}) {
  const source = readFileSync(new URL(file, mods), "utf8")
    .replace(/^import .*;$/gm, "").replace(/^export (?:default )?/gm, "");
  return Function(...Object.keys(bindings), source + "\nreturn { " + exports.join(", ") + " };")(...Object.values(bindings));
}

test("nested groups keep their machine, members and order when a parent is removed", () => {
  let stored;
  const g = loadNativeMod("notes-space-groups/groups.js", ["assign", "create", "load", "nest", "prune", "remove", "toggle", "tree"], {
    shared: () => structuredClone(stored),
    setShared: (_key, value) => { stored = structuredClone(value); },
    spaces: () => [],
    machines: () => [{ name: null, layout: "ready" }, { name: "remote", layout: "unavailable" }],
  });
  const root = g.create("Projects", null);
  const team = g.create("Team", null, root);
  const app = g.create("App", null, team);
  const remote = g.create("Builds", "remote");
  g.assign("s1", team);
  g.assign("remote/s2", remote);
  g.nest(root, app);
  g.nest(team, remote);
  g.toggle(team);
  assert.deepEqual(g.tree(g.load(), null).map(({ g, depth }) => [g.name, depth, g.folded]), [
    ["Projects", 0, false], ["Team", 1, true], ["App", 2, false],
  ]);
  g.remove(team);
  assert.equal(g.load().groups.find(group => group.id === app).parent, root);
  assert.equal(g.load().spaces.s1, root);
  g.prune();
  assert.deepEqual(g.load().spaces, { "remote/s2": remote });
});

test("stock terminal peek works with chat labels and the chat layout opens its own overlay", () => {
  let menu;
  const opened = [];
  const { ChatAgents } = loadNativeMod("notes-usage-agents/main.js", ["ChatAgents"], {
    Agents: class { peek(address) { opened.push(address); } },
    terminals: () => [{ address: "t1", labels: { "herdr-chat.chat": "demo" } }],
    layout: () => ({ terminal_menu: menu }),
    run: () => {}, openOverlay: options => opened.push(options.mod),
  });
  const list = new ChatAgents();
  list.peek("t1");
  menu = "chat-menu";
  list.peek("t1");
  list.peek("t2");
  assert.deepEqual(opened, ["t1", "chat", "t2"]);
});

test("Codex footers preserve remaining limits and only use reset times from matching reports", () => {
  const footer = readFooter("Codex", "Context 8% used · 5h 10% left\n · weekly 80% used · 258K window");
  assert.equal(footer.left, 92);
  assert.equal(footer.size, 258000);
  const five = { label: "5h", left: 10, reset: 400 };
  const week = { label: "Weekly", left: 21, reset: 700 };
  assert.deepEqual(quotaWindows(footer, [five, week], 300), [five, { label: "Weekly", left: 20, reset: null }]);
  assert.deepEqual(quotaWindows(null, [five, week], 400), [week]);
  assert.deepEqual([10, 20, 21].map(limitTone), ["ansi1", "ansi3", null]);
});

test("a Claude label only supplies reset times to its own process", () => {
  const data = { pid: 12, left: 75, size: 200000, windows: [{ label: "5h", left: 30, reset: 800 }] };
  const labels = { "notes.claude-usage": JSON.stringify(data) };
  assert.equal(claudeLabel({ foreground: { pid: 13 }, labels }), null);
  assert.deepEqual(claudeLabel({ foreground: { pid: 12 }, labels }).windows, data.windows);
  const footer = readFooter("Claude Code", "25% | 50k / 200k | Duration: 1h\n5h: 70% - T-2h | 7d: 15%");
  assert.equal(footer.left, 75);
  assert.deepEqual(footer.windows.map(w => [w.label, w.left, w.reportedIn]), [["5h", 30, "2h"], ["Weekly", 85, null]]);
});

test("history merges readings in one minute and expires entries after one hour", () => {
  const first = usageSample(0, { left: 60 }, []);
  const quota = usageSample(0, null, [{ label: "Weekly", left: 80 }]);
  let history = recordHistory({}, [["a", first]], 0);
  history = recordHistory(history, [["a", quota]], 0);
  assert.deepEqual(history.a, [{ minute: 0, context: 40, fiveHour: null, weekly: 20 }]);
  assert.deepEqual(recordHistory(history, [], 59), history);
  assert.deepEqual(recordHistory(history, [], 60), {});
});

test("host samples use elapsed time and discard stale or switched network counters", () => {
  const { measure } = loadNativeMod("notes-tabs/host-vitals.js", ["measure"]);
  const base = { clock: 20, cpu: [100, 60], network: ["eth0", 10000, 3000] };
  const next = { clock: 25, cpu: [200, 130], network: ["eth0", 11000, 3500], memory: [40, 100], swap: [0, 0], disk: [30, 70] };
  const reading = measure(next, base);
  assert.deepEqual([reading.cpu, reading.mem, reading.swap, reading.disk], [30, 40, null, 30]);
  assert.deepEqual(reading.network, [200, 100]);
  assert.equal(measure(next, null).cpu, null);
  assert.equal(measure({ ...next, clock: 125 }, base).network, null);
  assert.equal(measure({ ...next, network: ["eth1", 11000, 3500] }, base).network, null);
});

test("the host sampler returns CPU, memory and disk counters", { skip: !unixHost }, () => {
  const script = fileURLToPath(new URL("notes-tabs/host_sample.py", mods));
  const result = spawnSync("python3", [script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.ok(data.clock > 0 && data.cpu[0] >= data.cpu[1]);
  assert.ok(data.memory[1] > 0 && data.memory[0] <= data.memory[1]);
  assert.ok(data.disk[0] >= 0 && data.disk[1] >= 0);
});

test("the Claude bridge publishes only metrics and preserves an existing renderer", { skip: !unixHost }, t => {
  const dir = mkdtempSync(join(tmpdir(), "cockpit-status-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "label");
  writeFileSync(join(dir, "hc"), [
    "#!/bin/sh",
    "case \"$1\" in",
    "  get) echo '{\"foreground\":{\"pid\":42,\"name\":\"claude\"}}' ;;",
    "  label) printf '%s' \"$3\" > \"$LABEL_OUT\" ;;",
    "esac",
  ].join("\n"), { mode: 0o700 });
  const env = { ...process.env, PATH: dir + ":" + process.env.PATH, XDG_CACHE_HOME: dir,
    CLAUDE_CONFIG_DIR: dir, HC_TERMINAL_ID: "t1", LABEL_OUT: log };
  const input = JSON.stringify({ session_id: "sample", workspace: { current_dir: "/demo" },
    context_window: { used_percentage: 15, context_window_size: 200000 },
    rate_limits: { five_hour: { used_percentage: 60, resets_at: 900 } } });
  const script = fileURLToPath(new URL("notes-usage-status/claude_status.py", mods));
  const invoke = args => spawnSync("python3", [script, ...args], { env, input, encoding: "utf8", timeout: 5000 });
  const plain = invoke([]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, "");
  const label = readFileSync(log, "utf8");
  assert.equal(label.split("=")[0], "notes.claude-usage");
  assert.deepEqual(JSON.parse(label.slice(label.indexOf("=") + 1)), {
    left: 85, size: 200000, pid: 42, windows: [{ label: "5h", left: 40, reset: 900 }],
  });
  const rendered = invoke(["cat; exit 7"]);
  assert.equal(rendered.stdout, input);
  assert.equal(rendered.status, 7);
});
