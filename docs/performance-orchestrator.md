# Orchestrator change-scan result

The baseline confirms one Git diff process per untracked file in
`src/engine/changes.ts`, called after every build. Each scan now processes
untracked files in batches of four. This bounds process fan-out; it does not
reduce the total number of Git processes or cache a changing working tree.
Dependency planning already uses maps, impact analysis already shares its
lookups, and section stories already run under `swarm.maxParallel`. Those paths
are unchanged because the baseline does not establish a further optimization.

## Deterministic checks

`tests/orchestrator.test.ts` calls the real `readChanges` implementation with
only the external Git process boundary replaced. Before the fix, the peak-count
assertions failed with 24 and 96 concurrent diffs. After the fix:

| Eligible untracked files | Peak diffs before | Peak diffs after | Total Git calls |
|---:|---:|---:|---:|
| 24 | 24 | 4 | 26 |
| 96 | 96 | 4 | 98 |

The tests also verify result association, descending change-size sorting,
internal-state exclusion, continuing after a file disappears, no eligible
files, and a repository lookup failure. All five cases pass.

## Real Git comparison

Measured on 2026-11-15, Linux x64, Node v26.13.0. The same `createFixture`
workload as the baseline supplies 256 tracked modules and 24 untracked one-line
files. The comparison loads the original `HEAD` version and the modified
version of `readChanges`, warms both once, then alternates five samples of each
on that same repository. Fixture creation is excluded. Both implementations
returned identical results; all measured scans returned 24 added files with one
added line each.

| Implementation | Median ms | Samples ms |
|---|---:|---|
| Unbounded | 108.199 | 87.654, 97.287, 108.199, 116.244, 111.133 |
| Four concurrent diffs | 120.961 | 120.961, 130.096, 111.242, 138.348, 110.556 |

The cap reduces peak processes, with a roughly 12% median latency cost in this
sample. It is retained as a resource bound, not a wall-clock speed improvement.
The shared host was running other builders, so these timings should not be
compared directly to the earlier baseline's timings. No timing threshold is
used in tests.

## Validation

`pnpm typecheck`, `pnpm build`, scoped ESLint for both changed TypeScript files,
and `pnpm pelloux` pass. `npx smarttest run --affected` reports 33 passes and
58 cached passes, including all five new cases. Two failures reproduced before
the change remain: `tests/orca.test.ts` cannot `spawnSync sh` (`EPERM`), and
`tests/ui-logic.test.ts` cannot `spawnSync git` (`EPERM`). They block a fully
passing affected suite in this environment.
