# Recipes

Short answers to "how do I…". Every flag and key is in the [reference](reference.md); every error
message, with what to do about it, is in [failures](failures.md).

## Spend less

- **Plan first and look at the price.** `concerto --plan --explain "…"` scores the request, picks the models and estimates the cost without building anything.
- **Use what you already pay for.** Subscriptions (Claude Code, Codex, Gemini CLI, Cursor) cost a quarter of list price in the router's eyes, so they win ties. Set `"prefer": ["claude-code", "codex"]` to try them first.
- **Cap it.** `--budget 2` stops starting stories past $2 API-equivalent; `budgets.day` and `budgets.repo` cap a day and a repository.
- **Small stories on a local model.** Run Ollama, then `/setup` in the TUI (or `concerto --init`) adds what it has at tier 1, and the router sends it scoring and small stories.

## Route through a proxy

Put the proxy's models in pi (`~/.pi/agent/models.json`) or a Codex profile (`~/.codex/<name>.config.toml`), run `/setup` in the TUI (or `concerto --init`), then `"prefer": ["ce-*"]` sends every chain through it first.

## Work as a team

1. Commit a `concerto.config.json` with only what the team agrees on: `routes`, `reviews`, `customRoles`, `policy`, `notify`, `budgets`. It is merged over each person's own config, so everyone keeps their models and logins.
2. Protect what agents must not touch: `"policy": { "protectedPaths": ["infra/", "**/*.pem"] }`.
3. Make security review mandatory on sensitive code: a `customRoles` entry `{ "name": "security", "kind": "review", "instructions": "docs/SECURITY_REVIEW.md" }`, plus `"policy": { "requireReview": [{ "paths": ["src/auth/**"], "role": "security" }] }`.
4. Hear about it: `"notify": [{ "kind": "slack", "url": "${SLACK_WEBHOOK}" }]`.

## Build issues in CI

- **GitHub:** copy [examples/github/concerto.yml](../examples/github/concerto.yml) to `.github/workflows/`, add a `CLAUDE_CODE_OAUTH_TOKEN` secret, then label an issue `concerto`. A pull request with the report comes back.
- **GitLab:** include [examples/gitlab/concerto.gitlab-ci.yml](../examples/gitlab/concerto.gitlab-ci.yml) and run a pipeline with `CONCERTO_REQUEST`.
- **Anywhere else:** `concerto --run --pr --json --budget 5 "…"` with `gh` logged in; or `--commit` for commits without a pull request.

## Run untrusted work safely

`--sandbox` hides your credentials, makes the system read-only and limits the network to the model providers. Add hosts a build needs with `"sandbox": { "allowHosts": ["registry.npmjs.org"] }`. After the run, `.concerto/audit/<run>.jsonl` lists every command the agents ran. See [security](security.md).

## Drive Concerto from another agent

`claude mcp add concerto -- concerto --mcp`, then ask Claude Code to "plan this with Concerto" or "build it with concerto_run". Any MCP client works the same way.

## Review before keeping

After a run, `/hunks <story>` numbers a story's hunks, `/reject <story> 2` takes one back, `/reject <story>` takes the whole story back, and `/ask <story> use the existing logger` sends it back to its builder with your comment. Rejected work is saved in `.concerto/rejected/` as a patch.

## Find an old run

`/history billing.ts failed` searches every saved session. `/history 3` reopens one, `/replay` steps through its model calls, and `/share` writes it as one HTML file, secrets redacted.

## Know what it costs

`concerto --costs --since 7` shows the week by repository and model; `--csv` exports it. `concerto --dashboard` writes a page with cost per week, pass rates and the slowest stories. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send each run to your tracing backend.

## Make it easier to use

- **Themes:** `"ui": { "theme": "high-contrast" }`, `"colorblind"`, or `"mono"`. `NO_COLOR=1` always gives mono.
- **Keys:** `"ui": { "keys": { "drop": "x", "down": "j", "up": "k" } }`.
- **Language:** `"ui": { "language": "fr" }`, or `"auto"` to follow `LANG`.
- **Screen readers:** `concerto --plain "…"` says the plan and every event as plain sentences, one per line, and asks before building.
