# From 0.x to 1.0

Most people have nothing to do. Every 0.x config loads in 1.0 unchanged, and every flag and
command from 0.x still works. This page lists what is new to opt into, and the few behaviours
that changed during 0.x.

## Do once

```sh
concerto --update            # or brew upgrade concerto, scoop update concerto…
concerto --migrate-config    # writes "version": 1 into your config files (optional)
```

`--migrate-config` touches only your personal config and the project's `concerto.config.json`,
never the bundled default. A config without `version` keeps working; the command only makes the
version explicit.

## What changed in behaviour during 0.x

- **A project's `concerto.config.json` is merged over your personal config** (since 0.16). Before,
  it replaced it. If your project file was a full copy of your personal one, trim it to what the
  team shares: routes, reviewers, budgets, policy.
- **Every story builds in its own git worktree** (since 0.4). Set `"isolation": "off"` to build in
  the folder itself, as 0.1 did.
- **Concerto runs your tests before the critic** (since 0.4). Turn a check off with
  `"checks": { "test": false }`.
- **Concerto never commits unless asked** (unchanged). `--commit` and `--pr` are how to ask.
- **`--json` events start with `"format": 1`** (1.0). Scripts that read `type` keep working.

## Worth turning on

| What | How |
|---|---|
| The sandbox for agents you do not fully trust | `--sandbox`, or `"sandbox": { "enabled": true }` |
| A team policy | `"policy": { "protectedPaths": ["infra/"], "maxRunUsd": 20 }` in the project config |
| Notifications | `"notify": [{ "kind": "slack", "url": "${SLACK_WEBHOOK}" }]` |
| A security reviewer | a `customRoles` entry with `"kind": "review"` |
| Pull requests from issues | [examples/github/concerto.yml](../examples/github/concerto.yml) |
| Concerto from other agents | `claude mcp add concerto -- concerto --mcp` |

Everything stable from 1.0 is listed in [stability](stability.md).
