# Roadmap to 1.0

Concerto works end to end today: scoring, routing across Claude Code, Codex and pi, review,
fallbacks, the token engine, probes, session history and resume, and installers for Linux, macOS
and Windows. This page is the plan from 0.1 to 1.0 in two-week sprints. Each sprint has one goal,
the work that serves it, and a test that says when it is done. Dates are targets, not promises.

## Shipped

| Version | What it brought |
|---|---|
| 0.1.0 | Scoring, routing, critic, conductor checkpoints, token engine, TUI, probes, skills, Orca |
| 0.1.1 | Session id and log, Haiku 5.5 for small stories, faster rendering and scoring |
| 0.1.2 | Tab works in every phase, a visible "enter to build" |
| 0.1.3 | Windows support, release packages and installers, `/history` and `--resume`, a live agent panel |

## Sprint 1 · 0.2 · trust the result · 16 to 29 November 2026

Today a builder that says "tests pass" is only checked by another model, and parallel stories
share one folder, so a critic can fail a story for someone else's edit.

- **One worktree per parallel story.** Each section story builds in its own git worktree and is
  merged back in dependency order. A merge conflict fails that story with the conflicting files.
- **A test gate Concerto runs itself.** After each build, run the covering tests (SmartTest, or the
  project's test command) before the critic, and fail the story on red.
- **Rate-limit aware routing.** Read how much of Claude Code's 5-hour window is used and move work
  to the next model in the chain before the limit hits, not after a failed call.

Done when: two section stories editing neighbouring files both pass in one run, and a story whose
tests fail never reaches the critic.

## Sprint 2 · 0.3 · learn from runs · 30 November to 13 December

The score weights and the cost estimate are set by hand.

- **Calibrate the score.** Record each story's factors, retries, review failures and cost; fit the
  factor weights to that history, per repository.
- **Calibrate the cost estimate.** Replace the fixed tokens-per-point constant with what past runs
  spent per point, per model.
- **Per-model track record.** Pass rate and retries by model and story type, used to break ties
  between two otherwise equal models.

Done when: on a repository with 20 recorded runs, the estimate lands within 30 % of the real cost
for 8 runs out of 10.

## Sprint 3 · 0.4 · reach · 14 to 27 December

- **Import graph for more languages:** Go, Rust, PHP, Java and Kotlin, plus workspace packages.
- **Pull requests:** an optional commit per story and `--pr` to open a pull request with the run
  report as its description. Concerto still never commits unless asked.
- **Resumable Codex sessions** with `codex exec resume`, so a retry stops resending everything.

Done when: a Go and a Rust repository score with real importers and covering tests, and `--pr`
opens a reviewable pull request.

## Sprint 4 · 0.5 · teams and CI · 4 to 17 January 2027

- **A GitHub Action:** run a request from an issue or a comment, with `--budget`, and post the
  report.
- **Machine-readable output:** `--run --json` prints one JSON event per line for scripts.
- **Shared project config:** `concerto.config.json` in the repository merges over the personal
  one, so a team agrees on routes and budgets.

Done when: labelling an issue `concerto` in a test repository opens a pull request within the
budget, with the report as its body.

## Sprint 5 · 0.6 · distribution · 18 to 31 January

- **npm** (`npx concerto`), **Homebrew** and **Scoop** packages, published by the release workflow.
- **Standalone binaries** with Node's single executable applications, so Node is not required.
- **An Orca plugin** once Orca's plugin API can start terminal commands.
- **A recorded demo** of a real run for the README and the docs.

Done when: a fresh Mac, a fresh Windows machine and a fresh Ubuntu install Concerto with their
usual package manager, without installing Node first.

## Sprint 6 · 0.7 · control during a run · 1 to 14 February

- **Edit the plan before building:** drop, merge or reword a story, change its model, from the TUI.
- **Accept or reject per story:** after a run, keep one story's diff and discard another's.
- **Pause and continue** a run, and `/history` search by request or date.

Done when: a five-story plan can be trimmed to three, built, and two of the three diffs kept,
without leaving the TUI.

## Sprint 7 · 0.8 · more agents · 15 to 28 February

- **More backends:** Gemini CLI, OpenCode and Cursor's agent, each behind the same runner interface.
- **Custom roles:** a role defined in the config (a security reviewer, a docs writer) with its own
  prompt, tools and routing.

Done when: a story can be built by Gemini CLI and reviewed by a custom security role, with the
same fallbacks and accounting as the built-in roles.

## Sprint 8 · 0.9 · hardening · 1 to 14 March

- **Security review** of every place model output reaches a shell, a path or a file.
- **Fuzz** the plan parser and the event parsers of every backend.
- **Performance budgets in CI:** startup, scoring and frame time fail the build when they regress.
- **Complete docs:** every flag, slash command, config key and failure message.

Done when: the fuzzers run for an hour without a crash and every documented failure has a test.

## 1.0 · 15 to 21 March

- **Stable config:** a versioned schema with migrations from every 0.x format.
- **Stable CLI:** flags and slash commands follow semantic versioning from here on.
- **Release notes and a migration guide** from 0.x.

## Not planned

- A built-in sandbox for Claude Code and pi builders. Concerto keeps their own permission
  models and recommends a worktree; Codex's sandbox is used where it exists.
- Holding API keys. Credentials stay with Claude Code, Codex and pi.
