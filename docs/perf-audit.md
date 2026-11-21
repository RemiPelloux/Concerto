# Performance audit

## Baseline

Measured on 2026-11-16 on Linux x64 (kernel 7.2.15), Intel Core Ultra 7 356H,
16 logical CPUs, Node v26.13.1, pnpm 10.34.9, from the `perf-baseline` worktree
at commit `b961f64`. The working tree had no other edits to the measured code.

### Commands

- `pnpm perf --samples 9` runs `pnpm build`, then `scripts/perf-bench.ts`. Each
  operation gets one untimed warm-up and nine measured samples. Workload counts
  must match the warm-up on every sample, or the run fails.
- `pnpm perf:budgets` runs `scripts/perf-budgets.ts` against `dist/cli.js`. It
  takes the median of its own samples and compares each against
  `perf-budgets.json`. It exits 1 when any value is over budget.

Both commands completed. The benchmark ran twice in a row to check repeatability.

### Cold and warm workloads

The benchmark separates the two cases the way its harness defines them:

- **Startup (cold):** a fresh `node dist/cli.js --help` process per sample.
  Output goes to a temporary file, which is read and deleted inside the timed
  region.
- **Scoring (cold):** the response cache is deleted before each sample, then one
  scorer call runs over the 256-file fixture.
- **Fan-out (warm scorer cache):** scoring runs first, then eight builds, eight
  reviews, two conductor calls and eight background change scans at concurrency
  three.
- **Other operations** run in-process and repeat the same work per sample.

The fixture is a temporary Git repository with 256 TypeScript modules in an
import chain and 24 untracked files. The runner is a fixture that replaces the
external model CLIs. Scoring, routing, impact analysis, orchestration, cache,
sessions, reports and the store are real code. No provider latency is measured.

### Medians and sample ranges

Values are milliseconds. Run 1 and run 2 are two separate invocations of
`pnpm perf --samples 9` on the same checkout. Each row shows the median and the
min–max sample range for each run.

| Operation | File | Run 1 median (range) | Run 2 median (range) | Workload counts |
|---|---|---:|---:|---|
| startup (`--help`) | `src/cli.ts` | 33.170 (31.550–36.160) | 25.492 (23.886–29.043) | 1 process |
| scoring | `src/orchestrator/score.ts` | 25.210 (23.434–29.251) | 19.617 (17.482–22.735) | 1 runner call, 8 stories |
| fan-out | `src/orchestrator/perform.ts` | 426.817 (412.049–553.633) | 367.094 (363.121–375.283) | 18 runner calls, 8 change scans |
| concert setup | `src/orchestrator/concert.ts` | 8.928 (8.635–12.430) | 7.352 (6.979–8.761) | — |
| repository snapshot | `src/engine/repo-map.ts` | 4.729 (4.524–5.115) | 3.962 (3.916–4.031) | 282 files |
| import graph | `src/engine/import-graph.ts` | 3.735 (3.617–5.583) | 3.448 (3.319–5.428) | 256 source files |
| impact without SmartTest | `src/engine/impact.ts` | 7.198 (6.733–9.462) | 6.317 (6.198–6.576) | 8 stories |
| impact with SmartTest | `src/engine/impact.ts` | 391.871 (371.223–408.527) | 363.586 (344.023–387.500) | 8 source paths |
| untracked changes | `src/engine/changes.ts` | 7.653 (7.077–8.775) | 5.788 (5.631–6.012) | 24 files |
| tool event burst | `src/orchestrator/call.ts` | 11.822 (10.705–12.752) | 9.413 (8.872–10.569) | 100 events, 12 notifications |
| identical store updates | `src/state/store.ts` | 0.095 (0.070–0.114) | 0.079 (0.060–0.100) | 1000 updates, 1 notification |

The rows overlap. Fan-out includes scoring and change scans, setup includes a
repository snapshot, and impact includes an import graph. Do not add the rows
together.

The tool event burst reports 12 store notifications for 100 events. The
earlier audit reported 106. The count depends on how the harness batches
events, so compare it only with runs that use this harness.

### Budgets

`pnpm perf:budgets` passed on the same checkout (medians of seven samples):

| Check | Measured (ms) | Budget (ms) |
|---|---:|---:|
| startup `--version` | 30.7 | 150 |
| startup `--help` | 27.1 | 150 |
| startup `--doctor` | 126.0 | 600 |
| scoring 256 files | 13.0 | 400 |
| frame | 42.7 | 160 |

The budgets were about four times a laptop median when this baseline was taken;
the current ceilings are under Results and in `perf-budgets.json`.
They are CI thresholds, not targets. A change that lowers a median should lower
its budget in the same commit.

