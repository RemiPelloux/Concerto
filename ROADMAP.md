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

---

## Part 1 · Trust the result

### Sprint 1 · 0.2 · isolation

Parallel stories share one folder, so they collide on shared files and a critic can fail a story
for someone else's edit.

- **One git worktree per story.** Section stories build in their own worktree; soloist stories
  keep the main folder. Worktrees are created from the same commit and removed after merge.
- **Merge back in dependency order.** A story whose dependencies passed is merged with a
  three-way merge; a conflict fails that story with the conflicting files and hunks.
- **Per-story diff.** The critic, the changes table and the report see only the story's own diff.
- **Cleanup on crash.** Leftover worktrees from an interrupted run are found and offered for
  removal at the next start.

Done when: six section stories editing neighbouring lines of the same files run in parallel, each
critic sees only its story, and the merged result passes the tests.

### Sprint 2 · 0.3 · a test gate Concerto runs itself

- **Run the covering tests after each build,** before the critic: SmartTest when the repository
  has it, the import graph otherwise, the project's own test command as the fallback.
- **Detect the test command** for npm, pnpm, yarn, bun, pytest, go test, cargo test, PHPUnit,
  Maven and Gradle.
- **Red means retry,** with the failing test names and output condensed into the builder's
  feedback. The critic only reviews green stories.
- **Type check and lint gates,** configurable per repository.
- **Flaky test handling:** a test that fails then passes on rerun is marked flaky in the report,
  not counted against the story.

Done when: a story whose tests fail never reaches the critic, and the report lists every test that
ran for every story.

### Sprint 3 · 0.4 · verification beyond tests

- **Acceptance checks as code.** The scorer writes each acceptance item as a runnable check
  (a command, a request, a file assertion) when it can; Concerto runs them.
- **Mutation spot checks.** For a story that adds tests, flip one condition in the new code and
  check that a test fails; a test that passes with the feature broken fails the story.
- **Behaviour diff.** For web projects, start the dev server before and after and compare chosen
  routes.
- **Critic disagreement.** A second critic from another vendor reviews high-risk stories; when the
  two disagree the conductor decides.

Done when: a story with a test that passes with the feature deleted is caught on 9 of 10 seeded
examples.

---

## Part 2 · Smarter routing and lower cost

### Sprint 4 · 0.5 · learn from runs

- **Run history as data.** Every story's factors, model, retries, review result, tokens and cost
  go into a local SQLite file.
- **Calibrated score.** Factor weights are fitted to that history per repository, with a minimum
  sample size and the hand-set weights as the prior.
- **Calibrated estimates.** Cost per point per model replaces the fixed constant.
- **Per-model track record** by story type, used to break ties and to pick the reviewer.
- **`concerto --insights`:** which models pass which kinds of stories, where money goes, which
  files keep failing review.

Done when: on a repository with 20 recorded runs, the estimate lands within 30 % of the real cost
for 8 runs out of 10.

### Sprint 5 · 0.6 · rate limits, budgets and quotas

- **Subscription awareness.** Read Claude Code's 5-hour window and Codex's usage, and move work to
  the next way of reaching a model before the limit hits.
- **Budgets per story, per run, per day** and per repository, with a warning at 80 %.
- **Price book updates** from the providers' public pricing, cached, with the date shown.
- **Cheapest-path planner.** Before building, show what the plan would cost on subscriptions,
  through a proxy and on API keys, and let the user pick.

Done when: a run that would cross the Claude Code window moves the remaining stories to the next
provider without a single failed call.

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
