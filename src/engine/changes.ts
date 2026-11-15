import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";
import type { FileChange } from "#src/state/types.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16_777_216;
const DIFF_CONCURRENCY = 4;
/** Concerto's own state and agent tool caches (Serena) are not part of the change. */
const OWN_STATE = /^\.(?:concerto|serena)\//;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: gitEnv() });
  return stdout;
}

/** `git diff --numstat` lines: "<added>\t<removed>\t<file>"; binary files show "-". */
export function parseNumstat(text: string): FileChange[] {
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [added = "0", removed = "0", file = ""] = line.split("\t");
      if (!file || OWN_STATE.test(file)) return [];
      const [a, r] = [Number(added) || 0, Number(removed) || 0];
      return [{ file, added: a, removed: r, status: a === 0 && r > 0 ? ("deleted" as const) : ("modified" as const) }];
    });
}

/**
 * What the agents changed in the working tree since the last commit, untracked files included.
 * Concerto's own `.concerto/` folder is left out. Empty outside git.
 */
export async function readChanges(cwd: string): Promise<FileChange[]> {
  try {
    const [tracked, untracked] = await Promise.all([git(cwd, ["diff", "--numstat", "HEAD"]), git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])]);
    const added = untracked.split("\0").filter((f) => f && !OWN_STATE.test(f));
    const counts: string[] = [];
    for (let i = 0; i < added.length; i += DIFF_CONCURRENCY) {
      const batch = added.slice(i, i + DIFF_CONCURRENCY);
      counts.push(...await Promise.all(batch.map((f) => git(cwd, ["diff", "--no-index", "--numstat", "/dev/null", f]).catch((e: { stdout?: string }) => e.stdout ?? ""))));
    }
    const fresh = counts.flatMap((text, i) => parseNumstat(text).map((c) => ({ ...c, file: added[i] ?? c.file, status: "added" as const })));
    return [...parseNumstat(tracked), ...fresh].sort((a, b) => b.added + b.removed - (a.added + a.removed));
  } catch {
    return [];
  }
}

/** The diff of one file against the last commit; a new file shows as all added. */
export async function fileDiff(cwd: string, file: string): Promise<string> {
  const tracked = await git(cwd, ["diff", "HEAD", "--", file]).catch(() => "");
  if (tracked) return tracked;
  return git(cwd, ["diff", "--no-index", "--", "/dev/null", file]).catch((e: { stdout?: string }) => e.stdout ?? "");
}
