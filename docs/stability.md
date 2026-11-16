# What 1.0 promises

From 1.0, Concerto follows [semantic versioning](https://semver.org). Everything you can build on is
listed in [api-surface.json](api-surface.json), and a test fails when the code and that file differ.

| Kind | Stable | Where it is listed |
|---|---|---|
| Flags | every `--flag` and what it does | [reference](reference.md#flags) |
| Slash commands | every `/command` and its arguments | [reference](reference.md#slash-commands) |
| Config keys | every key, its type and default | [reference](reference.md#config-keys) |
| `--json` events | every event type and field | [events](events.md) |
| MCP tools | every tool, its inputs and the fields it returns | [events](events.md#mcp-tools) |
| Exit codes | `0` success, `1` a run that did not finish every story, or an error | |

- **Patch releases** (1.0.x) fix bugs and never change what is listed.
- **Minor releases** (1.x) may add flags, commands, keys, event types and fields. Anything you
  already use keeps working.
- **Major releases** (2.0) are the only ones that remove or rename anything. They come with a
  migration, and Concerto reads the previous config format.

## Not covered

- The TUI's layout, colours and wording: they keep improving. Script against `--json`, `--plain`
  or the MCP server instead.
- Which model a story goes to, scores and estimates: routing learns from your runs.
- Prompts sent to the agents, and files in `.concerto/` other than the run reports.

## Config versions

A config carries `"version": 1`. A config without it is from 0.x and is migrated when it loads.
`concerto --migrate-config` writes the version into your files. A config from a newer Concerto is
refused with a message saying so, never half-read.