### Bundle size

From `dist/` after `pnpm build`:

- 174 JavaScript files, 512,240 bytes raw, 209,041 bytes gzipped in total.
- `dist/cli.js` alone is 1,757 bytes raw (859 gzipped) and has two static
  imports. The rest of the code is reached through those imports.

These totals include every module in `dist/`, so they are an upper bound on
what a single command loads.

### Checks run

- `pnpm perf --samples 9` (two runs): completed, workload counts consistent.
- `pnpm perf:budgets`: all five checks passed.
- `node dist/cli.js --version` printed `concerto 1.0.1` and exited 0.
- `node dist/cli.js --help` printed the usage text and exited 0.
- `npx vitest run tests/perf.test.ts`: 14 tests passed.

### Caveats

- Medians come from one machine on one day. Run 2 was 14–23 % faster than run 1
  for startup and fan-out, so a difference below that size is noise. Repeat the
  measurement before claiming a win.
- The machine runs other processes too. Scheduling noise shows up in the upper
  end of each sample range.
- The earlier audit in `docs/performance-baseline.md` used another revision and
  another sample count. Its numbers are not comparable with this section.

## Results

Measured on 2026-11-16 in the `perf-budget-guard` worktree, Linux x64,
Node v26.13.1, pnpm 10.34.9. The build uses the checked-in configuration and
lockfile. Run `pnpm build` before `pnpm perf:budgets`; `pnpm check` now does
both after its existing checks. CI already runs the budget command after build.
No new CI job or dependency is needed.

The two post-fix runs below use the same seven-sample timing workload as the
baseline budget table. Startup launches a fresh process for each sample in an
empty directory with agent binaries missing and update checks disabled. Scoring
uses a fresh 256-source-file fixture per sample. Frame time measures 60 updates
of the scored TUI at 180 × 60 terminal cells. Counts run separately from timers.

| Timing | Baseline median ms | After run 1 ms | After run 2 ms | Old ceiling ms | New ceiling ms |
|---|---:|---:|---:|---:|---:|
| startup `--version` | 30.7 | 26.0 | 24.9 | 150 | 60 |
| startup `--help` | 27.1 | 23.9 | 23.9 | 150 | 70 |
| startup `--doctor` | 126.0 | 112.2 | 107.6 | 600 | 230 |
| scoring 256 files | 13.0 | 14.7 | 10.9 | 400 | 30 |
| frame | 42.7 | 42.5 | 44.1 | 160 | 90 |

Both invocations passed all 12 budgets. These timings do not establish a speedup:
the startup and frame differences are within the recorded baseline noise, and
scoring varies between runs. The revised timing ceilings allow at least twice
the slower post-fix medians, rounded upward. Help also allows twice the earlier
33.170 ms baseline median. CI hardware and Node 22 can differ from
this host; the deterministic counts below guard the confirmed work reductions
without relying on elapsed time.

| Count workload | Before | After (both runs) | Ceiling |
|---|---:|---:|---:|
| `workingDiff`, 24 untracked files | 50, derived from old `2 + 2N` calls | 26 | 26 |
| help: all loaded modules | not recorded | 3 | 3 |
| version: all loaded modules | not recorded | 8 | 8 |
| help: Ink, React, reconciler or orchestrator modules | 0 | 0 | 0 |
| version: Ink, React, reconciler or orchestrator modules | 0 | 0 | 0 |
| scoring runner calls | 1 | 1 | 1 |
| fan-out runner calls, 8 stories | 18 | 18 | 18 |

Git counts come from real `GIT_TRACE2_EVENT` start events scoped to
`workingDiff`; fixture creation is excluded and the previous trace environment
is restored afterward. The trace file lives inside `.git`, so it cannot add an
untracked file. Startup counts come from Node module-load hooks in separate
fresh built-CLI processes for help and version. The runner counts use the real
scorer and eight-story orchestration with the existing scripted external-model
fixture: eight builder calls, eight reviews and two conductor calls. Scoring
is prepared before fan-out and excluded from its runner count.

Count ceilings have no margin. Missing measurements, missing budgets, invalid
numbers and over-budget values fail the guard. Tests cover equality, zero
ceilings, timing/count regressions, invalid entries, actual light/heavy module
loads, process failure, and the real Git/orchestration fixture counts. Timed
startup is tested directly with failing and successful CLI stubs, so reversing
its exit-status condition fails the test in both directions.

## N+1 findings

Scope: `src/engine`, `src/orchestrator`, `src/runner`, `src/commands`, `src/ui`, non-test `.ts` and `.tsx` files.

### Method

