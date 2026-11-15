import { defineConfig } from "vitest/config";

// `#src/*` resolves to the TypeScript sources under the "source" condition (see package.json).
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
});
