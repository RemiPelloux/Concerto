import { configDefaults, defineConfig } from "vitest/config";

// `#src/*` resolves to the TypeScript sources under the "source" condition (see package.json).
// dist/ is build output: a stale compiled test there must never run as part of the suite.
// Windows runners start processes and write files several times slower; the fixture tests that
// commit 256 files and start dozens of git and SmartTest processes need more than 5 seconds there.
const WINDOWS_TIMEOUT_MS = 30_000;
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    exclude: [...configDefaults.exclude, "dist/**"],
    setupFiles: ["tests/isolate-env.ts"],
    ...(process.platform === "win32" ? { testTimeout: WINDOWS_TIMEOUT_MS } : {}),
  },
});
