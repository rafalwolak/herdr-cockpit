# Herdr Notes

Keep one Markdown note per Herdr space. **Notes** opens beside **Files** and **Changes** with the same header, icons and focus border. Changes save automatically to a local Markdown file.

<img src="preview.png" width="378" alt="The focused Notes panel beside Files and Changes, showing a release checklist in the Studio space">

## Install

In a Herdr chat, ask your agent to install this layout.

> Read my Herdr app's AGENTS.md and install the Notes layout from https://github.com/rafalwolak/herdr-notes.

For a manual install, copy these four paths from the repository into the matching locations under your Herdr app home. The default is `~/.config/herdr-app`. Check for name conflicts before copying.

- `mods/notes/`
- `mods/notes-tabs/`
- `layouts/notes.json`
- `layouts/notes.png`

Then validate both mods and activate the layout. On macOS and Linux, run the following commands.

```sh
app_dir="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
herdr-app check "$app_dir/mods/notes"
herdr-app check "$app_dir/mods/notes-tabs"
herdr-app do layout.switch '{"name":"notes"}'
```

The supplied layout uses Herdr's stock panels. For a custom layout, point its `tabs` block at `notes-tabs` and add the `notes` block to its `panel-body` stack. [Layout file](layouts/notes.json)

## Use

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

## Development

Tested with Herdr desktop 0.1.17 on macOS. Run the test suite with Node.js.

```sh
node --test tests/notes.test.mjs
```

This fork adapts itspanicky's notes panel to the native Herdr 0.1.17 layout and tab bar. [Original Herdr Notes](https://github.com/itspanicky/herdr-notes) · [Herdr desktop](https://github.com/herdrdev/herdr-app/tree/v0.1.17)
