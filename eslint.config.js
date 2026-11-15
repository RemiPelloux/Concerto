import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Limits from .pelloux/GUIDELINES.md and the TypeScript profile.
export default [
  { ignores: ["dist/**", "node_modules/**", ".pelloux/**", ".concerto/**", "docs/**", "eslint.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js}"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 25, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 3],
      "max-depth": ["error", 3],
      "no-magic-numbers": ["warn", { ignore: [-1, 0, 1, 2], ignoreArrayIndexes: true, ignoreDefaultValues: true }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
  {
    files: ["tests/**", "**/*.test.*"],
    rules: { "max-lines-per-function": "off", "no-magic-numbers": "off" },
  },
];
