---
name: concerto-config
description: Change how Concerto routes work between models - which model builds or reviews which stories, provider preference (subscriptions, a proxy such as ce-*, API keys), budget, tiers, timeouts and skills. Use when the user asks to "use Opus for X", "prefer my proxy", "make Concerto cheaper", "change the reviewer", "add a model to Concerto" or edits concerto.config.json.
---

# Configuring Concerto

Concerto reads the first of: `$CONCERTO_CONFIG`, `./concerto.config.json` (per project),
`~/.config/concerto/config.json` (personal, written by `concerto --init`), the bundled default.
Edit the file that is in use (`concerto --doctor` prints which), then run `concerto --models` to
see the result. Invalid configs fail with the file and field named.

## Model names

`<prefix>/<model id>`:

- `claude-code/claude-opus-5-5`: Claude Code, on the Claude subscription.
- `codex/gpt-6.1-sol`: Codex, on the ChatGPT subscription.
- `codex@ce-gpt/gpt-6.1-sol`: Codex through the profile `~/.codex/ce-gpt.config.toml`.
- `gemini/<id>`, `cursor/<id>`: Gemini CLI and Cursor's agent, on their own logins.
- `opencode/<provider>/<id>`, `goose/<provider>/<id>`, `aider/<id>`: those CLIs, with the
  providers they are set up with.
- `ollama/<id>`, `lmstudio/<id>`: a model served on this machine, free, tier 1 by default.
- anything else is a pi provider: `anthropic/...`, `openai/...`, `ce-claude/...`.

Every model used must be listed under `models` with a `tier` (1 bulk work to 5 frontier).

Custom roles go in `customRoles`: `{ "name", "kind": "review" | "build", "instructions" (text or
a repository file), "tags", "paths" (globs), "minScore", "models", "minTier", "tools", "effort" }`.
A review runs after the critic passes and can send the story back; a build edits a passed story
before its merge.

## What to change

- **Who builds what:** `routes`, tried in order. A route matches on `tags` (any of),
  `minScore` and `maxScore` (exclusive), and lists `models` in preference order. `effort` is `auto` (from the score) or a
  fixed level.
- **Who reviews what:** `reviews`, matched on `tags` and the same score band; the first match
  with a reachable model wins, the critic role is the fallback. The defaults give UI work to
  Astra; everything else goes to the critic, Sonnet.
- **Role defaults:** `roles.<conductor|scorer|soloist|critic|section>.models`, `tools`, `effort`.
- **Proxy or API keys first:** `"prefer": ["ce-*"]`, or `--prefer 'ce-*'` for one run. It
  changes the provider, never the model.
- **Spending:** `"budgetUsd": 5`, or `--budget 5` for one run. `"swarm": {"maxParallel": 1}`
  stops parallel builds.
- **Prepaid models:** `costFactor` (default 0.25 for subscriptions) makes routing favor them.
- **What every story must pass:** `"checks": {"test": "pnpm test", "typecheck": false}`. Each of
  `test`, `typecheck` and `lint` is a command, `false` to turn it off, or left out to detect it;
  `timeoutMinutes` caps each run (10 by default).
- **Budgets:** `"budgets": {"story": 2, "day": 20, "repo": 200}` on top of `budgetUsd` (the run).
- **Account limits:** `"limits": {"claude-code": {"windowHours": 5, "maxUsd": 40}}` sends calls to
  the next way of reaching the model once that account's window is spent.
- **Prices:** `concerto --update-prices` fetches current prices from models.dev.
- **Worktrees:** `"isolation": "worktree"` (default) builds each story in its own git worktree and
  merges it back; `"off"` builds in the folder itself.
- **Web projects:** `"behaviour": {"serve": "npm run dev", "routes": ["/"]}` starts the server
  (it must read `PORT`) before and after each story so the critic sees which routes changed.

After editing, run `concerto --probe` if you added models, so failing ones are skipped.
