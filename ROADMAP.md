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
| 0.10.0 | Parts 2 and 3: learning from runs, account windows and budgets, a leaner token engine, a plan editor, reject and ask per story, search, replay and share |
| 0.13.0 | Part 4: import graphs for eight more languages and monorepos, five more agent CLIs, local models, custom roles, an MCP server, a Neovim plugin |
| 0.16.0 | Part 5: commits per story, pull requests, a GitHub Action, shared config and policy, notifications, traces, cost reports and a dashboard |
| 0.19.0 | Part 6: standalone executables and package managers, a Docker image, a sandbox, secret scanning and a signed audit log, themes, a plain mode, French, full docs, performance budgets |

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

## Part 2 · Smarter routing and lower cost · shipped in 0.10

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

### Sprint 6 · deeper token engine · shipped

- **A repository parse kept between runs:** the import graph re-reads only files whose size or
  modification time changed.
- **Context packs:** each builder gets what its story's files export, under 400 tokens, and only
  its neighbours in the plan; critics, who read the diff, get no repository map.
- **A request worded differently** (same content words, same numbers, same repository) reuses
  the plan without a model call.
- **Cache hit rate per role** in `concerto --stats`.

Done: the same 10-story run sends 40 % fewer prompt tokens than 0.4 (4,269 against 7,079), all ten
stories passing. Measured on what Concerto sends; what agents read on their own is only measurable
on real runs, and the context packs aim at exactly that.

---

## Part 3 · Control during a run · shipped in 0.10

### Sprint 7 · edit the plan · shipped

- **Plan editor:** `/drop`, `/merge`, `/split` (by acceptance items), `/retitle`, `/after`, and
  `/route`, `/reviewer`, `/effort`; `d`, `m` and `s` on a story in the list. Shape edits measure
  and score the changed stories again; dependencies always point at stories that exist.
- **Templates:** `/template save <name>` keeps a plan's shape in the config folder;
  `/template use <name>` or `--template <name>` has the scorer follow it.
- **Dry run:** `--plan --explain` says why each story got its score, model and estimate.

Done: a five-story plan trimmed to three, one story rerouted, and built, all from the TUI.

### Sprint 8 · review and accept · shipped

- **Accept or reject per story, and per hunk:** every merge keeps each file's before and after;
  `/reject <story>` reverts the story with a three-way merge, so later stories stay, and
  `/reject <story> <n>` takes back one hunk (`/hunks <story>` numbers them). Rejected work is
  saved in `.concerto/rejected/` as a patch that `git apply` brings back.
- **Side-by-side diff** on wide terminals, changed words marked, light syntax colour.
- **Ask the builder:** `/ask <story> <message>` resumes the builder's session with the comment;
  the story goes through the gate, critic and merge again, alone.
- **Pause and continue** between stories.

Done: after a 4-story run, two stories kept, one kept in part, one sent back with a comment and
rebuilt without touching the others.

### Sprint 9 · history and replay · shipped

- **Session branching:** a reopened session continues as a new one that remembers its parent;
  `/redo <story>` queues a passed story again, so one story can be changed and rebuilt.
- **Replay:** every model call is recorded next to the session log; `/replay` steps through
  them with ←→, each prompt and answer in full.
- **Search:** `/history billing.ts failed` matches requests, files, models and results.
- **Share a run:** `/share` or `concerto --share <id>` writes one HTML file, with anything
  shaped like a key, token or password redacted.

Done: a failed run from last week was found by a file name, opened as a branch and rebuilt.

---

## Part 4 · Reach · shipped in 0.13

### Sprint 10 · more languages and repositories · shipped

- **Import graph** for Go, Rust, PHP, Java, Kotlin, C#, Ruby and Swift, through each one's own
  rules: `go.mod` modules, crates and `mod` files, PSR-4, declared packages and namespaces (same
  package or namespace without an import included), `require`, SwiftPM targets.
- **Monorepos:** workspace packages resolve by name; a story inside one package runs that
  package's tests (`pnpm --filter`, `yarn workspace`, `npm --workspace`, `cargo test -p`,
  `go -C`).
- **Polyglot stories** are scored with one graph that holds every language.

Done: on [eight real repositories](docs/language-benchmark.md), one per language at a pinned
release, the graph finds the importer and the test a person checked by reading the code, 8 of 8.
`pnpm bench:languages` runs it again.

### Sprint 11 · more agents and models · shipped

- **Backends:** Gemini CLI, Cursor's agent, OpenCode, Goose and Aider behind the same runner,
  with the same fallbacks and accounting. Each reads its prompt on stdin; reviewers run read-only
  in each CLI's own way; token use and cost come from each CLI's output. OpenCode was run for
  real; the others are read the way their installed code or source writes their output.
