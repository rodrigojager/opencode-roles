# opencode-roles

Professional roles for OpenCode v2. A role is a persona: it changes how the
agent approaches the task (a Code Reviewer, a Root Cause Debugger, a UX
Researcher...), never which tools, models or permissions it has.

It is a port of the roles in
[pi-subagent](https://github.com/rodrigojager/pi-subagent), with the same prompt
wording, and the OpenCode sibling of
[claude-roles](https://github.com/rodrigojager/claude-roles).

Tested on OpenCode 2.1.3 and 2.1.4.

## Install

Clone this repository, then list its `plugin` folder in
`~/.config/opencode/opencode.json`, keeping your other plugins. That one entry
loads both parts: the server side (the role in the system prompt, `--role` for
subagents, the `roles` tool) and the TUI side (picker, indicator, `alt+r`).

```json
{
  "plugins": ["file:///C:/Users/you/.config/opencode/repos/opencode-roles/plugin"]
}
```

Restart OpenCode, both the TUI and the background service.

## Roles

The plugin ships no roles; it reads them from these folders, the first one
with an id winning:

1. `<project>/.opencode/roles/` (the nearest one above the session folder)
2. `~/.agents/roles/` (shared with other agents)
3. `~/.pi/agent/roles/` (Pi's)

For a ready catalog, copy the `roles/` folder of
[claude-roles](https://github.com/rodrigojager/claude-roles) (285 roles, 282 of
them from [agency-agents](https://github.com/msitarzewski/agency-agents)) into
`~/.agents/roles/`.

A role is a Markdown file with frontmatter:

```markdown
---
name: "My Reviewer"
description: "What it is for, in one line"
category: "engineering"
---

The instructions...
```

Its id is the file name without `.md` (lowercase; `default` and `none` are
reserved). Subfolders are categories when the frontmatter has none.

## Use

| Command | What it does |
| --- | --- |
| `/role` or `alt+r` | Opens the picker: two-line cards, type to filter (name, id, category, description; accents ignored), ↑/↓ or the mouse wheel through the whole list, Enter or a click picks, Esc cancels. |
| `/role <id>` | Activates a role directly, e.g. `/role code-reviewer`. |
| `/role none` | Back to default (no role). `/role default` does the same. |
| `/role show` | Shows the active role's text. |
| `/roles [search]` | Browses the catalog and opens a role's text. |

- **Per session:** the role is saved in the session, so a resumed session keeps
  it. Picking one on the home screen starts a new session with it.
- **Main agent:** the role text is added to the system prompt of every model
  request and never stored in the conversation, so a change or `/role none`
  applies from the next request on.
- **Subagents:** start a `subagent` or `task` prompt with `--role <id>` (or
  `--role none`). The option is removed and the role text put in front of the
  task; an unknown id fails that call and suggests close matches. The model is
  told about this and can look roles up with the read-only `roles` tool
  (`list`, `show`).

## In the TUI

```
┃  Build · GPT-5.5 OpenAI · medium · Role: Historian
   …                         ctrl+p commands  alt+r roles
```

- **Indicator:** `Role:` in the theme's text colour and the name in the
  theme's accent colour (the picker's selection colour), both bold; `Role:
  default` muted. Both follow a theme switch. Clicking it opens the picker.
- **Hint:** `alt+r roles` after OpenCode's `ctrl+p commands`, in the same
  style, on terminals at least 100 columns wide. To rebind the key, set
  `"roles.picker"` under `keybinds` in `cli.json`; the hint follows.
- OpenCode has no plugin slot on the agent · model · effort line, so the
  plugin finds that line in the TUI's render tree. If a later OpenCode changes
  that layout, the indicator moves to the prompt footer instead, still working.

## Develop

```
bun install
bun test
bun run typecheck
```

`scripts/e2e/` drives the real TUI through a pseudo-terminal against a
sandboxed OpenCode and a fake local model (no real model, no tokens). Its paths
are the author's sandbox on `D:`; adjust them before running it.

## License

MIT (see `LICENSE`).
