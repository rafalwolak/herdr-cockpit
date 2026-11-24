// Keep Herdr Chat sub-agent peeks in the Notes agents list.

import Agents from "./agents-base.js";
import { checking, closeOverlay, layout, nextCommand, openOverlay, props, run, terminals } from "herdr";

let shown = null; // the chat dialog this list opened last

export function openChatPeek(addr) {
  const t = terminals().find((x) => x.address === addr);
  const chat = t?.labels?.["herdr-chat.chat"];
  if (!chat || layout()?.terminal_menu !== "chat-menu") return false;
  run("overlay.close", { id: "terminal-peek" }); // a Rust peek open meanwhile
  if (shown) closeOverlay(shown);
  const provider = t.labels["herdr-chat.provider"];
  shown = openOverlay({ mod: "chat", kind: "dialog", width: 0.8, height: 0.8, props: { chat, peek: addr, ...(provider ? { provider } : {}) } });
  return true;
}

export default class ChatAgents extends Agents {
  init(p, cx) {
    super.init(p, cx);
    if (props()?.sortMenu || checking()) return;
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c.startsWith("peek:")) this.peek(c.slice(5));
        else if (c.startsWith("menu:")) openOverlay({ mod: layout()?.terminal_menu ?? "menu", kind: "popup", width: 240, props: { tab: "pane", target: { terminal: c.slice(5) } } });
      }
    });
  }

  peek(addr) {
    if (!openChatPeek(addr)) super.peek(addr);
  }
}
