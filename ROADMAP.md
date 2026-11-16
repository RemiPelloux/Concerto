# Roadmap

Concerto works end to end today: scoring, routing across Claude Code, Codex and pi, review,
fallbacks, the token engine, probes, session history and resume, and installers for Linux, macOS
and Windows. This page is the plan to 1.0 and past it, sprint by sprint, in order. Each sprint has
one goal, the work that serves it, and a test that says when it is done.

## Shipped

| Version | What it brought |
|---|---|
| 0.1.0 | Scoring, routing, critic, conductor checkpoints, token engine, TUI, probes, skills, Orca |
| 0.1.1 | Session id and log, Haiku 5.5 for small stories, faster rendering and scoring |
| 0.1.2 | Tab works in every phase, a visible "enter to build" |
| 0.1.3 | Windows support, release packages and installers, `/history` and `--resume`, a live agent panel, an end-of-run summary with retry |
| 0.1.4 | The prompt works in every phase: type a change to re-plan, a note for running agents, any command |
| 0.4.0 | Part 1: every story in its own worktree with rebuild on conflict, a test gate, acceptance commands, mutation spot checks, a second critic, a behaviour diff |

---

## Part 1 · Trust the result · shipped in 0.4

### Sprint 1 · isolation · shipped

- **One git worktree per story,** every story, not only parallel ones: a soloist editing the main
  folder while section stories merge into it would bring the collisions back. Each starts from a
  snapshot commit of the working tree, made in a throwaway index, with ignored dependency folders
  and `.env` files linked in.
- **Three-way merge back** against that snapshot, all files or none; edits on adjacent lines
  merge line by line.
- **Rebuild on conflict:** a story that passed but conflicts with work that landed meanwhile is
  rebuilt on the current code, up to twice, with fresh critic sessions.
- **Per-story diff** for the critic and the report; failed stories' work saved as patches.
- **Cleanup on crash:** worktrees of a run whose process is gone are saved as patches and removed.

Done: six stories editing neighbouring lines of one file merge in parallel, each critic sees only
its story; a real run of three stories editing the same export line lands all three.

### Sprint 2 · a test gate Concerto runs itself · shipped

- **The project's checks after every build,** before the critic: SmartTest, npm, pnpm, yarn,
  bun, pytest, go test, cargo test, PHPUnit, Maven or Gradle, then the typecheck and lint scripts.
- **Red means retry** with the failing command and the end of its output; the critic only sees
  green stories and is told what passed.
- **Flaky tests:** a test command that passes on a rerun is reported as flaky.
- **`checks` in the config** sets, replaces or turns off each check.

Done: a story whose tests fail never reaches the critic, and the report lists every check per story.

### Sprint 3 · verification beyond tests · shipped

- **Acceptance checks as code,** written by the scorer when it is sure and run by Concerto.
- **Mutation spot checks:** one condition the story added is flipped; a test must notice.
- **Critic disagreement:** a second critic from another vendor on high-risk stories, settled by the
  conductor at a fourth checkpoint.
- **Behaviour diff,** opt-in for web projects: the server is started before and after each story
  and the critic sees which routes changed.

Done: 10 of 10 seeded weak tests caught, a real test left alone.

---

## Part 2 · Smarter routing and lower cost

### Sprint 4 · learn from runs · shipped

- **Run history as data:** each finished story's factors, model, critic, builds, cost and result,
  in `.concerto/outcomes.jsonl` (JSON lines rather than SQLite: Node 22's SQLite module is still
  experimental, and a few thousand records need no database).
- **Calibrated score:** after 20 stories the factor weights are fitted to the repository's
  history, within a quarter to double of the hand-set prior.
- **Calibrated estimates:** a model's median cost per point here replaces list prices once it has
  five paid stories.
- **Per-model track record:** breaks price ties for builders and reviewers.
- **`concerto --insights`** and `/insights`.

Done: with 20 recorded runs the estimate lands within 30 % for 8 of 10 new runs, where list prices
miss by more.

