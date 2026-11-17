# Per-run file reads

The duplicate-work gate used the fan-out workload from `scripts/perf-bench.ts`:
`createFixture`, `fixtureConcert`, `scoreRequest`, then `performFixture`, including
all eight post-build change scans. The fixture contains 256 source modules and
24 untracked files; external model runners are scripted as in the existing
benchmark. Fixture creation and cleanup are excluded from counts and timings.

Measured on 2026-11-16, Linux x64, Node v26.13.1, pnpm 10.34.9. Three alternating
uncached/cached samples used fresh fixtures. Each cold run was followed by a new
concert on the same fixture, retaining the existing on-disk parse/response caches
but creating a new in-memory read cache. This is the warm workload below.

Instrumentation wrapped `node:fs.readFileSync`, `node:fs.readFile`,
`node:fs/promises.readFile` and `node:child_process.execFile` before importing the
workload, using `syncBuiltinESMExports` to update named imports. File counts cover
paths under the fixture root. Git counts use working directory plus argument
vector; these are repeated commands, not necessarily reusable queries. The
wrapper preserves execFile's promisified `{ stdout, stderr }` result and child
stdin. Uncached comparison replaces only ReadCache's methods with real filesystem
reads, leaving analysis, orchestration and Git unchanged. A prior measurement on
the original production code also recorded 462 cold file reads.

| Workload | Reads without cache | Reads with cache | Duplicates before / after |
|---|---:|---:|---:|
| Cold concert | 462 | 286 | 179 / 3 |
| New concert, warm disk caches | 211 | 43 | 173 / 5 |

All three samples had identical counts. Cold reuse removes 168 untracked-file
reads across eight build scans and eight source reads shared by import parsing
and context packs. Remaining duplicate reads include package metadata outside
this cache's callers. Each sample made 188 Git calls; that count is unchanged.
Index writes, worktree operations and queries following builds must observe the
current tree, so this change does not memoize arbitrary Git commands.

Cold medians were 324.034 ms uncached and 326.636 ms cached. Warm medians were
321.498 ms uncached and 319.049 ms cached. These instrumented samples establish
I/O reduction, not a wall-clock speedup; there is no timing threshold.

## Ownership and correctness

`BlastRadius` owns one `ParseCache`, which owns the new in-memory `ReadCache`.
Graph parsing, context packs and untracked-file scans share its bytes. Every
lookup validates device, inode, size, nanosecond modification time and change
time, including after external builder writes and deletions. ParseCache uses
the same metadata fields to avoid stale derived parses after restored mtimes.
Independent concerts have independent read caches, released with their owners;
raw contents are never written to the persistent parse cache.

Async readers of the same path and stamp share one pending read. Rejections are
removed so subsequent reads retry. Clear also drops pending ownership, preventing
late completions from repopulating the cleared cache. Binary contents are kept
as buffers. Symlink change counting still uses readlink, as before. Retained
contents are capped at 16 MiB, evicting oldest entries; larger reads are returned
without retention. Existing 32-way change-scan batching remains in place.

`tests/read-cache.test.ts` covers hits/misses, independent owners, clearing,
concurrent reads, failure/retry, late completion, restored timestamps, deletion,
recreation, binary bytes, capacity, cached/uncached equivalence and real change
scans. Its benchmark fan-out regression requires exactly 280 source/untracked
reads and no repeated path. Run with `npx smarttest run --affected`.