- **Local models** through Ollama and LM Studio, free, with a small tool set of Concerto's own
  (read, list, write inside the story's folder, no shell); `/setup` (or `--init`) adds them at tier 1.
- **Custom roles** in `customRoles`: reviewers that can send a story back, and builders that
  work on a passed story before its merge, each with its own instructions, models and tools.
- **The report lists every call** by model, with tokens and cost.

Done: a run through Claude Code, Codex, Gemini CLI, OpenCode and Goose (five vendors), with
scoring on an Ollama model, a security reviewer that sends a story back once and a docs writer,
has every call in the report's table. In the test suite the CLIs are scripted; a live run needs
each CLI logged in.

### Sprint 12 · editors and tools · shipped

- **MCP server:** `concerto --mcp` gives other agents `concerto_plan`, `concerto_build`,
  `concerto_run`, `concerto_status` and `concerto_sessions`, with build progress as MCP progress.
- **Neovim plugin:** `:Concerto` and `:ConcertoPlan`, on a request or the visual selection.

Done: Claude Code, given only Concerto's MCP tools, planned and built "add subtract with a test"
in a test repository; the story passed review and was merged with `npm test` green. Neovim starts
a run from a selection, tested in a real headless Neovim.

---

## Part 5 · Teams · shipped in 0.16

### Sprint 13 · CI and pull requests · built, live test pending

- **GitHub Action** (`action.yml`): label an issue `concerto` or comment `/concerto`, and a run
  opens a pull request with the report as its body, inside a budget, started only by people with
  write access. The issue's text reaches the run through the environment only.
- **GitLab CI** template that pushes a merge request.
- **Optional commit per story** (`--commit`) and `--pr`; Concerto still never commits unless asked.
- **Machine-readable output:** `--run --json` streams one event per line.

Done when: labelling an issue in a test repository opens a reviewable pull request within the
budget, with the tests green. Tested so far: commits, the branch, the push and the `gh` call
against a local remote, and the Action's script with stand-ins for `concerto` and `gh`. The live
test needs a test repository with an agent token as a secret.

### Sprint 14 · shared configuration and policy · shipped

- **Project config** merged over the personal one, so a team agrees on routes, budgets and
  reviewers while each person keeps their models.
- **Policy:** paths no agent may touch, models not allowed, a ceiling on any run's spend, and
  custom reviews required on sensitive paths.
- **Notifications** to Slack, Discord or a webhook when a run ends or a plan waits.

Done: a policy that forbids `infra/` sends back a builder that edits `infra/main.tf`, never lets
the story merge, and says so in the log of a `--run --json` run and on the TUI's screen.

### Sprint 15 · observability · shipped

- **OpenTelemetry traces** for every run, story and model call, over OTLP/HTTP, with the GenAI
  semantic-convention attributes, when an OTLP endpoint is set.
- **A local dashboard** (`concerto --dashboard`): costs per week, pass rates per repository, cost
  per model, slowest stories.
- **Cost reports** per week, repository and model (`concerto --costs`), as CSV with `--csv`.

Done: runs in two repositories over a week break down by model and repository in the table, the CSV
and the dashboard, read from the run log alone; a run's trace reaches a collector as one tree.

---

## Part 6 · Ready for everyone · shipped in 0.19

### Sprint 16 · distribution · shipped

- **Standalone executables** with Node's single executable applications, for Linux (x64, arm64),
  macOS (arm64, x64) and Windows (x64): Concerto's files are embedded and unpacked once.
- **Homebrew** and **Scoop** read this repository as a tap and a bucket, **Nix** its flake; a
  **.deb** for apt; the **AUR** PKGBUILD and **winget** manifests are attached to each release for
  submission; **npm** as `@tkmremi/concerto` once an `NPM_TOKEN` secret is set.
- **A Docker image,** `ghcr.io/remipelloux/concerto`, amd64 and arm64.
- **Update check** once a day with a one-line notice, and `concerto --update`.

Done when: a fresh Mac, a fresh Windows machine and a fresh Ubuntu install Concerto with their
usual package manager, without installing Node first. The release workflow does exactly that after
publishing: Homebrew on macOS, Scoop on Windows, apt in a bare Ubuntu container, and the Docker
image. Every push already builds the five executables and runs the .deb in a container without Node.

### Sprint 17 · safety · shipped

- **Optional sandbox** for every agent and every check: bubblewrap on Linux, sandbox-exec on
  macOS, refusing to run elsewhere; the system read-only, credentials hidden, network only to the
  model providers through Concerto's allow-listing proxy.
- **Secret scanning** of every diff before it is reviewed, shown or merged.
- **Audit log** of every command an agent ran and every refused host, each line signed over the
  one before it, kept per run.
- **Security review** of every place model output reaches a shell, a path or a file
  ([docs/security.md](docs/security.md)). It found and fixed one: a symbolic link in a story could
  copy a file from outside the project into it at merge. Fuzzing of the plan parser and every
  backend's event parser.

Done: a builder process told to read `~/.ssh` and to call example.com is stopped by the sandbox,
reaches only the host it is allowed, and both attempts are in the signed audit log.

### Sprint 18 · polish · shipped

- **Themes:** default, high contrast, colour-blind safe and mono (NO_COLOR); every single-key
  action remappable, with extra keys for Tab and the arrows.
- **Accessibility:** `--plain` says the plan and every event as sentences, for screen readers.
- **Translations:** the TUI's guiding lines in English and French; the essentials of the docs in
  [French](docs/fr/README.md).
- **Docs:** a [reference](docs/reference.md) of every flag, slash command and config key,
  generated from the code and tested against it; [recipes](docs/recipes.md); every
  [failure message](docs/failures.md); a [benchmark against one model alone](docs/benchmark-single.md),
  rerun with `pnpm bench:single`. It found Concerto slower and costlier than one model on
  one-file tasks, with one more hidden test passed.
- **Performance budgets in CI:** startup, scoring and frame time fail the build when they pass
  their budgets.

Done: each of the 39 documented failure messages is triggered by a test, and a new error without a
row fails the build; the benchmark runs from one command.

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
