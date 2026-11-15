# Performance baseline

Run `pnpm perf` from the repository root. For a longer sample, run
`pnpm perf --samples 9`. The command builds the CLI, performs one warm-up for
each operation, and prints JSON containing every sample, its median in
milliseconds, and workload counts. The default is five measured samples. The
harness asserts that counts match the warm-up on every measured sample.
Compare runs on the same machine, Node version, and checkout. Build time and
initial fixture creation are excluded.

The temporary Git repository contains 256 TypeScript modules in an import chain
and 24 untracked one-line files. The request asks for eight independent module
updates with section concurrency set to three. The runner fixture replaces the
external model CLIs; scoring, routing, impact analysis, orchestration, cache,
sessions, reports, and store are real. No provider latency or token generation
is measured. Temporary files are removed on success and failure.

Startup measures a fresh built CLI process through `--help`. Help output goes
to a temporary file and is checked after the process closes; file creation,
reading and cleanup are included. This avoids empty stdout captured through
Node child-process sockets in this sandbox. It changes the capture method, so
compare future startup runs using this same harness.

Scoring includes concert creation and a cold local response cache. Fan-out
includes concert creation, scoring with the warmed scorer response cache,
eight builds, eight reviews, two conductor calls, and report persistence. The
harness subscribes before `perform` and waits for all eight background change
scans to publish their results. It asserts eight scan completions on every
sample, including warm-up, before stopping the timer or deleting the fixture.
Scans exceeding ten seconds fail the sample. Production orchestration is
unchanged.

The SmartTest scenario uses the installed real CLI in the fixture, with eight
distinct source paths. Other scenarios run before SmartTest is linked into the
fixture and use import-based coverage. The fixture has no test files, so the
SmartTest measurement describes uncovered source analysis. Notification counts
come from actual store subscriptions. Runner call counts and final phases are
asserted; timings have no pass/fail threshold.

## Measured top ten

Measured on 2026-11-15, Linux x64, Node v26.13.0, Intel Core Ultra 7 356H,
from revision `9538020` plus the working-tree benchmark changes. The successful
command was `node --import tsx --conditions=source scripts/perf-bench.ts` after
`pnpm build`. Each row has five measured samples after one warm-up. Validation
commands were stopped during this run; the shared host may still add scheduling
noise. Values below are milliseconds, ranked by median cost.

These are overlapping operation scopes: fan-out includes scoring and change
scans, setup includes a repository snapshot, and impact includes an import
graph. Do not sum the rows or read them as exclusive CPU costs.

| Rank | Operation | File | Median ms | Sample range ms | Workload / finding |
|---|---|---|---:|---:|---|
| 1 | impact with SmartTest | `src/engine/impact.ts` | 280.235 | 277.817–283.509 | Eight distinct source paths; real SmartTest CLI, currently capped at four concurrent explains. |
| 2 | fan-out | `src/orchestrator/perform.ts` | 177.656 | 173.661–217.095 | Eight builds, eight reviews, two conductor calls, eight completed background change scans. |
| 3 | startup | `src/cli.ts` | 24.710 | 23.102–26.269 | One fresh built CLI process through --help, with output validation. |
| 4 | untracked changes | `src/engine/changes.ts` | 21.594 | 21.041–23.587 | 24 untracked one-line files; the current implementation starts one diff process per file. |
| 5 | scoring | `src/orchestrator/score.ts` | 11.126 | 9.803–14.287 | Eight stories, one fixture scorer call; includes setup and a cold response cache. |
| 6 | impact without SmartTest | `src/engine/impact.ts` | 4.263 | 4.142–5.109 | Import-based impact analysis for eight stories, including graph and churn queries. |
| 7 | import graph | `src/engine/import-graph.ts` | 3.933 | 3.744–4.174 | Synchronous scan of 256 TypeScript modules and a dependent lookup. |
| 8 | tool event burst | `src/orchestrator/call.ts` | 3.698 | 3.585–3.737 | 100 tool events through call/feed/store; 205 listener notifications. |
| 9 | concert setup | `src/orchestrator/concert.ts` | 3.475 | 3.057–4.181 | Cache prune, prompts, session setup and repository snapshot. |
| 10 | repository snapshot | `src/engine/repo-map.ts` | 3.085 | 2.955–3.181 | 282 paths returned from the fixture repository. |

