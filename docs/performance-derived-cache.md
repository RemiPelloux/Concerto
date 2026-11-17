# Derived analysis cache gate

Disposition: drop the proposed content-keyed cache, as required by the conductor's
zero-duplicate-work gate. No new production cache or content-hash key is added.
The existing persistent `ParseCache` uses file metadata, while `BlastRadius`
shares the graph and test mappings within one concert. This is a measured scope
reduction, not a claim that the original content-hash acceptance checks shipped.

`tests/derived-cache.test.ts` now exists and runs the actual fan-out workload from
`scripts/perf-bench.ts`: `createFixture`, `fixtureConcert`, `scoreRequest` and
`performFixture`, including all eight completed post-build change scans. It wraps
real filesystem reads, Git subprocess calls and the actual ParseCache callback;
it does not replace analysis or orchestration. The fixture's model runners remain
scripted, as in the benchmark. Fixture creation and cleanup are excluded.

The cold sample uses a fresh fixture (256 sources, 24 untracked files). The warm
sample creates a new concert on the same repository, retaining disk caches and
releasing the previous concert's memory caches. Measured on 2026-11-16, Linux x64,
Node v26.13.1, pnpm 10.34.9, with the installed dependency lockfile:

| Count | Cold | Warm |
|---|---:|---:|
| Completed change scans | 8 | 8 |
| Source parse callbacks | 256 | 0 |
| Repeated source parse callbacks per path | 0 | 0 |
| Source reads | 256 | 8 |
| Repeated source reads per path | 0 | 0 |
| Git processes | 188 | 188 |
| Repeated Git command signatures | 109 | 109 |

The eight warm reads belong to context packs for the eight story sources. Git
signatures include working directory and the full argument vector. Repeated
commands around writes/builds do not establish reusable derived analysis; this
story does not cache them. The regression asserts zero repeated source parsing
and source reads, zero warm parse callbacks and the presence of repeated Git
commands. Exact Git process budgets belong to the separate perf-budget story.

Reproduce with `npx smarttest run --affected`. No timing claim or timing threshold
is appropriate: the proposed cache has no remaining duplicate parse work to save.
Existing mutation/coverage regressions remain in `tests/engine.test.ts` and
`tests/read-cache.test.ts`; no existing cache correctness behavior is changed.

Type check, build, changed-file ESLint and Pelloux audit pass. The affected run
passes this regression, the performance tests and the startup tests. Seven
existing failures in `tests/failures.test.ts` concern sandbox subprocess output,
Git `EPERM` and timeouts; they are outside this test/documentation-only change.
