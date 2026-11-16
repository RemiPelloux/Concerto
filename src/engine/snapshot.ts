import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const STAT_WIDTH = "--stat=120";
const STAT_LINES = 60;
/** Concerto's own state and agent tool caches change on every call; they are not the build. */
const OWN_STATE = [":(exclude).concerto", ":(exclude).serena"];

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = gitEnv()): Promise<string> {
  const { stdout } = await run("git", args, { cwd, env, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

/**
 * One hash for the whole working tree, untracked files included, ignored files and Concerto's
 * own state left out. Built in a throwaway copy of the index, so the real one is never touched.
 * Null outside a Git repository.
 */
export async function worktreeSnapshot(cwd: string): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "concerto-snapshot-"));
  try {
    const index = join(dir, "index");
    const env = { ...gitEnv(), GIT_INDEX_FILE: index };
    const realIndex = resolve(cwd, await git(cwd, ["rev-parse", "--git-path", "index"]));
    await copyFile(realIndex, index).catch(() => undefined);
    await git(cwd, ["add", "--all", "--", ".", ...OWN_STATE], env);
    return await git(cwd, ["write-tree"], env);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `git diff --stat` between two snapshots, long lists cut to their head and the summary line. */
export async function snapshotStat(cwd: string, from: string, to: string): Promise<string> {
  const lines = (await git(cwd, ["diff", STAT_WIDTH, from, to]).catch(() => "")).split("\n");
  if (lines.length <= STAT_LINES) return lines.join("\n");
  return [...lines.slice(0, STAT_LINES - 1), " ...", lines.at(-1) ?? ""].join("\n");
}
