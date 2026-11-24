import { div, svg } from "gpui-kit";
import { h_flex, Popover } from "gpui-base";
import { appHome, checking, exec, hc, machines, readTextFile, window } from "herdr";
import { hostPanel, percentText, sampleStatus, usageColor } from "./host-details.js";

const minute = 60000;
const key = name => name === null ? "local" : "remote-" + name;
const hostName = name => name ?? "This computer";
const ratio = (used, total) => Number.isFinite(used) && total > 0 ? Math.max(0, Math.min(100, used / total * 100)) : null;

export function measure(raw, previous) {
  const dt = raw.clock - (previous?.clock ?? NaN);
  const recent = dt > 0 && dt <= 90;
  let cpu = null, network = null;
  if (recent && raw.cpu && previous.cpu) {
    const total = raw.cpu[0] - previous.cpu[0], idle = raw.cpu[1] - previous.cpu[1];
    if (idle >= 0 && idle <= total) cpu = ratio(total - idle, total);
  }
  if (recent && raw.network && raw.network[0] === previous.network?.[0]) {
    const rx = raw.network[1] - previous.network[1], tx = raw.network[2] - previous.network[2];
    if (rx >= 0 && tx >= 0) network = [rx / dt, tx / dt];
  }
  return { raw, cpu, network, mem: raw.memory ? ratio(...raw.memory) : null,
    swap: raw.swap ? ratio(...raw.swap) : null, disk: raw.disk ? ratio(raw.disk[0], raw.disk[0] + raw.disk[1]) : null };
}

function newHost(name, state) {
  return { name, state, due: 0, pending: false, error: "", data: null, last: 0, history: [] };
}

export default class HostVitals {
  constructor() {
    this.hosts = new Map([[null, newHost(null, "ready")]]);
    this.registry = new Map();
    this.inventoryDue = 0;
    this.anchor = null;
    this.selected = null;
    this.size = "icon";
    this.started = false;
  }

  resize(width, cx) {
    if (!(width > 0)) return;
    const size = width >= 790 ? "wide" : width >= 500 ? "normal" : "icon";
    if (size !== this.size) { this.size = size; cx.notify(); }
    // A command can instantiate the tab mod without ever displaying its toolbar.
    if (this.started || checking()) return;
    this.started = true;
    this.tick(cx);
    cx.timer.every(1000, next => this.tick(next));
  }

  discover(cx, now) {
    if (now < this.inventoryDue || this.listing) return;
    this.inventoryDue = now + 30000;
    this.listing = true;
    cx.spawn(async next => {
      try {
        const res = await hc(["machine", "ls", "--json"]);
        if (res.code === 0) {
          const registry = JSON.parse(res.stdout).machines;
          if (Array.isArray(registry)) this.registry = new Map(registry.map(m => [m.name, m.state]));
        }
      } catch {
        this.inventoryDue = Date.now() + 10000; // Retry while machines() supplies the live connection list.
      } finally {
        this.listing = false;
        this.sync(next);
      }
    });
  }

  sync(cx) {
    const layouts = new Map(machines().filter(m => m.name).map(m => [m.name, m.layout]));
    const names = new Set([...this.registry.keys(), ...layouts.keys()]);
    let changed = false;
    for (const name of names) {
      const layout = layouts.get(name), connection = this.registry.get(name);
      const state = layout === "ready" ? "ready" : layout === "unavailable" ? "offline"
        : connection === "connected" ? "ready" : layout === "loading" || connection === "connecting" ? "connecting" : "offline";
      const old = this.hosts.get(name);
      if (old?.state === state) continue;
      const record = newHost(name, state);
      if (old) Object.assign(record, { data: old.data, last: old.last, history: old.history });
      this.hosts.set(name, record);
      changed = true;
    }
    for (const name of this.hosts.keys()) {
      if (name !== null && !names.has(name)) { this.hosts.delete(name); changed = true; }
    }
    if (changed) cx.notify();
  }

  tick(cx) {
    const now = Date.now();
    this.discover(cx, now);
    this.sync(cx);
    const hosts = [...this.hosts.values()];
    const slots = 3 - hosts.filter(h => h.pending).length;
    const due = hosts.filter(h => h.state === "ready" && !h.pending && h.due <= now).sort((a, b) => a.due - b.due);
    for (const h of due.slice(0, Math.max(0, slots))) this.sample(h, cx);
  }