A scan walked every file and flagged each `await` that sits inside a `for`, `while`, `for await`, or a `map`/`forEach`/`filter` callback. It tracks brace depth, so an `await` in a nested block still counts. Each flagged site was then read with its caller to decide whether it does one I/O call per data item.

Limits: the scan is text-based, so it cannot follow an `await` that sits in a helper called from a loop. Callers of every helper that does I/O were checked by hand for this audit. Synchronous I/O inside loops is outside the definition and is listed at the end.

### Verdicts

A finding is N+1 when a loop makes one awaited I/O call per item, and the number of calls grows with the data. Verdict `fix-now` means the fix belongs to the `fix-n-plus-one` story. `leave` means the cost is bounded, sequential by contract, or user-triggered, and the reason is given.

### Findings

| File | Line | Cause | Fix | Verdict |
|---|---|---|---|---|
| `src/engine/changes.ts` | 116 | `workingDiff` previously started `fileDiff` for every untracked file at once, costing two git processes per file. Called once per policy check. | Fixed: skip the tracked call for untracked files and batch `--no-index` diffs at `READ_CONCURRENCY` (32). `tests/n-plus-one.test.ts` asserts 2 + N calls, bounded concurrency and ordered output. | fix-now: resolved at the failure point; `fileDiff` is unchanged |
| `src/engine/changes.ts` | 93 | `readChanges` reads untracked files. | None. | leave: already batched at 32 files per round |
| `src/engine/merge.ts` | 157 | `mergeBack` plans each changed file. Each plan runs one `git show` for the base version (`baseBytes`, line 23), all at once. | None now. Use `git cat-file --batch` if a story ever changes hundreds of files. | leave: runs once per story merge, and the count is the files one story changed |
| `src/engine/review-work.ts` | 43 | `storyPatch` runs one `git diff --no-index` per record, all at once. | None now. | leave: only the `/hunks` command calls it, on demand |
| `src/engine/review-work.ts` | 93 | `revertOne` reads each file and runs a three-way merge, all at once. | None now. | leave: only `/reject` calls it, on demand, and the count is the story's files |
| `src/engine/blast-radius.ts` | 66 | `watchDirectories` runs one `readdir` per directory when the snapshot is rebuilt. `listFiles` (line 38) does the same for non-git repositories. | None now. | leave: a stat per directory is how changes are detected without a file watcher, and it runs once per rebuild, not per item |
| `src/engine/impact.ts` | 26 | Inside the `EXPLAIN_BATCH` script, each file is explained in turn. | None needed. | leave: already batched, with one child process per group and four groups at most |
| `src/engine/worktree.ts` | 185 | `clearLeftovers` retires each leftover worktree in turn. | None now. | leave: crash recovery only, and git worktree operations on one repository should run one at a time |
| `src/engine/checks.ts` | 105 | `runGate` runs checks in order and stops at the first failure. | None. | leave: sequential by contract |
| `src/engine/behaviour.ts` | 51 | `ready` polls the server until it answers. | None. | leave: polling by design, bounded by `readySeconds` |
| `src/engine/behaviour.ts` | 63 | `observe` makes one HTTP request per configured route, in parallel. | None. | leave: bounded by the configured routes, and each request is cheap |
| `src/engine/notify.ts` | 28 | `notify` sends one webhook per target that subscribes to the event. | None. | leave: bounded by the configured targets |
| `src/orchestrator/build.ts` | 121 | The attempts loop (also lines 125 and 149 to 158, the rounds loop). Each step calls a model or opens and closes a workspace. | None. | leave: model calls in sequence, and each step needs the previous result |
| `src/orchestrator/custom-roles.ts` | 58 | One model call per custom role, in sequence (also line 73). | None. | leave: model calls, sequential by design |
| `src/orchestrator/call.ts` | 169 | The model fallback chain tries each model in order until one answers. | None. | leave: a fallback chain is sequential by definition |
| `src/orchestrator/perform.ts` | 18 | Stories run in batches of a fixed size (also lines 58 and 59, one wave at a time). | None. | leave: already batched by size and by wave |
| `src/runner/local.ts` | 106 | The agent step loop calls the model once per step. | None. | leave: each step depends on the previous model reply |

`src/commands` has no awaited per-item loop. `src/ui` has one `await` outside a loop in `review-commands.ts`, which calls `storyPatch` once.

### Not in scope: synchronous I/O inside loops

These loops call synchronous file functions per item. They match the pattern but use no awaited I/O, so they are not N+1 findings under the definition above. Revisit them only if a profile shows them.

- `src/engine/worktree.ts` lines 88 and 121: one link or unlink per path.
- `src/engine/review-work.ts` line 97: one write or delete per step.
- `src/engine/merge.ts` line 162: one apply per step.
