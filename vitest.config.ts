import { configDefaults, defineConfig } from "vitest/config";

// `#src/*` resolves to the TypeScript sources under the "source" condition (see package.json).
// dist/ is build output: a stale compiled test there must never run as part of the suite.
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: { exclude: [...configDefaults.exclude, "dist/**"] },
});
