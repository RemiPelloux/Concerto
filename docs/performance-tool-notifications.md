# Tool notification performance

The [audit ownership list](performance-baseline.md#fixed-ownership-for-the-follow-up-stories)
assigns `fix-perf-hotpaths` only the repeated tool-trail notifications in
`src/state/store.ts`. No startup, change scanning or impact analysis code was
changed by this story.

`Store.tool` now returns when the six visible entries already equal the incoming
tool name: shifting that trail would leave every entry unchanged. Earlier entries
still accumulate synchronously, and a different tool name or a reset trail takes
effect immediately. There is no new cache, timer or batching queue to invalidate
or flush. Role notes, agent log lines and final success/error updates are preserved.

Before and after were measured on 2026-11-15 in the same sitting and on the same
Linux x64 host, Node v26.13.0, using `pnpm perf --samples 9`. Each operation has
one warm-up and nine measured samples. Both commands passed their builds and
all workload-count assertions. No other validation commands from this story ran
during either measurement; other builders shared the host.

| Operation | Before median ms | After median ms | Before notifications | After notifications |
|---|---:|---:|---:|---:|
| 100 identical tool events through `callRole` | 5.629 | 4.642 | 106 | 12 |
| 1,000 identical role patches (existing suppression) | 0.095 | 0.091 | 1 | 1 |

Tool-burst samples before: 5.676, 5.372, 5.507, 5.943, 5.629, 6.035, 5.522,
5.405, 6.082 ms. After: 4.643, 4.326, 4.642, 4.497, 4.695, 4.668, 4.799,
4.529, 4.482 ms. Full local captures are `/tmp/prowfish-hotpaths-before.json`
and `/tmp/prowfish-hotpaths-after.json`.

The tool scope includes concert setup, and unrelated benchmark medians also
fell between captures. The 0.987 ms timing difference cannot be attributed
entirely to this guard. The deterministic result is 94 fewer notifications
(88.7%); timings have no pass/fail threshold. These are subscription counts,
not measured Ink render counts.

All three new tests in `tests/perf.test.ts` failed before the guard: 100 versus
six direct notifications, 106 versus 12 successful-call notifications, and 107
versus 13 failed-call notifications. They now pass, covering changed tool names,
mixed trails, reset trails, unchanged snapshots, every tool log line, and final
agent completion/failure delivery. All seven performance tests pass.

`pnpm typecheck`, `pnpm lint`, `pnpm pelloux` (117 files, zero errors/warnings)
and the benchmark's `pnpm build` pass. `npx smarttest run --affected` reports
39 passing tests, one cached test and one failure: the existing real-repository
test in `tests/ui-logic.test.ts:55` cannot execute synchronous Git in this
sandbox (`spawnSync git EPERM`). That failure also occurred before the guard;
it was not skipped, loosened or modified. A fully green affected suite remains
blocked by this environment restriction.
