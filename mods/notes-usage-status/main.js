// Adapted from Herdr's workspace status bar to show the focused agent's usage.
import { View, div, svg } from "gpui-kit";
import { h_flex, Popover } from "gpui-base";
import { spaces, agents, theme, run, window, keys, focused, panes, terminals, appHome, checking, exec, hc, readTextFile, shared, setShared } from "herdr";
import { activeAddress, claudeLabel, contextText, countdown, limitTone, provider, quotaWindows, readFooter } from "./usage.js";
import { recordHistory, sessionKey, usageSample } from "./history.js";
import { usageDetails } from "./details.js";

const contextsKey = "notes.usage.contexts";

function targets() {
  const all = terminals();
  const byAddress = new Map(all.map(t => [t.address, t]));
  const visible = new Map(agents().map(a => [a.address, a]));
  const focus = focused();
  const direct = focus?.shown ?? focus?.terminal;
  if (direct && !visible.has(direct)) {
    const pane = panes().find(p => p.terminal === direct);
    if (provider(pane, byAddress.get(direct))) visible.set(direct, { ...pane, address: direct, tab: focus.tab });
  }
  const result = new Map();
  for (const t of all) {
    if (t.state !== "live") continue;
    let parent = t;
    const visited = new Set();
    while (parent && !visible.has(parent.address) && !visited.has(parent.address)) {
      visited.add(parent.address);
      parent = byAddress.get(parent.parent);
    }
    const agent = visible.get(parent?.address);
    if (!agent) continue;
    const name = provider(visible.get(t.address), t);
    if (name) result.set(t.address, { address: t.address, tab: agent.tab, name, term: t,
      machine: t.address.includes("/") ? t.address.split("/")[0] : null });
  }
  return result;
}

