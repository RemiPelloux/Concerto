import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 67_108_864;
const CHURN_WINDOW = "90.days";
const AREA_DEPTH = 2;

/**
 * Code where a mistake costs more than the diff suggests. Words must stand alone in the path
 * ("src/auth/", "payment-intent.ts"), so "authors.ts" is not auth code.
 */
const SENSITIVE: readonly RegExp[] = [
  /(?:^|[/._-])(?:auth|login|session|password|passwd|token|secret|crypto|security|permission|acl|payment|billing|checkout|migration|schema)s?(?=[/._-]|$)/i,
  /(?:^|\/)\.github\/workflows\//,
  /(?:^|\/)(?:Dockerfile|docker-compose[\w.-]*|\.env[\w.-]*)$/,
];

export function isSensitive(path: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(path));
}

/** "src/engine/impact.ts" -> "src/engine"; "README.md" -> "." */
export function areaOf(path: string): string {
  const parts = path.split("/");
  return parts.length === 1 ? "." : parts.slice(0, Math.min(AREA_DEPTH, parts.length - 1)).join("/");
}

/**
 * How often each file changed in the last 90 days, from one `git log` for the whole run.
 * Files that change a lot tend to break a lot. Empty outside git.
 */
export async function churnCounts(cwd: string): Promise<Map<string, number>> {
  try {
    const args = ["log", `--since=${CHURN_WINDOW}`, "--name-only", "--pretty=format:"];
    const { stdout } = await run("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: gitEnv() });
    const counts = new Map<string, number>();
    stdout.split("\n").filter(Boolean).forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
    return counts;
  } catch {
    return new Map();
  }
}
