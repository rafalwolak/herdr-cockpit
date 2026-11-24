export const historyMinutes = 60;

export function sessionKey(target, reading) {
  return reading?.pid ? [target.name, target.address, reading.pid].join("/") : null;
}

export function usageSample(minute, usage, windows) {
  const used = left => typeof left === "number" && Number.isFinite(left) && left >= 0 && left <= 100
    ? Math.round((100 - left) * 10) / 10 : null;
  return {
    minute,
    context: used(usage?.left),
    fiveHour: used(windows.find(w => w.label === "5h")?.left),
    weekly: used(windows.find(w => w.label === "Weekly")?.left),
  };
}

export function recordHistory(previous, samples, minute) {
  const first = minute - historyMinutes + 1;
  const history = {};
  for (const [key, entries] of Object.entries(previous ?? {})) {
    if (!Array.isArray(entries)) continue;
    const recent = entries.filter(p => Number.isInteger(p?.minute) && p.minute >= first && p.minute <= minute);
    if (recent.length) history[key] = recent.slice(-historyMinutes);
  }
  for (const [key, point] of samples) {
    if (!key || [point.context, point.fiveHour, point.weekly].every(v => v == null)) continue;
    const series = history[key] ??= [];
    const last = series.at(-1);
    if (last?.minute === minute) {
      series[series.length - 1] = {
        minute, context: point.context ?? last.context, fiveHour: point.fiveHour ?? last.fiveHour, weekly: point.weekly ?? last.weekly,
      };
    } else series.push(point);
  }
  return history;
}
