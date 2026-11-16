import { configDefaults, defineConfig } from "vitest/config";

// `#src/*` resolves to the TypeScript sources under the "source" condition (see package.json).
// dist/ is build output: a stale compiled test there must never run as part of the suite.
// CI runners (and Windows anywhere) start processes and write files several times slower; the
// fixture tests that commit 256 files and build in worktrees need more than 5 seconds there.
const SLOW_MACHINE_TIMEOUT_MS = 30_000;
const slowMachine = process.platform === "win32" || Boolean(process.env.CI);
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    // bench/: the benchmark tasks carry their own tests, run against an agent's work, not Concerto's.
    exclude: [...configDefaults.exclude, "dist/**", "bench/**"],
    setupFiles: ["tests/isolate-env.ts"],
    ...(slowMachine ? { testTimeout: SLOW_MACHINE_TIMEOUT_MS } : {}),
  },
});
