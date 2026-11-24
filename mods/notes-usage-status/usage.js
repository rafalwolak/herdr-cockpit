const pct = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function limitTone(left) {
  if (!pct(left)) return null;
  const remaining = Math.round(left);
  if (remaining <= 10) return "ansi1";
  if (remaining <= 20) return "ansi3";
  return null;
}

export function provider(agent, t) {
  const ids = [t?.labels?.["herdr-chat.provider"], agent?.app, t?.app, agent?.program?.key, t?.program?.key, t?.foreground?.name];
  for (const id of ids) {
    if (id === "codex") return "Codex";
    if (id === "claude" || id === "claude-code") return "Claude Code";
  }
  return null;
}

function tokens(text) {
  const m = String(text).match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i);
  return m ? Math.round(Number(m[1]) * ({ k: 1000, m: 1000000 }[m[2].toLowerCase()] ?? 1)) : null;
}

export function contextText(data) {
  if (!pct(data?.left)) return "";
  const size = data.size;
  const window = size >= 1000000 ? Number((size / 1000000).toFixed(2)) + "M"
    : size >= 1000 ? Math.round(size / 1000) + "K" : size > 0 ? String(size) : "";
  return "Context " + Math.round(data.left) + "% left" + (window ? " · " + window : "");
}

export function readFooter(name, text) {
  const lines = String(text).trimEnd().split("\n").slice(-7).map(s => s.trim());
  const windows = [];
  let left = null, size = null;
  if (name === "Codex") {
    // The TUI can wrap its own status line across two terminal rows.
    const start = lines.findLastIndex(l => /(?:^|[·│])\s*Context\s+\d{1,3}%\s+(?:left|used)\b/i.test(l));
    const footer = start < 0 ? "" : lines.slice(start, start + 2).join(" ");
    const ctx = footer.match(/\bContext\s+(\d{1,3})%\s+(left|used)\b/i);
    if (ctx && pct(+ctx[1])) left = ctx[2].toLowerCase() === "used" ? 100 - Number(ctx[1]) : Number(ctx[1]);
    if (left === null) {
      const simple = lines.findLast(l => /^\d{1,3}% context left\b/i.test(l) || /[·│]\s*\d{1,3}% context left\s*$/i.test(l));
      const match = simple?.match(/(\d{1,3})% context left/i);
      if (match && pct(+match[1])) left = Number(match[1]);
    }
    const win = footer.match(/\b(\d+(?:\.\d+)?[km]?)\s+window\b/i);
    if (win) size = tokens(win[1]);
    for (const m of footer.matchAll(/(?:^|[·│])\s*(5h|weekly)(?:\s+limit)?\s+(\d{1,3})%\s+(left|used)\b/gi)) {
      if (pct(+m[2])) windows.push({ label: m[1].toLowerCase() === "5h" ? "5h" : "Weekly",
        left: m[3].toLowerCase() === "used" ? 100 - Number(m[2]) : Number(m[2]) });
    }
  } else if (name === "Claude Code") {
    const line = lines.findLast(l => /^\d+(?:\.\d+)?%\s*\|/.test(l) && /\|\s*Duration:/i.test(l));
    if (line) {
      const used = parseFloat(line);
      if (pct(used)) left = 100 - used;
      const match = line.match(/\|\s*[\d.]+[km]?\s*\/\s*([\d.]+[km]?)\s*\|/i);
      if (match) size = tokens(match[1]);
    }
    const limits = lines.findLast(l => /^(?:5h|7d):\s*\d+%/i.test(l) || /^5h \d+%(?: · wk \d+%)?$/i.test(l));
    for (const m of (limits ?? "").matchAll(/(?:^|[|·])\s*(5h|7d|wk):?\s*(\d+(?:\.\d+)?)%(?:\s*-\s*T-((?:\d+[dhms])+))?/gi)) {
      if (pct(+m[2])) windows.push({ label: m[1].toLowerCase() === "5h" ? "5h" : "Weekly",
        left: 100 - Number(m[2]), reportedIn: m[3] ?? null });
    }
  }
  return left !== null || windows.length ? { left, size, windows } : null;
}

export function claudeLabel(terminal) {
  const label = terminal?.labels?.["notes.claude-usage"];
  if (!label) return null;
  try {
    const data = JSON.parse(label);
    if (!data.pid || data.pid !== terminal.foreground?.pid || !Array.isArray(data.windows)) return null;
    return { left: pct(data.left) ? data.left : null, size: data.size,
      windows: data.windows.filter(w => (w.label === "5h" || w.label === "Weekly") && pct(w.left)) };
  } catch { return null; }
}

export function quotaWindows(usage, account, now) {
  const windows = usage?.windows ?? [];
  return ["5h", "Weekly"].flatMap(label => {
    const own = windows.find(w => w.label === label);
    const live = account?.find(w => w.label === label);
    // A terminal can run a different Codex profile. Only pair matching reports.
    const w = own ? { ...own, reset: own.reset ?? (Math.round(own.left) === Math.round(live?.left) ? live?.reset : null) } : live;
    return w && pct(w.left) && !(w.reset && w.reset <= now) ? [w] : [];
  });
}

export function countdown(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h" + (minutes % 60 ? " " + (minutes % 60) + "m" : "");
  return Math.floor(hours / 24) + "d" + (hours % 24 ? " " + (hours % 24) + "h" : "");
}

export function activeAddress(focus, targets) {
  if (!focus) return null;
  const address = focus.shown ?? focus.terminal;
  if (address) return targets.has(address) ? address : null;
  const last = targets.get(focus.agent);
  return last && last.tab === focus.tab ? last.address : null;
}
