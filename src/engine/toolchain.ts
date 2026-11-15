import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { onPath } from "#src/models/discover.js";

export type Toolchain = { packageManager: string; rtk: boolean; smarttest: boolean };

const LOCKFILES: ReadonlyArray<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

export function detectToolchain(cwd: string): Toolchain {
  const lock = LOCKFILES.find(([file]) => existsSync(join(cwd, file)));
  const smarttest = readdirSync(cwd).some((f) => f.startsWith("smarttest.config."));
  return { packageManager: lock?.[1] ?? "", rtk: onPath("rtk"), smarttest };
}

/**
 * Static, per-repository instructions that save tokens inside the agents. They sit in the
 * cached system prompt, so they cost nothing after the first call.
 */
export function toolchainNotes(t: Toolchain): string {
  const notes = ["## Toolchain"];
  if (t.packageManager) notes.push(`- This repository uses ${t.packageManager}. Use it for scripts and installs.`);
  if (t.smarttest) notes.push("- Run only the tests a change can reach: `npx smarttest run --affected`.");
  if (t.rtk) {
    notes.push("- Shell output costs tokens. Prefix commands with `rtk` for condensed output: `rtk git diff`,");
    notes.push("  `rtk test <test command>`, `rtk grep <pattern>`, `rtk read <file>`. Use the raw command only when");
    notes.push("  you need the exact bytes.");
  }
  return notes.length > 1 ? notes.join("\n") : "";
}
