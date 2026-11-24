# Herdr Cockpit

A Herdr layout for working across spaces, agents and machines. The **Notes** layout adds four controls to the native window.

- **Space groups** organize spaces into nested folders on each machine. Right-click a space and choose **Move to group…**. Right-click a group and choose **Add Sub Group…**.
- **Agent usage** shows remaining context beneath Codex and Claude Code agents. Click the bottom status bar to inspect the focused agent’s context, 5-hour and weekly limits, reset times and an hour of readings. Values appear as the agent reports them.
- **Host resources** shows CPU and RAM beside the Notes button. Click a host for a five-minute CPU graph, memory, swap, disk space, network throughput, load and uptime. The panel includes a host picker when the toolbar is narrow.
- **Markdown notes** save automatically per space. Open **Notes** beside **Files** and **Changes**.

<img src="preview.png" width="378" alt="The focused Notes panel beside Files and Changes, showing a release checklist in the Studio space">

## Install

In a Herdr chat, ask your agent to install this layout.

> Read my Herdr app's AGENTS.md and install the Notes layout from https://github.com/rafalwolak/herdr-cockpit.

For a manual install, copy the five directories below from the checkout’s `mods/` into your Herdr app’s `mods/`. On a fresh install, copy `layouts/notes.json` and `layouts/notes.png` into the app’s `layouts/`. To upgrade a customized Notes layout, apply these bindings to its existing blocks.

| Layout block ID | `content.mod` and directory name |
| --- | --- |
| `spaces` | `notes-space-groups` |
| `agents` | `notes-usage-agents` |
| `tabs` | `notes-tabs` |
| `notes` in `panel-body` | `notes` |
| `status` | `notes-usage-status` |

On macOS or Linux, validate the mods and activate the layout.

```sh
(
  set -e
  app_dir="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
  for mod in notes notes-tabs notes-space-groups notes-usage-agents notes-usage-status; do
    herdr-app check "$app_dir/mods/$mod"
  done
  herdr-app do layout.switch '{"name":"notes"}'
)
```

Host metrics use Python 3.8+ on each monitored macOS or Linux machine. Herdr runs the sampler through its existing connection. The Spaces sidebar runs Git on the space’s host. The usage bar reads Herdr terminal footers and labels through `hc`. For Codex, it can also query the installed `codex app-server` for account limits or read the matching Herdr Chat rollout.

### Claude Code reset times

For exact resets on macOS or Linux, register `claude_status.py` as a Claude Code status-line command on each machine where Claude runs. On an SSH host, copy that one file to the same mod path under the remote user’s Herdr app home. Merge the following field into your Claude Code settings.

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 \"${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}/mods/notes-usage-status/claude_status.py\""
  }
}
```

If you already have a status-line renderer, pass its existing command as one shell-quoted argument after `claude_status.py`. The wrapper forwards the original JSON on stdin and preserves the renderer’s output and exit code. With no renderer argument it only publishes the metrics to the current Herdr terminal. The terminal-footer fallback works without this setup.

## Notes

Click the note to edit. Press **Escape** or click outside it to return to the formatted preview. Click a checkbox in the preview to update the task. The gear menu contains appearance settings, **Reveal file**, **Copy path**, **Clear note** and **Undo clear**.

To use **Option+Shift+N** on macOS, add the following section to your existing `keys.json`.

```json
{
  "layout:notes": {
    "alt-shift-n": "notes-tabs.toggle-notes"
  }
}
```

## Storage

Each file is named for its space ID. Renaming a space keeps its note. External edits appear in the panel. If a local draft conflicts with a file on disk, Notes keeps the draft for a manual merge.

| Platform | Notes directory |
| --- | --- |
| macOS | `~/Library/Application Support/Herdr/notes/` |
| Linux | `~/.local/share/herdr/notes/` |
| Windows | `~/AppData/Local/Herdr/notes/` |

Group membership and collapse state live in Herdr’s shared `space-groups` data. The usage bar stores up to 60 minutes of usage percentages per session in its mod storage. The host resource graph keeps the last five minutes in memory.

## Development

Verified with Herdr desktop 0.1.18 on macOS and a Linux SSH host. Run the regression tests with Node.js and Python 3.

```sh
node --test tests/*.test.mjs
```

The Notes panel is based on itspanicky’s layout. The tabs, status bar and sidebars adapt Herdr’s native mods. [Original Notes](https://github.com/itspanicky/herdr-notes) · [Herdr desktop](https://github.com/herdrdev/herdr-app/tree/v0.1.18) · [Apache license](mods/notes-space-groups/LICENSE-APACHE)

Nested groups are adapted from Space Groups. The optional chat peek adapter is from Herdr Chat. [Space Groups](https://github.com/suppa-duppa-labs/herdr-space-groups) · [Group notices](mods/notes-space-groups/NOTICE) · [Herdr Chat](https://github.com/ChmaraX/herdr-chat) · [Chat adapter license](mods/notes-usage-agents/LICENSE-CHAT)
