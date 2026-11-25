# Working on Herdr Cockpit

Herdr Cockpit ships one native desktop layout and five mods. The installed layout name is **Notes**, its ID is `notes`, and its source is `layouts/notes.json`. Use Polish when speaking with the maintainer. Write repository files, commit messages and GitHub text in English.

## Installing or upgrading

1. Read the install section, the layout recipe and the installed app’s `AGENTS.md` before changing an installation. Keep this repository’s guide in the checkout. Herdr generates its runtime guide, `herdr.d.ts` and `gpui-kit.d.ts` in the app home. The default is `~/.config/herdr-app`, with overrides from `XDG_CONFIG_HOME` or `HERDR_APP_HOME`. [Installation](README.md#install) · [Layout recipe](RECIPE.md)
2. Explain what runs on the user’s machines. Notes reads and writes local Markdown. The sidebars and status bar use Git, `hc`, terminal data and, for Codex, account limits or its session log. The toolbar runs the Python sampler on each host through Herdr. When the user wants exact Claude resets, configure the bridge on the machine running Claude and preserve its existing renderer. [Claude Code setup](README.md#agent-usage-and-reset-times)
3. Install the five mod directories, `layouts/notes.json` and its referenced `layouts/notes.png`. On an upgrade, compare against the installed copies and merge local edits. Preserve custom blocks and bindings. For a name collision with an unrelated mod, follow the installed app’s renaming procedure, including internal asset and script paths.
4. Run `herdr-app check` on each of the five installed mod directories. Switch with `herdr-app do layout.switch '{"name":"notes"}'` and confirm that `herdr-app status` reports layout `notes` and an empty `errors` array.

## Layout bindings

Each row maps a block’s `id` to its `content.mod` and matching directory under `mods/`. Keep the `panel` and `panel-body` IDs for tab toggles, along with the `notes-tabs.toggle-notes` shortcut command.

| Block ID | Mod | Responsibility |
| --- | --- | --- |
| `spaces` | `notes-space-groups` | Group tree, membership and space menus per machine |
| `agents` | `notes-usage-agents` | Agent list, context captions and terminal peeks |
| `tabs` | `notes-tabs` | Panel selection, host sampler and resource popover |
| `notes` inside `panel-body` | `notes` | Markdown editor, preview and file storage |
| `status` | `notes-usage-status` | Agent readings, reset times and usage history |

## Runtime contracts

- **Native UI.** Use Herdr’s GPUI controls and theme tokens. Create input and focus handles in initialization or an event. Use the context passed to a spawned task after an `await`. Keep background polling out of `checking()` runs.
- **Notes.** Key files by encoded space ID. Preserve serialized writes against the last disk snapshot, recovery drafts and migration from `space:<id>`. An external edit that conflicts with a draft must leave both recoverable. [Notes behavior](RECIPE.md#how-it-behaves)
- **Agent usage.** The status mod publishes `notes.usage.contexts` by terminal address for the agent list. Match Claude labels to the foreground PID, and Codex reset times to the matching quota report. Keep missing readings distinct from zero. Preserve the native terminal peek when Herdr Chat is absent.
- **Hosts and groups.** Keep group parents and members on the same machine. Retain memberships while a host is offline. Collect counters on each host through Herdr and compute CPU and network rates from successive samples for that host.

## Verification

- For code changes, run `node --test tests/*.test.mjs` from the repository root. The Notes tests cover editing and file recovery. The Cockpit tests cover groups, usage and host sampling.
- For UI changes, run the native check on the installed mod and exercise the changed interaction in Herdr. The check covers the first render. Use a disposable space to test text editing, expanded groups or a popover with readings. For an isolated desktop test, set `HERDR_APP_HOME` for the app profile and `HC_SOCKET` for its test core. Notes files still follow the OS user’s notes directory.
- For documentation changes, check relative links, parse JSON examples and exercise changed install commands in a temporary profile. Use synthetic notes and readings in published examples. Keep generated types, user settings, terminal logs and personal screenshots outside the repository.
