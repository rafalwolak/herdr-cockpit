import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { countdown, limitTone } from "./usage.js";
import { historyMinutes } from "./history.js";

const metrics = [
  { key: "context", label: "Context window", short: "Context" },
  { key: "fiveHour", label: "5-hour limit", short: "5h" },
  { key: "weekly", label: "Weekly limit", short: "Weekly" },
];

function clock(ms, seconds = false) {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), ...(seconds ? [d.getSeconds()] : [])]
    .map(n => String(n).padStart(2, "0")).join(":");
}

function resetTime(at, now) {
  const d = new Date(at * 1000), today = new Date(now);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const day = d.toDateString() === today.toDateString() ? "today" : month + " " + d.getDate();
  return "Resets " + day + " at " + clock(d.getTime()) + " (in " + countdown(at - now / 1000) + ")";
}

function metricRow(t, metric, data, now) {
  const used = Math.max(0, Math.min(100, 100 - data.left));
  const color = t[limitTone(data.left)] ?? t.accent;
  const info = [];
  if (metric.key === "context" && data.size) info.push(String(Math.round(data.size)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " tokens");
  if (data.reset) info.push(resetTime(data.reset, now));
  else if (data.reportedIn) info.push("Reset in " + data.reportedIn + " at last report");
  return v_flex().w_full().gap(4)
    .child(h_flex().justify_between().items_center()
      .child(div().font_medium().text_color(t.foreground).child(metric.label))
      .child(div().text_color(t[limitTone(data.left)] ?? t.muted).child(Math.round(data.left) + "% left")))
    .child(div().w_full().h(5).rounded(3).bg(t.border).overflow_hidden()
      .when(used > 0, el => el.child(div().h(5).w(used + "%").rounded(3).bg(color))))
    .child(div().text_size(10.5).text_color(t.muted).child([Math.round(used) + "% used", ...info].join(" · ")));
}

function chart(t, points, key, minute) {
  const first = minute - historyMinutes + 1;
  const samples = points.filter(p => p.minute >= first && p.minute <= minute && Number.isFinite(p[key]));
  const plot = div().id("usage-history-plot").relative().w_full().h(65).overflow_hidden();
  for (const y of [0, 32, 64]) plot.child(div().absolute().top(y).left(0).w_full().h(1).bg(t.border));
  for (const p of samples) {
    const used = p[key];
    const x = (p.minute - first) / historyMinutes * 100;
    plot.child(div().id("usage-point-" + p.minute).absolute().left(x + "%").bottom(0)
      .w("1.35%").h(Math.max(2, Math.round(used * 0.65))).rounded_t(1)
      .bg(t[limitTone(100 - used)] ?? t.accent)
      .tooltip(clock(p.minute * 60000) + " · " + used + "% used"));
  }
  return v_flex().gap(4)
    .child(h_flex().gap(6).items_center()
      .child(v_flex().h(65).w(28).flex_none().justify_between().text_right().text_size(9.5).text_color(t.dim)
        .child("100%").child("0%"))
      .child(div().flex_1().min_w(0).child(plot)))
    .child(h_flex().pl(34).justify_between().text_size(10).text_color(t.dim)
      .child(clock(first * 60000)).child(clock(minute * 60000)))
    .when(samples.length < 2, el => el.child(div().text_size(10.5).text_color(t.muted)
      .child(samples.length ? "First reading recorded. Samples are saved once per minute." : "Waiting for the first reading.")));
}

export function usageDetails(t, target, reading, windows, history, selected, onSelect) {
  const now = Date.now(), minute = Math.floor(now / 60000);
  const data = { context: Number.isFinite(reading?.usage?.left) ? reading.usage : null,
    fiveHour: windows.find(w => w.label === "5h"), weekly: windows.find(w => w.label === "Weekly") };
  const available = metrics.filter(m => data[m.key]);
  const tracked = metrics.filter(m => data[m.key] || history.some(p => p.minute > minute - historyMinutes && Number.isFinite(p[m.key])));
  const active = tracked.find(m => m.key === selected) ?? tracked[0];
  const surface = v_flex().id("agent-usage-details").w(362).max_h(460).overflow_y_scrollbar().p(14).gap(13)
    .rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_md().text_size(12).text_color(t.foreground)
    .child(h_flex().items_center().justify_between()
      .child(div().font_semibold().text_size(14).child(target.name + " usage"))
      .child(div().text_size(11).text_color(t.muted).child(target.address)))
    .children(available.map(m => metricRow(t, m, data[m.key], now)));
  if (!active) return surface.child(div().text_color(t.muted).child("Waiting for the agent's first usage report."));
  return surface.child(div().h(1).w_full().bg(t.border))
    .child(v_flex().gap(8)
      .child(h_flex().items_center().justify_between()
        .child(div().font_medium().child("Usage history"))
        .child(div().text_size(10.5).text_color(t.muted).child("Past hour")))
      .child(h_flex().gap(3).items_center().children(tracked.map(m => div().id("history-" + m.key)
        .px(8).py(3).rounded(5).text_size(11).cursor_pointer()
        .text_color(m.key === active.key ? t.foreground : t.muted)
        .when(m.key === active.key, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { cx.stop_propagation(); onSelect(m.key); cx.notify(); }).child(m.short))))
      .child(chart(t, history, active.key, minute)))
    .when(Boolean(reading?.at), el => el.child(div().text_size(10.5).text_color(t.dim)
      .child("Last checked " + clock(reading.at, true))));
}
