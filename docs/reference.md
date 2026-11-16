# Reference

Generated from the code by `scripts/reference.ts`; a test fails when this page and the code differ.
See [recipes](recipes.md) for what to do with them, and [failures](failures.md) for every error message.

## Flags

`concerto [options] [request]`

| Flag | What it does |
|---|---|
| `--plan` | score the request into user stories, print JSON and exit |
| `--explain` | with --plan: say why each story got its score, model and estimate, in words |
| `--template <name>` | plan in the shape of a saved template (see /template) |
| `--run` | score and build without the TUI, printing the log (scripts, CI) |
| `--yes` | build right after scoring, without the confirm step |
| `--no-rewrite` | score the request as typed: no rewriter, questions or design brief |
| `--orca` | start the run in a new Orca worktree, in its own terminal tab |
| `--budget <usd>` | stop starting stories once a run has spent this (API-equivalent) |
| `--gate <command>` | a check every story must pass before review, e.g. "pnpm test" (repeatable) |
| `--prefer <list>` | providers to try first, e.g. ce-* or ce-gpt,openai |
| `--resume <id>` | reopen a saved session (see /history) and build what did not pass |
| `--share <id>` | write a saved session as one HTML file, secrets redacted |
| `--mcp` | serve Concerto to other agents as MCP tools on stdio |
| `--costs` | what runs cost, by week, repository and model (--since <days>, --csv) |
| `--dashboard` | write a page of every run: costs, pass rates, slowest stories |
| `--plain` | the run as plain sentences, for screen readers (asks before building; --yes skips) |
| `--sandbox` | run every agent in the sandbox: network only to model providers, secrets hidden |
| `--migrate-config` | rewrite your config files in the current format (older ones still load as they are) |
| `--update` | update Concerto the way it was installed (Homebrew, Scoop, Nix, the installer) |
| `--json` | with --run: one JSON event per line (session, log, story, done, pr) |
| `--commit` | with --run: commit each merged story on its own (clean tree needed) |
| `--pr` | with --run: a new branch, a commit per story, then a pull request (gh) |
| `--init` | detect every linked AI and write your personal config |
| `--routing <choice>` | with --init outside a terminal: subscriptions, proxy or api |
| `--probe` | send each configured model a tiny prompt; failures are skipped for a day |
| `--doctor` | what is installed, linked and reachable |
| `--models` | reachable models, each role's chain and sample routes |
| `--stats` | token and cache totals for this repository |
| `--insights` | what past runs say: pass rate and cost per model, files that keep failing |
| `--update-prices` | fetch current model prices from models.dev for estimates and budgets |
| `--install-skills` | teach the agents on this machine (Claude Code, Codex, pi) to use Concerto |
| `--clear-cache` | drop the local response cache |

## Slash commands

Type them in the TUI's prompt; Tab completes them.

| Command | What it does |
|---|---|
| `/drop <story>` | remove a story from the waiting plan |
| `/merge <story> <into>` | fold a story into another |
| `/split <story>` | split a story in two by its acceptance items |
| `/retitle <story> <title>` | reword a story's title |
| `/after <story> <stories\|none>` | set what a story waits for |
| `/route <story> <model>` | pick the model that builds a story |
| `/reviewer <story> <model>` | pick the model that reviews a story |
| `/effort <story> <level>` | set a story's effort: low, medium, high, xhigh |
| `/share [n\|id]` | a run as one HTML file to send someone, secrets redacted |
| `/replay [n\|id]` | step through a session's model calls: what each was asked and answered |
| `/hunks <story>` | list the hunks a story merged, numbered |
| `/reject <story> [n]` | take a merged story, or its hunk n, back out (saved as a patch) |
| `/ask <story> <message>` | send a story back to its builder with a comment |
| `/redo <story>` | queue a story to build again: Enter builds it, with the plan edits you make |
| `/pause` | let the stories building finish and start no new one |
| `/continue` | start the next stories after /pause |
| `/template save\|use <name>` | save a plan's shape, or plan the next requests in one |
| `/help` | list these commands |
| `/session` | this session's id and its log file, for debugging |
| `/history [n\|id]` | saved sessions; /history 2 reopens one and builds what did not pass |
| `/onboarding` | replay the animated tour of Concerto |
| `/setup` | detect and test your models again, then pick the routing |
| `/config [auto]` | pick the model of every role with the arrows; /config auto scans this machine |
| `/models` | each role's model chain and how stories route |
| `/doctor` | models skipped after a failed probe, and why |
| `/probe` | test every installed model with one tiny prompt |
| `/reload` | read the config file again |
| `/budget <usd\|off>` | spending cap for this session |
| `/prefer <providers\|off>` | providers tried first, e.g. ce-* |
| `/insights` | what past runs say: pass rate and cost per model, files that fail |
| `/stats` | tokens, cache hits and savings for this repository |
| `/orca <request>` | build a request in a new Orca worktree |
| `/clear` | clear the plan and the log |
| `/quit` | leave Concerto |

## Config keys

In `~/.config/concerto/config.json`, with a project's `concerto.config.json` merged over it.

