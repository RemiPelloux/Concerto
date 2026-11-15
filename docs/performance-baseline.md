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
from revision `887318b` with concurrent banner/CLI attribution edits in the
working tree (including help output); benchmark and engine sources unchanged.
The successful command was
`pnpm perf --samples 9` (including `pnpm build`). Each operation has one
warm-up and nine measured samples. All workload-count consistency assertions
passed. No validation commands from this audit ran during the captured run; other
builders were active on the shared host and can add scheduling noise. Values are milliseconds, ranked by median.

These scopes overlap: fan-out includes scoring and change scans, setup includes
a repository snapshot, and impact includes an import graph. Do not sum rows or
interpret them as exclusive CPU costs. The older five-sample baseline used a
different revision; these numbers establish the before-fix reference for this
run, not a before/after improvement claim.

| Rank | Operation | File | Median ms | Sample range ms | Workload / finding |
|---|---|---|---:|---:|---|
| 1 | impact with SmartTest | `src/engine/impact.ts` | 588.053 | 514.273–623.891 | Eight distinct source paths; one explain process per path, at most four concurrent. |
| 2 | fan-out | `src/orchestrator/perform.ts` | 313.342 | 277.406–426.231 | Eight builds, eight reviews, two conductor calls, eight completed change scans; concurrency three. |
| 3 | untracked changes | `src/engine/changes.ts` | 69.220 | 50.557–83.501 | 24 untracked one-line files; two Git listing/diff calls plus 24 per-file diff processes (source-derived). |
| 4 | startup | `src/cli.ts` | 42.144 | 40.202–48.941 | One fresh built CLI process through --help, with output validation. |
| 5 | scoring | `src/orchestrator/score.ts` | 21.469 | 19.037–23.827 | Eight stories, one fixture scorer call; includes setup and a cold response cache. |
| 6 | impact without SmartTest | `src/engine/impact.ts` | 11.748 | 11.168–12.431 | Eight stories; fresh impact snapshot, import graph and churn query. |
| 7 | tool event burst | `src/orchestrator/call.ts` | 10.936 | 9.286–12.079 | 100 tool events; 106 actual store notifications. |
| 8 | concert setup | `src/orchestrator/concert.ts` | 8.632 | 7.410–9.521 | Cache prune, prompts, sessions, repository snapshot and blast-radius metadata setup. |
| 9 | repository snapshot | `src/engine/repo-map.ts` | 6.364 | 6.018–7.872 | 282 fixture repository paths. |
| 10 | import graph | `src/engine/import-graph.ts` | 4.716 | 4.606–7.400 | Synchronous scan of 256 TypeScript modules and dependent lookup. |

The eleventh operation, 1,000 identical role-note updates in
`src/state/store.ts`, has median 0.137 ms (range 0.097–0.180 ms) and **one**
listener notification. Equal role patches are already suppressed at line 69.
The previous 1,000-notification observation no longer describes this checkout.

## Fixed ownership for the follow-up stories

This is the binding fix list for this run. Each production file has one owner;
other findings below are deferred rather than permission to expand scope.

| Owning story | File + line at audited revision | Authorized target and proof required |
|---|---|---|
| `fix-n-plus-one` | `src/engine/changes.ts:42` | Remove one `git diff --no-index` subprocess per untracked file. Keep `added` counts and existing failure behavior; cover text, binary, empty and missing files. Assert subprocess counts in `tests/perf.test.ts`; compare the 24-file median against 69.220 ms. |
| `fix-n-plus-one` | `src/engine/impact.ts:51`, `:63` | Reduce per-distinct-path SmartTest explain subprocesses; preserve per-file coverage and failure behavior. Already deduplicated, capped at four workers and cache-aware. Assert subprocess counts in `tests/perf.test.ts`; compare the eight-path median against 588.053 ms. |
| `fix-perf-hotpaths` | `src/state/store.ts:65`, `:120` | Reduce remaining repeated tool-trail notifications while preserving state and final/error updates. Equal role patches already emit once. Assert notification counts in `tests/perf.test.ts`; reference 106 notifications / 100 events, 10.936 ms tool burst, and one notification / 1,000 identical role updates, 0.137 ms. |
| `fix-code-smells` | No files | Drop the story: Pelloux and lint both pass, and the legacy baseline has zero entries. Do not invent a refactor or re-seed. |

`fix-perf-hotpaths` must not edit `changes.ts` or `impact.ts`. The shared
`tests/perf.test.ts` belongs to both fix stories only for their respective
count assertions: sequence edits or merge them without overwriting. No timing
has a pass/fail threshold. Re-run the same nine-sample command on this machine
and report before/after medians plus deterministic count changes for each fix.
Current harness counts measure workload and subscriptions; subprocess totals
above are derived from source, not instrumented measurements.

## Per-item I/O candidate inventory

There is no database or SQL query layer. Here, “N+1” means repeated local
subprocesses or filesystem operations. Locations refer to revision `887318b`.
Candidates are not automatically defects; required reads and independent model
calls still need to happen.