async function core(args) {
  const r = await hc(args);
  return r.code === 0 ? JSON.parse(r.stdout) : null;
}

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.readings = new Map();
    this.accounts = new Map();
    this.targets = new Map();
    try { this.history = JSON.parse(localStorage.getItem("hourly-usage") ?? "{}"); }
    catch { this.history = {}; }
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(10000, next => this.refresh(next));
  }

  async codex(machine, args) {
    const path = appHome() + "/mods/notes-usage-status/codex_usage.py";
    let argv = [path, ...args];
    if (machine) {
      this.source ??= await readTextFile(path);
      if (!this.source) return null;
      argv = ["-c", this.source, ...args];
    }
    const r = await exec("python3", argv, { on: machine, timeout: 9000 });
    return r.code === 0 ? JSON.parse(r.stdout) : null;
  }

  async sample(target) {
    const { address, name, machine } = target;
    let term = target.term;
    if (!term.foreground?.pid) term = await core(["get", address, "--json"]) ?? term;
    const pid = term.foreground?.pid ?? term.pid;
    const chat = term.labels?.["herdr-chat.chat"];
    let usage = name === "Claude Code" ? claudeLabel(term) : null;
    if (!usage && name === "Codex" && chat) {
      usage = await this.codex(machine, ["chat", chat, address.split("/").pop()]);
    }
    if (!usage && !chat) {
      const screen = await core(["read", address, "--json"]);
      usage = readFooter(name, screen?.text ?? "");
    }
    const previous = this.readings.get(address);
    if (!usage && previous?.pid === pid && previous.name === name && Date.now() - previous.at < 60000) return previous;
    return { pid, name, usage, at: Date.now() };
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (next) => {
      try {
        const list = targets();
        this.targets = list;
        const now = Date.now();
        const machines = new Set([...list.values()].filter(a => a.name === "Codex" && !a.term.labels?.["herdr-chat.chat"]).map(a => a.machine));
        const accounts = [...machines].map(async machine => {
          const last = this.accounts.get(machine);
          if (last && now - last.at < (last.windows.length ? 120000 : 30000)) return;
          const windows = await this.codex(machine, ["account"]).catch(() => null);
          this.accounts.set(machine, { at: now, windows: Array.isArray(windows) ? windows : [] });
        });
        const samples = [...list.values()].map(async a => [a.address, await this.sample(a).catch(() => null)]);
        this.readings = new Map(await Promise.all(samples));
        const contexts = {};
        for (const [addr, r] of this.readings) {
          const caption = contextText(r?.usage);
          if (caption) contexts[addr] = { caption, pid: r.pid, tone: limitTone(r.usage.left) };
        }
        if (JSON.stringify(shared(contextsKey) ?? {}) !== JSON.stringify(contexts)) setShared(contextsKey, contexts);
        next.notify();
        await Promise.all(accounts);
        const minute = Math.floor(Date.now() / 60000);
        const minuteReadings = [];
        for (const target of list.values()) {
          const reading = this.readings.get(target.address);
          minuteReadings.push([sessionKey(target, reading), usageSample(minute, reading?.usage, this.windows(target, reading))]);
        }
        const history = recordHistory(this.history, minuteReadings, minute);
        if (JSON.stringify(history) !== JSON.stringify(this.history)) {
          this.history = history;
          localStorage.setItem("hourly-usage", JSON.stringify(history));
        }
        next.notify();
      } finally {
        this.busy = false;
      }
    });
  }

  windows(target, reading) {
    const account = target.name === "Codex" && !target.term.labels?.["herdr-chat.chat"] ? this.accounts.get(target.machine)?.windows : null;
    return quotaWindows(reading?.usage, account, Date.now() / 1000);
  }

  meter(t) {
    const focus = focused();
    const openTarget = this.targets.get(this.detailAddress);
    const address = openTarget && !focus?.shown && !focus?.terminal && openTarget.tab === focus?.tab
      ? openTarget.address : activeAddress(focus, this.targets);
    if (this.detailAddress && this.detailAddress !== address) this.detailAddress = null;
    const target = this.targets.get(address);
    if (!target) return div().flex_1();
    const r = this.readings.get(address);
    const now = Date.now() / 1000;
    const wins = this.windows(target, r);
    const parts = [{ text: target.name }];
    const ctx = contextText(r?.usage);
    if (ctx) parts.push({ text: ctx, tone: limitTone(r.usage.left) });
    for (const w of wins) {
      const left = w.label + " " + Math.round(w.left) + "% left";
      parts.push({ text: left, tone: limitTone(w.left) });
      if (w.reset) {
        parts.push({ text: "resets in " + countdown(w.reset - now) });
      } else if (w.reportedIn) {
        parts.push({ text: "reset in " + w.reportedIn });
      }
    }
    if (parts.length === 1) parts.push({ text: "Usage pending" });
    const elements = [];
    for (const part of parts) {
      if (elements.length) elements.push(div().flex_none().text_color(t.dim).child("·"));
      elements.push(div().flex_none().whitespace_nowrap().text_color(t[part.tone] ?? t.muted)
        .when(Boolean(part.tone), el => el.font_semibold()).child(part.text));
    }
    const trigger = h_flex().id("focused-agent-usage").min_w(0).h(22).px(4).rounded(5).overflow_hidden()
      .items_center().gap(5).cursor_pointer().hover(s => s.bg(t.hover))
      .tooltip("Show usage details").children(elements);
    const key = sessionKey(target, r);
    const open = this.detailAddress === address;
    const popover = Popover.new("usage-details-" + address).anchor("bottom_left").open(open)
      .on_open_change((show, cx) => {
        this.detailAddress = show ? address : null;
        if (show) this.historyMetric = null;
        cx.notify();
      }).trigger(trigger);
    popover.content(open ? usageDetails(t, target, r, wins, this.history[key] ?? [], this.historyMetric,
      metric => { this.historyMetric = metric; }) : div());
    return h_flex().flex_1().min_w(0).items_center().child(popover);
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(this.meter(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
