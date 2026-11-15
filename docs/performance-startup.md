# CLI startup follow-up

The lazy-loading story has a confirmed import failure beyond the original help
baseline: `main.ts` imports `runner/index.ts`, which imports all three backends.
Discovery and doctor also import those backends for their executable-name helpers.
Before the fix, fresh source CLI processes for doctor, models, clear-cache and a
missing plan request loaded four runner modules (`index`, `claude`, `codex`, `pi`).
The help command already loaded none of them.

The fix loads the runner inside plan, headless and interactive execution and
moves executable-name helpers into `runner/bins.ts`. Discovery and doctor now
import those helpers without importing backend execution code. Environment
variable overrides and executable defaults are preserved.

## Deterministic check

`tests/startup.test.ts` records actual module loads in fresh CLI processes using
Node's synchronous module hooks. It executes real argument parsing, setup,
discovery and diagnostic commands. Only the external Claude executable is a
fixture. No application modules are mocked.

All seven checks pass: help, doctor, models, clear-cache and a missing plan request
load zero backend or UI modules; plan and run with a request load the runner,
reject an invalid scorer plan and do not load the UI. Before the fix, the
backend-exclusion assertions failed with four loaded runner modules.

## Timings

Run `pnpm build`, then `node --import tsx scripts/perf-startup.ts`.
An optional positional argument selects another built `cli.js` for comparison.
The script uses one warm-up and five fresh processes per command, validates
successful nonempty output, and prints all samples and medians. It uses a temporary
working directory, an empty PATH and pi registry, and the bundled configuration.
The current Node executable stands in for an installed Claude binary during
existence checks; these commands never execute that backend. No network calls or
model processes run. The timer measures process creation through exit, excluding
fixture setup, output validation and cleanup. This differs from the broader
`pnpm perf` startup timer, so compare only runs using this script.

Measured on 2026-11-15, Linux x64, Node v26.13.0. The comparison build copies the
current built tree and replaces only the six changed existing modules with
transpiled versions from HEAD (`9538020`), retaining the same configuration and
dependencies. This isolates the startup change from concurrent stories. Both
runs use the same script, host and configuration. Shared-host scheduling noise
remains; timing values are informational, with no test threshold.

| Command | Before median ms | After median ms | Before samples ms | After samples ms |
|---|---:|---:|---|---|
| help | 25.855 | 25.738 | 23.962, 27.081, 25.855, 27.071, 25.275 | 26.800, 26.204, 23.143, 24.429, 25.738 |
| doctor | 125.945 | 83.668 | 117.157, 129.365, 129.294, 120.700, 125.945 | 83.357, 83.668, 83.330, 84.545, 87.525 |
| models | 116.349 | 83.113 | 116.381, 116.349, 108.613, 129.954, 106.520 | 81.095, 85.379, 82.559, 87.239, 83.113 |
| clear-cache | 101.512 | 86.234 | 102.083, 101.932, 101.512, 88.725, 93.094 | 87.934, 88.414, 86.234, 85.792, 86.209 |

Help's difference is noise: its code and imports are unchanged. The original
acceptance requirement for a help improvement over the 24.710 ms baseline is
unconfirmed and intentionally closed as a no-op. The measurable behavior change
is zero backend imports for diagnostics; the diagnostic timing reductions above
are observations on this host, not a guaranteed speedup.

## Verification

Typecheck, build, scoped ESLint and Pelloux audit pass. The affected command
`npx smarttest run --affected` ran all 17 selected test files: 105 passed and two
failed. All seven startup tests passed. The remaining failures are the existing
sandbox restrictions in `tests/orca.test.ts` (`spawnSync sh EPERM`) and
`tests/ui-logic.test.ts` (`spawnSync git EPERM`), also reproduced before this fix.
No tests were disabled or loosened to conceal those failures.
