# Roadmap

Concerto works end to end today: scoring, routing across Claude Code, Codex and pi, review,
fallbacks, the token engine, probes and reports. This page lists what is missing, in the order it
matters. Each item says why.

## 0.2: trust the result

The build loop still relies on models telling the truth about tests.

- **A test gate Concerto runs itself.** After each story, run the covering tests (SmartTest or the
  project's test command) before the critic, and fail the story on red. Today a builder that says
  "tests pass" is only checked by another model.
- **One worktree per parallel story.** Section stories run in parallel in the same tree and can
  collide on a shared file. Give each its own git worktree and merge back in dependency order.
- **Resume an interrupted run.** A crash or Esc loses the plan and progress. Save the plan and
  story states in `.concerto/runs/` and add `--resume`.
- **Rate-limit aware routing.** Claude Code reports how much of the 5-hour window is used. Move
  work to the next model in the chain before the limit hits, not after a failed call.

## 0.3: learn from runs

Weights and estimates are set by hand.

- **Calibrate the score.** Record, per story, the score, its factors and what happened: retries,
  review failures, cost. Fit the factor weights to that history, per repository.
- **Calibrate the cost estimate.** Replace the fixed tokens-per-point constant with what past runs
  actually spent per point, per model.
- **Per-model track record.** Pass rate and retries by model and story type, fed back into routing
  when two models are otherwise equal.

## 0.4: reach

- **Import graph for more languages.** Go, Rust, PHP, Java and Kotlin, plus workspace packages.
  Today the graph covers TS, JS and Python, with relative imports, package.json `imports` and
  tsconfig `paths`; SmartTest covers more when the repository uses it.
- **Pull requests.** Optional commit per story and `--pr` to open a pull request with the run
  report as its description.
- **Resumable Codex sessions.** Codex calls are stateless here, so a retry resends everything.
  Use `codex exec resume`.

## 0.5: distribution

- **npm package** (`npx concerto`), so installing does not need a clone.
- **Orca plugin**, once Orca's plugin API can start terminal commands: a "Run Concerto" command in
  the palette. Today: `concerto --orca` and an Orca quick command (see the README).
- **macOS and Windows in CI.** Only Linux is tested.
- **A recorded demo** for the README and the docs, from a real run.

## Not planned

- A built-in sandbox for Claude Code and pi builders. Concerto keeps their own permission
  models and recommends a worktree; Codex's sandbox is used where it exists.
- Holding API keys. Credentials stay with Claude Code, Codex and pi.