### Sprint 5 · rate limits, budgets and quotas · shipped

- **Account awareness:** Claude Code and Codex do not expose their windows to other programs, so
  Concerto keeps its own account of what it spent per account in a rolling window (`limits`), and
  an account that answers with a rate limit is paused until the reset it names. Either way, later
  calls go to the next way of reaching the model instead of failing first.
- **Budgets** per run, story, day and repository, each warning once at 80 %.
- **Price book:** `concerto --update-prices` fetches models.dev; the doctor shows its date.
- **Cheapest path:** a waiting plan shows its cost on subscriptions, Codex profiles and API keys,
  with the `/prefer` that picks each.

Done: a run whose account window is spent mid-run moves the remaining calls to another account
with no failed call.

### Sprint 6 · 0.7 · deeper token engine

- **Shared repo map across sessions** with incremental updates from git, not a full rebuild.
- **Context packs per story:** only the files, symbols and tests a story needs, ranked by the
  import graph, under a token budget.
- **Semantic response cache** for scoring: a request that differs only in wording reuses the plan.
- **Prompt cache planning:** order segments so the longest stable prefix is shared by the most
  calls, and report the hit rate per role.

Done when: the same 10-story run costs 30 % less in input tokens than in 0.4, with the same
pass rate.

---

## Part 3 · Control during a run

### Sprint 7 · 0.8 · edit the plan

- **Plan editor in the TUI:** drop, merge, split or reword a story; change its model, effort or
  reviewer; reorder dependencies.
- **Templates:** save a plan shape ("API endpoint with tests and docs") and reuse it.
- **Dry run:** `--plan --explain` prints why each story got its model and what it would cost.

Done when: a five-story plan can be trimmed to three, rerouted and built without leaving the TUI.

### Sprint 8 · 0.9 · review and accept

- **Accept or reject per story,** and per hunk, after a run; rejected work is stashed, not lost.
- **Side-by-side diff view** with syntax colours and word-level changes.
- **Ask the builder:** a follow-up message to one story's builder session from its agent view.
- **Pause and continue** a run between stories.

Done when: after a 4-story run, two stories are kept, one is kept in part, one is sent back with a
comment, and the second attempt only touches that story.

### Sprint 9 · 0.10 · history and replay

- **Session branching:** reopen a session, change one story, and run it as a new branch of the
  history.
- **Replay** a finished run step by step in the TUI, with every prompt and answer.
- **Search** `/history` by request, file, model or result.
- **Share a run:** export the report and the session as one HTML file without secrets.

Done when: a failed run from last week can be found by a file name, opened, branched and rebuilt.

---

## Part 4 · Reach

### Sprint 10 · 0.11 · more languages and repositories

- **Import graph** for Go, Rust, PHP, Java, Kotlin, C#, Ruby and Swift.
- **Monorepos:** workspace packages, project references, per-package test commands.
- **Polyglot stories** that touch two languages are scored with both graphs.

Done when: real open-source repositories in each of those languages score with correct importers
and covering tests on a published benchmark set.

### Sprint 11 · 0.12 · more agents and models

- **Backends:** Gemini CLI, OpenCode, Cursor's agent, Aider and Goose behind the same runner
  interface, with the same fallbacks and accounting.
- **Local models** through Ollama and LM Studio for scoring and small stories.
- **Custom roles** defined in the config: a security reviewer, a docs writer, a migration checker,
  each with its own prompt, tools and routing.

Done when: one run uses five vendors, a local model and a custom role, and the report accounts for
every call.

### Sprint 12 · 0.13 · editors and tools

- **MCP server:** other agents can plan, run and read Concerto runs as tools.
- **VS Code and JetBrains extensions:** start a run from a selection, watch agents in a panel,
  accept stories from the diff view.
- **Neovim plugin** and an **Orca plugin** once Orca's plugin API can start terminal commands.

Done when: a run can be started, watched and accepted from VS Code without opening a terminal.