  sample(h, cx) {
    h.pending = true;
    cx.spawn(async next => {
      try {
        if (!this.source) this.source = await readTextFile(appHome() + "/mods/notes-tabs/host_sample.py");
        if (!this.source) throw new Error("The host sampler is missing.");
        const res = await exec("python3", ["-c", this.source], { on: h.name, timeout: 7500 });
        if (res.code !== 0) {
          const message = res.stderr.trim().split("\n").at(-1);
          throw new Error(message || "Could not read system counters.");
        }
        const raw = JSON.parse(res.stdout);
        if (!raw || !Number.isFinite(raw.clock) || !raw.system) throw new Error("Incomplete host sample.");
        if (this.hosts.get(h.name) !== h) return;
        const now = Date.now();
        const previous = !h.error && h.hasBaseline ? h.data?.raw : null;
        h.data = measure(raw, previous);
        h.hasBaseline = true;
        h.last = now;
        h.error = "";
        h.history = h.history.filter(p => now - p.at < 5 * minute);
        if (Number.isFinite(h.data.cpu)) h.history.push({ at: now, cpu: h.data.cpu });
        h.due = now + (!previous ? 1000 : this.anchor !== null || window().active ? 5000 : 30000);
      } catch (err) {
        if (this.hosts.get(h.name) !== h) return;
        const message = String(err?.message ?? err);
        h.error = /not found|no such file/i.test(message) ? "Python 3 or a system utility is unavailable." : message.split("\n").at(-1).slice(0, 140);
        h.due = Date.now() + 15000;
      } finally {
        h.pending = false;
        if (this.hosts.get(h.name) === h) next.notify();
      }
    });
  }

  choose(name, cx) {
    this.selected = name;
    const h = this.hosts.get(name);
    if (h && Date.now() - h.last > 5000) h.due = 0;
    if (this.started) this.tick(cx);
    cx.notify();
  }

  render(t, active) {
    const all = [...this.hosts.values()].sort((a, b) => a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name));
    const current = this.hosts.get(active) ?? this.hosts.get(null);
    const shown = this.size === "wide" && all.length <= 2 ? all : [current];
    if (!shown.some(h => key(h.name) === this.anchor)) this.anchor = null;
    if (!this.hosts.has(this.selected)) this.selected = current.name;
    return h_flex().flex_none().items_center().gap(2)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).children(shown.map(h => {
      const id = key(h.name), open = this.anchor === id;
      const state = sampleStatus(h);
      const d = state ? null : h.data;
      const hint = hostName(h.name) + (d ? " · CPU " + percentText(d.cpu) + " · RAM " + percentText(d.mem) + " · Disk " + percentText(d.disk) : " · " + state);
      const trigger = h_flex().id("host-vitals-" + id).h(26).px(6).gap(5).items_center().rounded(6).cursor_pointer()
        .text_size(11.5).text_color(t.muted).when(open, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .accessibility_label(hint + ". Show host resources").tooltip(hint)
        .child(svg("mods/workspace-chrome/" + (h.name === null ? "monitor" : "server") + ".svg").size(13).flex_none()
          .text_color(d && d.disk >= 90 ? usageColor(t, d.disk) : t.muted))
        .when(this.size !== "icon", el => el
          .child(div().max_w(70).truncate().child(h.name ?? "Local"))
          .when(Boolean(d), el => el
            .child(div().whitespace_nowrap().text_color(usageColor(t, d.cpu)).child("CPU " + percentText(d.cpu)))
            .child(div().whitespace_nowrap().text_color(usageColor(t, d.mem)).child("RAM " + percentText(d.mem))))
          .when(!d, el => el.child(div().text_color(t.dim).child(state))));
      return Popover.new("host-resources-" + id).anchor("top_right").open(open)
        .on_open_change((show, cx) => {
          if (show) { this.anchor = id; this.choose(h.name, cx); }
          else if (this.anchor === id) { this.anchor = null; cx.notify(); }
        }).trigger(trigger).content(open ? hostPanel(t, all, this.hosts.get(this.selected), (name, cx) => this.choose(name, cx)) : div());
    }));
  }
}
