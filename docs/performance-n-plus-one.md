# Per-item subprocess fix

The fixed audit list assigns `src/engine/changes.ts` and
`src/engine/impact.ts` to this story. No database queries are involved.

Untracked changes now count file contents directly, with at most 32 concurrent
reads. Two batched Git queries preserve `.gitattributes` and diff-driver binary
overrides, alongside the existing tracked diff and untracked listing. Missing
files are skipped. Text, unterminated text, empty files, binary files, symlinks,
unusual names and attribute overrides are compared against real Git numstat.

SmartTest uses at most four batch processes for an entire uncached plan. Each
process loads the repository's installed public CLI entry once and explains its
assigned paths. Responses are matched by target path; completion order cannot
mix coverage. Per-file failures stay uncovered, and cached files launch no
additional processes. SmartTest's own per-file analysis still occurs: this fix
removes repeated process startup, not the analysis or its internal I/O.

| Concerto process boundary | Before | After |
|---|---:|---:|
| Git, 24 untracked files | 26 | 4 |
| SmartTest, eight uncached paths | 8 | 4 |
| SmartTest, 32 uncached paths | 32 | 4 |
| SmartTest, repeated cached plan | 0 | 0 |

`tests/perf.test.ts` asserts these budgets at multiple sizes, including a single
file. Small SmartTest batches use fewer than four processes. The existing
orchestrator tests now assert constant process counts instead of requiring
per-file diffs; their missing-file check spans multiple read batches.
`tests/n-plus-one.test.ts` exercises the actual batch program with a controlled
third-party CLI, including a failure between successful files in one batch, and
compares populated coverage against the installed SmartTest CLI.

## Same-machine measurement

Both captures use `pnpm perf --samples 9`, Node v26.13.0, Linux x64, one warm-up,
the same 256-source/24-untracked-file fixture and the same shared-tree changes.
The before capture ran in an isolated temporary copy with only the two owned
production files restored to their pre-fix versions. The benchmark's workload
assertions pass in both captures.

| Workload | Before median ms | After median ms | Change |
|---|---:|---:|---:|
| Untracked changes | 28.555 | 6.147 | −78.5% |
| Impact with SmartTest | 285.479 | 247.295 | −13.4% |
| Fan-out, including eight change scans | 209.553 | 49.817 | −76.2% |
| Impact without SmartTest | 5.175 | 5.265 | +1.7% |

Untracked sample ranges are 27.840–29.195 ms before and 5.357–7.197 ms after;
SmartTest ranges are 274.613–299.515 ms before and 240.804–265.590 ms after.
Other workload medians varied; there is no timing pass/fail threshold and this
does not establish a speedup for unrelated paths. Full captures are local files
`/tmp/prowfish-n-plus-one-before-verified.txt` and
`/tmp/prowfish-n-plus-one-after-verified.txt`.

## Verification and environment blocker

`pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm pelloux` pass. Pelloux reports
118 files, zero errors and zero warnings. The affected runner reports 77 passing
tests and one failure: the existing real-repository test in
`tests/ui-logic.test.ts` fails at `execFileSync("git", ...)` with
`spawnSync git EPERM`. An earlier selection also reached the same pre-existing
restriction in `tests/session-log.test.ts`. No failing tests were skipped or
loosened. A green suite remains blocked on allowing synchronous Git execution.

This sandbox also creates Node child-process stdout as a sink when piped: a
minimal `process.stdout.write("hello")` produces no captured output, whereas
`writeSync(1, "hello")` works. For tests and both comparable benchmark captures,
`NODE_OPTIONS=--require=/tmp/prowfish-node-stdio.cjs` repairs only those sink
streams using synchronous writes. This temporary test-environment shim is not
part of Concerto. Tests ran through `npx smarttest run --affected`, as required
by the story's toolchain instructions; no full-suite pass is claimed.