| File + line | Per-item operation | Classification / disposition |
|---|---|---|
| `src/engine/changes.ts:40–42` | One Git diff subprocess per untracked file, four at a time. | Confirmed subprocess fan-out; `fix-n-plus-one`. |
| `src/engine/impact.ts:59–65` | One explain subprocess per distinct uncached source path, four workers. | Confirmed subprocess fan-out; `fix-n-plus-one`. |
| `src/orchestrator/build.ts:33` | One background whole-tree `readChanges` scan per build attempt. | Amplifies the changes target: eight completed scans in fan-out. Deferred caller change; no second owner. |
| `src/engine/import-graph.ts:67`, `:87–88` | Source stat and synchronous read per module (cap 5,000 files, 256 KiB each). | Measured 4.716 ms / 256 modules; required cold reads. Cache already exists in `BlastRadius`; no new graph-cache project. |
| `src/engine/blast-radius.ts:54`, `:58–61`, `:65` | Stat per watched path, directory read per directory; metadata checked again on reuse. | Existing invalidation/cache implementation; cold work included in impact, warm reuse not separately benchmarked. Defer. |
| `src/engine/session-log.ts:29` | Two synchronous stats per sort comparison, then unlink per old log. | Potential redundant metadata reads; log pruning is outside this fixture, defer pending measurement. |
| `src/engine/session-log.ts:60–64`, `src/state/store.ts:100` | Exists check and synchronous log append for each agent line through a configured sink. | Real session-log I/O candidate; fixture uses a no-op sink, so no measured disk-write cost. Defer. |
| `src/engine/response-cache.ts:78`, `:81`, `:88` | Stat per cache entry during prune; unlink per expired/cleared entry. | Necessary maintenance; fixture does not model a populated cache directory. Defer. |
| `src/engine/system-prompts.ts:41` | Read each role prompt fragment on first use. | Role prompt files are memoized; required cold reads, defer. |
| `src/models/discover.ts:15`, `:61`, `:114` | PATH existence checks, three config metadata checks, per-model profile existence check. | Startup/discovery candidate; help exits before discovery and fixture uses a fixed catalog. Defer. |
| `src/orchestrator/skills.ts:11–14`, `src/commands/skills.ts:19`, `:30–31` | Existence check per configured skill; recursive copy per skill and install target. | Configuration/install work, not measured hot-path evidence. Defer. |
| `src/setup/probe.ts:55–56`, `src/orchestrator/perform.ts:12–13`, `src/orchestrator/call.ts:101` | Independent provider probe/build/review or fallback invocation per item. | Deliberate independent work; external provider latency is excluded. Do not collapse model calls as an N+1 fix. |

## Limits and measurement boundaries

`pnpm pelloux`: 117 files, zero errors, zero warnings.
`pnpm lint`: exit 0 with `--max-warnings 0`.
`pelloux-baseline.json`: `entries` is empty. There are no violations to classify
as smells or legacy exceptions, and no baseline update is warranted.

SmartTest impact is the largest measured scope. The fixture has no tests and
therefore measures uncovered source analysis, not correctness of populated
coverage results. Follow-up tests must protect per-file coverage and errors.
Each direct impact benchmark constructs a fresh cache; it does not demonstrate
that repeated concert-scoped impact analysis rereads sources. Production
`createConcert` already owns a reusable `BlastRadius` cache.

Store subscription counts are actual notifications, not Ink render counts.
The fixture's store sink does no disk I/O; this does not prove production
logging is free. Tool burst includes concert setup, so its 10.936 ms median
cannot be attributed wholly to notification overhead. Help startup, import
graph construction and setup have measured costs but no demonstrated redundant
work requiring another fix in this run.

## Historical story disposition: fix-state-io-batching

This section records an earlier run and its ownership/check results; the fixed
ownership table above governs the current run.

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

## Verification for this audit

`pnpm perf --samples 9` passes, including build and every workload assertion.
The table above records the conductor-selected nine-sample capture; full samples
and counts are saved locally in `/tmp/prowfish-audit-perf.json`. A verification
rerun also passed; its timings do not replace this reference capture.
`pnpm typecheck` and `pnpm lint` pass. `pnpm pelloux` reports 117 files,
zero errors and zero warnings.
`npx smarttest run --affected` reports 16 passing tests, one failure,
14 cached tests and 12 unselected test files. The remaining failure is the existing
`tests/ui-logic.test.ts` real-repository changes test: `spawnSync git EPERM`.
It also failed before removal. The four performance harness tests pass.
No tests were skipped, loosened or modified to hide this environment restriction;
a fully green affected suite remains blocked outside the audit story.

The critic-named keyboard/status-line changes were removed from
`src/ui/App.tsx`, `src/ui/StatusLine.tsx`, `src/ui/useNavigation.ts`,
`tests/ui-logic.test.ts` and `tests/ui.test.tsx`. Their pre-removal patch is
saved locally in `/tmp/concerto-audit-ui-review.patch`. A source/test search
finds no `DBG`, `console.log` or `console.debug` statements. Concurrent banner,
CLI attribution and site changes belong to other work and were left untouched.

Per the conductor’s explicit instruction, the audit commit includes only this
document. Its body records the nine-sample medians: 588.053 ms SmartTest impact,
69.220 ms untracked changes and 10.936 ms tool event burst. Concurrent working-tree
edits are excluded. Follow-up fixes must measure before and after in the same
sitting: host load makes comparisons against this reference alone unreliable.