---

## Part 5 · Teams

### Sprint 13 · 0.14 · CI and pull requests

- **GitHub Action:** label an issue or comment `/concerto`, and a run opens a pull request with
  the report as its body, inside a budget.
- **GitLab CI** template.
- **Optional commit per story** and `--pr`; Concerto still never commits unless asked.
- **Machine-readable output:** `--run --json` streams one event per line.

Done when: labelling an issue in a test repository opens a reviewable pull request within the
budget, with the tests green.

### Sprint 14 · 0.15 · shared configuration and policy

- **Project config** merged over the personal one, so a team agrees on routes, budgets and
  reviewers.
- **Policy:** paths no agent may touch, models not allowed, maximum spend per run, required
  reviewers for sensitive paths.
- **Notifications** to Slack, Discord or a webhook when a run ends or needs a decision.

Done when: a policy that forbids edits under `infra/` stops a story that tries, with a clear
message, in both the TUI and CI.

### Sprint 15 · 0.16 · observability

- **OpenTelemetry traces** for every run, story and model call.
- **A local dashboard** (`concerto --dashboard`): runs, costs, pass rates, slowest stories.
- **Cost reports** per repository, per week, per model, exportable as CSV.

Done when: a week of runs can be broken down by model and repository without reading a log.

---

## Part 6 · Ready for everyone

### Sprint 16 · 0.17 · distribution

- **npm** (`npx concerto`), **Homebrew**, **Scoop**, **winget**, **AUR** and **Nix** packages,
  published by the release workflow.
- **Standalone binaries** with Node's single executable applications, so Node is not required.
- **A Docker image** for CI and remote runners.
- **Auto-update** check with a one-line changelog.

Done when: a fresh Mac, a fresh Windows machine and a fresh Ubuntu install Concerto with their
usual package manager, without installing Node first.

### Sprint 17 · 0.18 · safety

- **Optional sandbox** for every builder, not only Codex: bubblewrap on Linux, sandbox-exec on
  macOS, a container elsewhere, with network off by default.
- **Secret scanning** of every diff before it is shown or merged.
- **Audit log** of every command an agent ran, signed and kept per run.
- **Security review** of every place model output reaches a shell, a path or a file, and fuzzing
  of the plan parser and every backend's event parser.

Done when: a builder told to read `~/.ssh` or call an outside URL is stopped by the sandbox, and
the attempt is in the audit log.

### Sprint 18 · 0.19 · polish

- **Themes,** including high contrast and colour-blind safe palettes; full keyboard remapping.
- **Accessibility:** a screen-reader friendly plain mode that prints events as sentences.
- **Translations** of the TUI and docs.
- **Docs:** every flag, slash command, config key and failure message, with recipes and a public
  benchmark against single-model runs.
- **Performance budgets in CI:** startup, scoring and frame time fail the build when they regress.

Done when: every documented failure message has a test, and the benchmark is reproducible from
one command.

## 1.0 · stable

- **Stable config:** a versioned schema with migrations from every 0.x format.
- **Stable CLI and slash commands** under semantic versioning.
- **Stable event format** for `--json`, the MCP server and the Action.
- **Release notes and a migration guide** from 0.x.

---

## Beyond 1.0

- **Remote runners:** send stories to machines or cloud workers, with the TUI as the control
  room; a run survives closing the laptop.
- **Long-running goals:** a goal that spans days, planned into milestones, with a run per
  milestone and a report per day.
- **Repository memory:** conventions, past decisions and known pitfalls learned from runs and
  reviews, fed back to builders and critics.
- **Self-improving routing:** an offline evaluation suite per repository that tests new models as
  they appear and updates the routes when one does better.
- **Multi-repository changes:** one request across a service and its clients, with coordinated
  pull requests.

## Not planned

- Holding API keys. Credentials stay with Claude Code, Codex, pi and the other agents.
- A hosted service that runs code on Concerto's machines. Runs happen on yours.
