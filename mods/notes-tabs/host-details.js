import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const percentText = n => Number.isFinite(n) ? Math.round(n) + "%" : "—";
export const usageColor = (t, n) => n >= 90 ? t.ansi1 : n >= 80 ? t.ansi3 : t.muted;

export function sampleStatus(h) {
  if (h.state === "offline") return "Offline";
  if (h.state === "connecting") return "Connecting…";
  if (h.error) return "Unavailable";
  if (!h.data) return "Reading…";
  return !h.hasBaseline || Date.now() - h.last > 45000 ? "Refreshing…" : "";
}

function bytes(n) {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i && n < 100 ? n.toFixed(1) : Math.round(n)) + " " + units[i];
}

function uptime(seconds) {
  const hours = Math.floor(seconds / 3600), days = Math.floor(hours / 24);
  if (days) return days + "d " + hours % 24 + "h";
  return hours + "h " + Math.floor(seconds % 3600 / 60) + "m";
}

function readingTime(at) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

function line(t, label, value) {
  return h_flex().w_full().min_w(0).items_center().gap(8)
    .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(label))
    .child(div().flex_none().text_color(t.foreground).child(value));
}

function gauge(t, label, info, pct) {
  return v_flex().gap(5).child(line(t, label, info)).child(div().w_full().h(4).rounded(2).bg(t.border).overflow_hidden()
    .when(Number.isFinite(pct) && pct > 0, el => el.child(div().h(4).w(Math.min(100, pct) + "%").rounded(2)
      .bg(pct >= 80 ? usageColor(t, pct) : t.accent))));
}

function chart(t, h) {
  const end = Date.now(), start = end - 300000;
  const plot = div().id("host-cpu-history").w_full().relative().h(42).overflow_hidden();
  for (const y of [0, 20, 41]) plot.child(div().absolute().top(y).left(0).w_full().h(1).bg(t.border));
  for (const p of h.history) {
    if (p.at < start || p.at > end) continue;
    const x = Math.min(98.5, (p.at - start) / 3000);
    plot.child(div().absolute().left(x + "%").bottom(0).w("1.4%").h(Math.max(1, Math.round(p.cpu * 0.42))).rounded_t(1)
      .bg(p.cpu >= 80 ? usageColor(t, p.cpu) : t.accent).tooltip(readingTime(p.at) + " · CPU " + percentText(p.cpu)));
  }
  return v_flex().gap(5)
    .child(line(t, "CPU · last 5 min", percentText(h.data.cpu)))
    .child(plot.when(!h.history.some(p => p.at >= start), el => el.child(div().absolute().top(12).left(4).text_size(10.5).text_color(t.muted).child("Waiting for CPU samples…"))));
}

function machineList(t, all, selected, choose) {
  const headings = h_flex().h(17).px(7).items_center().text_size(10.5).text_color(t.dim)
    .child(div().flex_1().child("Host")).child(div().w(49).text_right().child("CPU")).child(div().w(49).text_right().child("RAM"));
  const rows = all.map(h => {
    const status = sampleStatus(h);
    const d = status ? null : h.data;
    return h_flex().id(h.name === null ? "vitals-pick-local" : "vitals-pick-remote-" + h.name)
      .h(26).px(7).rounded(5).flex_none().items_center().cursor_pointer()
      .when(h === selected, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); choose(h.name, cx); })
      .child(svg("mods/workspace-chrome/" + (h.name === null ? "monitor" : "server") + ".svg").size(13).flex_none().text_color(t.muted))
      .child(div().pl(7).flex_1().min_w(0).truncate().child(h.name ?? "This computer"))
      .when(Boolean(d), el => el.child(div().w(49).text_right().text_color(usageColor(t, d.cpu)).child(percentText(d.cpu)))
        .child(div().w(49).text_right().text_color(usageColor(t, d.mem)).child(percentText(d.mem))))
      .when(!d, el => el.child(div().text_color(t.muted).child(status)));
  });
  return v_flex().gap(2).child(headings)
    .child(v_flex().h(Math.min(4, rows.length) * 26).flex_none().overflow_y_scrollbar().children(rows));
}

export function hostPanel(t, all, h, choose) {
  const surface = v_flex().id("notes-host-details").w(344).max_h(480).overflow_y_scrollbar().p(13).gap(10)
    .rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_md().text_size(12).text_color(t.foreground)
    .child(div().text_size(14).font_semibold().child("Host resources"))
    .child(machineList(t, all, h, choose))
    .child(div().w_full().h(1).bg(t.border));
  if (!h) return surface;
  const status = h.error || sampleStatus(h);
  if (status) surface.child(div().text_size(11).text_color(t.muted).child(status));
  if (!h.data) return status ? surface : surface.child(div().text_color(t.muted).child("Reading host metrics…"));
  const { raw, mem, disk, swap, network } = h.data;
  surface.child(h_flex().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().font_medium().child(raw.host || h.name || "This computer"))
    .child(div().text_size(11).text_color(t.muted).child([raw.system, raw.cores && raw.cores + " cores"].filter(Boolean).join(" · "))))
    .child(chart(t, h));
  if (raw.memory) surface.child(gauge(t, "Memory", bytes(raw.memory[0]) + " / " + bytes(raw.memory[1]) + " · " + percentText(mem), mem));
  if (raw.disk) surface.child(gauge(t, "Home volume", bytes(raw.disk[1]) + " free · " + percentText(disk) + " used", disk));
  if (raw.swap) surface.child(line(t, "Swap", raw.swap[1] ? bytes(raw.swap[0]) + " / " + bytes(raw.swap[1]) + " · " + percentText(swap) : "Off"));
  if (raw.load) surface.child(line(t, "Load · 1 / 5 / 15 min", raw.load.map(n => n.toFixed(2)).join(" / ")));
  const speed = network ? "↓ " + bytes(network[0]) + "/s   ↑ " + bytes(network[1]) + "/s" : "—";
  surface.child(line(t, raw.network ? "Network · " + raw.network[0] : "Network", speed));
  if (Number.isFinite(raw.uptime)) surface.child(line(t, "Uptime", uptime(raw.uptime)));
  return surface.child(div().text_size(10.5).text_color(t.dim).child("Last reading " + readingTime(h.last)));
}
