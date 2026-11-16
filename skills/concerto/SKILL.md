---
name: concerto
description: Run a multi-step coding job through Concerto, which splits it into scored user stories, sends each story to the model that fits it (Claude Code, Codex, pi), has a critic review every story, and writes a report. Use when the user says "concerto", "orchestrate this", "split this into stories", "score this request", "how hard is this change", or wants a large change built by several models. Not for one-line edits you can make directly.
---

# Concerto

`concerto` is a command on this machine. It starts other coding agents (Claude Code, Codex, pi)
as background processes, one per story, so the user's own session is not involved. Builders
edit files in the directory Concerto runs in.

## Pick the command

| The user wants | Run | Edits files? |
|---|---|---|
| To know how a request splits, how hard each part is, which model gets it | `concerto --plan "<request>"` | No |
| It built, watchable, without touching their branch | `concerto --orca "<request>"` | In a new worktree |
| It built here, unattended, with a cap | `concerto --run --budget 5 "<request>"` | Yes, here |
| To finish a run that crashed, was stopped or failed review | `concerto --resume <session id>` (opens the TUI; the user presses Enter to build) | Yes, here |
| To check which models work | `concerto --doctor` | No |
| What past runs say: which model passes, what it costs, which files keep failing | `concerto --insights` | No |

Rules:

- Write the request as the user gave it, plus what done means:
  `Add CSV export to invoices. Done means: the tests pass.`
- Never `--run` in a tree with uncommitted work the user cares about. Check `git status`
  first; if it is dirty, use `--orca` or ask.
- Always pass `--budget` with `--run` unless the user gave a budget or said not to.
- `--run` can take many minutes. Run it in the background if your harness allows it.

## Reading `--plan` output

JSON with `summary`, `stories` and `routing`. For each routing entry, tell the user:

- `score` (0 to 100) and `reasons`: why it is hard.
- `impact`: `files`, `direct` and `indirect` importers, `tests` that cover it, `untested` files.
- `model` and `critics[0]`: who builds and who reviews. `estimate`: rough dollars.

## Reading a run

`--run` prints a log and ends with `done` or `failed: <reason>`; exit code 1 means a story failed
review, the budget ran out, or the conductor stopped the plan. The full report is the newest
`.concerto/runs/*.md`. Relay what changed, what failed and the cost. Do not commit for the user
unless asked; suggest reviewing the diff.

Every run prints its session id first (`session s-… · log .concerto/logs/s-….log`). The log has
every phase, agent line and error. The session is saved too: `concerto --resume <id>` reopens it
with the stories that passed kept, and builds the rest. In the TUI, the user can press Enter
after a run to retry what did not pass, or type `/history` to list earlier sessions.

If models fail or nothing is reachable, use the `concerto-doctor` skill. To change models,
routing or the budget, use the `concerto-config` skill.
