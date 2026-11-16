# Events, format 1

`concerto --run --json "…"` prints one JSON object per line. The first event says which format
follows (`"format": 1`). Read each event by its `type` and ignore types and fields you do not know:
minor releases may add them. The schema is [src/events.ts](../src/events.ts).

| `type` | When | Fields |
|---|---|---|
| `session` | First, once | `format` (1), `session` (the id for `/history` and `--resume`), `log` (the session log's path) |
| `log` | Each line of the run's log | `label` (Score, Builder, Checks, Critic, Merge, Policy, Commit…), `role`, `detail`, `result` |
| `story` | A story starts building, passes or fails | `id`, `status` (`building`, `checking`, `passed`, `failed`…), `model` |
| `done` | Once, when the run ends | `phase` (`done` or `failed`), `error` (when failed), `costUsd`, `report` (the run report's path), `stories` (each `id`, `status`, `merged` files) |
| `pr` | With `--pr`, after `done` | `url` (null when nothing was merged), `reason` (when there is no pull request) |

```json
{"type":"session","format":1,"session":"s-mwj55yll-7b2b","log":".concerto/logs/s-mwj55yll-7b2b.log"}
{"type":"log","label":"Builder","role":"section","detail":"Add /health route","result":"done"}
{"type":"story","id":"route","status":"building","model":"codex/gpt-6.1-sol"}
{"type":"log","label":"Critic","role":"critic","detail":"Add /health route","result":"passed"}
{"type":"done","phase":"done","costUsd":0.42,"report":".concerto/runs/run-xyz.md","stories":[{"id":"route","status":"passed","merged":["src/health.ts"]}]}
```

The exit code is 0 when every story passed, 1 otherwise.

## MCP tools

`concerto --mcp` serves five tools. Each returns one JSON object as text, with the fields below.
New fields may appear in minor releases.

| Tool | Takes | Returns |
|---|---|---|
| `concerto_plan` | `request`, `cwd` | `session`, `summary`, `stories` (`id`, `title`, `score`, `builder`, `reviewer`, `estimateUsd`), `estimateUsd`, `next` |
| `concerto_build` | `session`, `cwd` | `session` (a new one), `phase`, `stories` (`id`, `status`, `merged`, `finding`), `costUsd`, `reports` |
| `concerto_run` | `request`, `cwd` | what `concerto_build` returns |
| `concerto_status` | `session`, `cwd` | the plan, or the result, as above |
| `concerto_sessions` | `query`, `cwd` | each session's `id`, `at`, `prompt`, `phase`, `passed`, `total`, `parent` |

A tool that fails returns its error message as text with `isError: true`. Each message is listed in
[failures](failures.md).
