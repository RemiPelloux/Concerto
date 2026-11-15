---
name: concerto-doctor
description: Diagnose and fix Concerto problems - models skipped or failing, "No configured model is reachable", fallbacks in the log, expired logins, rate limits, a run that failed review or ran out of budget. Use when a concerto command errors, a run fails, or the user asks why Concerto picked or skipped a model.
---

# Fixing Concerto

Start with `concerto --doctor`. It shows which CLIs are installed, how many models each links,
the config in use, what each role runs on, and every skipped model with its error.

## Common causes

| Symptom | Cause | Fix |
|---|---|---|
| `skipped ... Refresh token expired` or `OAuth refresh failed` | pi's login expired | `pi auth login <provider>`, then `concerto --probe` |
| `401 Incorrect API key` | a bad key in the environment or pi | fix the key, then `concerto --probe` |
| `503 No available accounts` | the proxy has no capacity for that model | wait, or `concerto --prefer claude-code,codex` |
| `403 ... IP is not authorized` | the provider blocks this network | remove that provider's models or allow the IP |
| `No configured model is reachable` | nothing installed or logged in | install and log into `claude`, `codex` or `pi`, then `concerto --init` |
| `Fallback` lines in the log | a model failed mid-run; the next one took over | usually fine; `--doctor` shows if it persists |
| `budget of $X reached` | `--budget` or `budgetUsd` hit | raise it or split the request |
| `N stories failed review` | the critic rejected the work twice, plus one guided retry | read `.concerto/runs/*.md` for the critique; `concerto --resume <id>` builds only those stories again |
| a run was interrupted (crash, Esc, closed terminal) | nothing is lost | `concerto --resume <session id>`; `/history` lists the ids |
| an agent shows no output for minutes | it is usually running tests; the preview says how long since it last printed | wait, or Tab to the agent and Enter for its live output |
| on Windows: `claude`, `codex` or `pi` not found | not on PATH in this terminal | open a new terminal after installing, check `where codex` |
| a crash or any other error | see the session log | open `.concerto/logs/<session id>.log`; the id is in the error message and the status line |

Notes:

- Failed probes keep a model out of routing for 24 hours. `concerto --probe` retests now.
- Costs are API-equivalent; on subscriptions nothing extra is charged.
- `concerto --stats` shows totals: tokens, cache hits, condensed tokens, fallbacks.
- `concerto --clear-cache` drops cached scoring answers if a plan looks stale.