The eleventh operation, 1,000 identical role-note updates in
`src/state/store.ts`, measured a median of 0.176 ms (range 0.145–0.211 ms) and
1,000 listener notifications. It is measured separately because it falls below
the top ten.

## What these measurements support

SmartTest impact analysis is the largest measured operation. The current tree
already caps concurrent explain processes at four; these timings do not measure
a sequential implementation or establish the benefit of that concurrency cap.
A future batching change should compare the same eight-path workload and assert
process counts in a focused test.

Change scanning costs 21.594 ms for 24 untracked files and runs eight times in
the fan-out fixture. Its per-file diff fan-out is a confirmed target for the
orchestrator story. The fan-out median now includes completion of those scans,
so later samples cannot inherit unfinished scans from earlier samples.

The synchronous import graph costs 3.933 ms for 256 modules on this fixture.
That establishes scan cost at this size; it does not measure the 5,000-file cap
or prove a large-repository event-loop delay. A cache optimization needs a
focused file-read count check and a comparison on the same fixture.

Tool events and identical store writes confirm notification amplification:
205 notifications for 100 events and 1,000 for 1,000 identical updates. The
store is in memory; this provides no evidence of repeated disk I/O. Notification
counts do not measure Ink render cost. CLI help already avoids loading the main
application. Runner streaming and UI render counts are outside this harness,
so neither is a confirmed hotspot from this baseline.

## Story disposition: fix-state-io-batching

Outcome: no-op for state disk I/O; zero source or test changes for this story.
`src/state/store.ts` holds state in memory and has no filesystem calls, state
file, pending writes, or flush API. The measured 1,000 identical updates emit
1,000 listener notifications, not disk writes. Run totals and reports are
written once in `perform`'s `finally` block (`src/orchestrator/perform.ts`),
outside the story/event loops, including when execution throws.

The batching and exit/error flush acceptance checks are inapplicable because
there is no state persistence queue. No `tests/state.test.ts` crash-path flush
test is added: doing so would require inventing persistence outside this story's
scope. Per the conductor's ownership assignment, notification coalescing and its
deterministic listener-count tests belong solely to `fix-ui-render-churn`,
including any edits to `src/state/store.ts`. This story claims no performance
improvement and does not implement that story's notification fix.

Verification for this disposition: `pnpm typecheck` and `pnpm build` pass.
`npx smarttest run --affected` reports 11 passes, 75 cached passes and seven
failures in the shared tree: `tests/orca.test.ts` (`spawnSync sh EPERM`),
`tests/ui-logic.test.ts` (`spawnSync git EPERM`), and five tests in the concurrently
added `tests/orchestrator.test.ts` (diff concurrency assertions, missing mock
arguments, and the non-repository error path). These failures are outside this
documentation-only disposition; they were not skipped or loosened.

## Verification

Typecheck, build, scoped ESLint and the repository Pelloux audit pass. All four
harness tests pass, including the scan-completion regression and rejection of a
fan-out without a scored plan. Before the fix, the regression failed because
`perform` returned before eight scan results had arrived.

The affected test command, `npx smarttest run --affected`, reports 18 passes,
67 cached passes and two existing failures: `tests/orca.test.ts` fails with
`spawnSync sh EPERM`, and `tests/ui-logic.test.ts` fails with
`spawnSync git EPERM`. Both failures were reproduced before this change and
remain unchanged. A fully passing affected suite is blocked by those process
restrictions; the complete benchmark itself succeeds.