| Key | Type | Default |
|---|---|---|
| `version` | number | `1` |
| `models` | map of object |  |
| `models.<key>.tier` | number |  |
| `models.<key>.costFactor` | number, optional |  |
| `prefer` | list of string | `[]` |
| `timeoutMinutes` | number | `30` |
| `limits` | map of object | `{}` |
| `limits.<key>.windowHours` | number | `5` |
| `limits.<key>.maxUsd` | number |  |
| `budgets` | object | `{}` |
| `budgets.story` | number, optional |  |
| `budgets.day` | number, optional |  |
| `budgets.repo` | number, optional |  |
| `budgetUsd` | number, optional |  |
| `gates` | list of string | `[]` |
| `codexFullAccess` | boolean | `false` |
| `rewrite` | boolean | `true` |
| `roles` | object |  |
| `roles.rewriter` | object | `{"minTier":3,"effort":"low","tools":[],"models":[]}` |
| `roles.rewriter.minTier` | number |  |
| `roles.rewriter.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.rewriter.tools` | list of string |  |
| `roles.rewriter.models` | list of string | `[]` |
| `roles.conductor` | object |  |
| `roles.conductor.minTier` | number |  |
| `roles.conductor.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.conductor.tools` | list of string |  |
| `roles.conductor.models` | list of string | `[]` |
| `roles.scorer` | object |  |
| `roles.scorer.minTier` | number |  |
| `roles.scorer.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.scorer.tools` | list of string |  |
| `roles.scorer.models` | list of string | `[]` |
| `roles.soloist` | object |  |
| `roles.soloist.minTier` | number |  |
| `roles.soloist.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.soloist.tools` | list of string |  |
| `roles.soloist.models` | list of string | `[]` |
| `roles.critic` | object |  |
| `roles.critic.minTier` | number |  |
| `roles.critic.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.critic.tools` | list of string |  |
| `roles.critic.models` | list of string | `[]` |
| `roles.section` | object |  |
| `roles.section.minTier` | number |  |
| `roles.section.effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" |  |
| `roles.section.tools` | list of string |  |
| `roles.section.models` | list of string | `[]` |
| `routes` | list of object | `[]` |
| `routes[].name` | string |  |
| `routes[].tags` | list of string | `[]` |
| `routes[].minScore` | number | `0` |
| `routes[].maxScore` | number | `101` |
| `routes[].role` | "soloist" \| "section" |  |
| `routes[].models` | list of string |  |
| `routes[].effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" or "auto" | `"auto"` |
| `reviews` | list of object | `[]` |
| `reviews[].tags` | list of string | `[]` |
| `reviews[].minScore` | number | `0` |
| `reviews[].maxScore` | number | `101` |
| `reviews[].models` | list of string |  |
| `reviews[].effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" or "auto" | `"auto"` |
| `customRoles` | list of object | `[]` |
| `customRoles[].name` | string |  |
| `customRoles[].kind` | "review" \| "build" |  |
| `customRoles[].instructions` | string |  |
| `customRoles[].tags` | list of string | `[]` |
| `customRoles[].paths` | list of string | `[]` |
| `customRoles[].minScore` | number | `0` |
| `customRoles[].models` | list of string | `[]` |
| `customRoles[].minTier` | number | `3` |
| `customRoles[].tools` | list of string, optional |  |
| `customRoles[].effort` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | `"medium"` |
| `policy` | object | `{"protectedPaths":[],"blockedModels":[],"requireReview":[]}` |
| `policy.protectedPaths` | list of string | `[]` |
| `policy.blockedModels` | list of string | `[]` |
| `policy.maxRunUsd` | number, optional |  |
| `policy.requireReview` | list of object | `[]` |
| `policy.requireReview[].paths` | list of string |  |
| `policy.requireReview[].role` | string |  |
| `notify` | list of object | `[]` |
| `notify[].kind` | "slack" \| "discord" \| "webhook" |  |
| `notify[].url` | string |  |
| `notify[].on` | list of "done" \| "failed" \| "plan" | `["done","failed"]` |
| `ui` | object | `{"theme":"default","keys":{},"language":"auto"}` |
| `ui.theme` | "default" \| "high-contrast" \| "colorblind" \| "mono" | `"default"` |
| `ui.keys` | object | `{}` |
| `ui.keys.drop` | string, optional |  |
| `ui.keys.split` | string, optional |  |
| `ui.keys.merge` | string, optional |  |
| `ui.keys.close` | string, optional |  |
| `ui.keys.next` | string, optional |  |
| `ui.keys.up` | string, optional |  |
| `ui.keys.down` | string, optional |  |
| `ui.language` | "auto" \| "en" \| "fr" | `"auto"` |
| `sandbox` | object | `{"enabled":false,"allowHosts":[],"hide":[]}` |
| `sandbox.enabled` | boolean | `false` |
| `sandbox.allowHosts` | list of string | `[]` |
| `sandbox.hide` | list of string | `[]` |
| `skills` | list of object |  |
| `skills[].tags` | list of string |  |
| `skills[].paths` | list of string |  |
| `swarm` | object |  |
| `swarm.maxParallel` | number |  |
| `isolation` | "worktree" \| "off" | `"worktree"` |
| `behaviour` | object, optional |  |
| `behaviour.serve` | string |  |
| `behaviour.routes` | list of string |  |
| `behaviour.readySeconds` | number | `60` |
| `checks` | object | `{"timeoutMinutes":10}` |
| `checks.test` | string or false, optional |  |
| `checks.typecheck` | string or false, optional |  |
| `checks.lint` | string or false, optional |  |
| `checks.timeoutMinutes` | number | `10` |
| `cache` | object |  |
| `cache.dir` | string |  |
| `cache.ttlHours` | number |  |
| `cache.maxEntries` | number | `500` |
