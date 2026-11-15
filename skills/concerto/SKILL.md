---
name: concerto
description: Hand a multi-step coding job to Concerto, which splits it into scored user stories, routes each to the best-fit model (Claude Code, Codex, pi), has a critic review every story, and writes a report. Use when the user says "concerto", "orchestrate this", "split this into stories", "score this request", or asks to run a large change through several models. Not for one-line edits.
---

# Concerto

Concerto is installed as the `concerto` command. It runs other coding agents, so start it in its
own checkout, never in a tree with uncommitted work you care about.

## Pick the command

| The user wants | Run |
|---|---|
| To see how a request would be split, scored and routed, without building | `concerto --plan "<request>"` |
| Concerto to build it in a fresh Orca worktree they can watch | `concerto --orca "<request>"` |
| Concerto to build it here, headless, with a spending cap | `concerto --run --budget 5 "<request>"` |
| To check which models work | `concerto --doctor` |

Write the request the way the user gave it, plus what done means, for example
`Add CSV export to invoices. Done means: the tests pass.`

## After a run

- `--plan` prints JSON: each story has `score`, `reasons`, `impact` (files, importers, tests) and
  the model chain. Summarize the stories, their scores and their models for the user.
- `--run` prints a log and ends with `done` or `failed: <reason>`. Exit code 1 means a story
  failed review, the budget ran out, or the conductor stopped the plan.
- The report is the newest file in `.concerto/runs/`. Read it and relay what changed, what
  failed and the cost. Do not commit for the user unless they ask.
