# Engine scan cache check

The baseline confirms import-graph scan cost (3.933 ms for 256 modules) and
SmartTest process cost. Analysis already shares a graph across one plan; this
change retains the graph, file list and per-file coverage across later scoring
calls in the same concert. Separate concerts own separate caches. Each distinct
source still needs one SmartTest explain on a cold snapshot; this change does
not batch different sources into one CLI invocation.

File and directory metadata are validated before reuse. Changes to contents,
membership, aliases or the SmartTest executable discard graph and coverage.
Directory traversal includes empty directories so later additions invalidate.
Source parsing remains synchronous on cache misses; metadata validation is also
synchronous. There is no background watcher to close or global cache to leak.

Measured on 2026-11-15 with Node v26.13.0, using the baseline's createFixture
(256 modules, 24 untracked files), one warm-up and five alternating samples.
Compare rebuilding ImportGraph plus dependentsOf(['src/module-0.ts']) against
BlastRadius.get() plus the same lookup after its initial build. Creation of the
fixture and initial cache population are excluded. No wall-clock test threshold
is imposed; host scheduling affects these numbers.

| Operation | Median ms | Range ms |
|---|---:|---:|
| Rebuild graph and lookup | 2.721 | 2.302–2.970 |
| Validate cached snapshot and lookup | 0.519 | 0.492–0.698 |

Deterministic regressions in tests/engine.test.ts run the actual cache and
impact analysis. Two stories and repeated analysis read each source once and
walk the directory once. A second run rereads sources. Edits, additions inside
an existing empty directory and deletions refresh imports, coverage and line
counts. At the external process boundary, two stories sharing a source and
repeated analysis spawn one explain, then a source edit causes a second.
A failing external explain returns an uncovered source.
