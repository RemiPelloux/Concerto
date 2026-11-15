import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_FILES_LISTED = 120;
const MAX_DIRS_LISTED = 40;
const GIT_MAX_BUFFER = 67_108_864; // 64 MiB of `git ls-files` output

/** `files` is every tracked and untracked, non-ignored path: the input for impact analysis. */
export type RepoMap = { text: string; key: string; files: string[] };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  return stdout.trim();
}

/** "src/a/b.ts" counts towards "src/a". Directories sorted by size, biggest first. */
export function summarizeDirs(files: string[]): string[] {
  const counts = new Map<string, number>();
  files.forEach((f) => {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  });
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_DIRS_LISTED)
    .map(([dir, n]) => `${dir}/ (${n})`);
}

function scripts(cwd: string): string {
  const file = join(cwd, "package.json");
  if (!existsSync(file)) return "";
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
  const entries = Object.entries(pkg.scripts ?? {}).map(([name, cmd]) => `- ${name}: ${cmd}`);
  return entries.length > 0 ? ["Scripts:", ...entries].join("\n") : "";
}

function render(files: string[], cwd: string): string {
  const listing = files.length <= MAX_FILES_LISTED ? files : summarizeDirs(files);
  const label = files.length <= MAX_FILES_LISTED ? "Files" : `Directories (${files.length} files)`;
  return ["## Repository snapshot (taken when this run started)", `${label}:`, ...listing.map((l) => `- ${l}`), scripts(cwd)]
    .filter(Boolean)
    .join("\n");
}

/**
 * One map of the repository per run, the same bytes in every call, so it stays in the
 * provider's cached prefix and agents spend fewer tool calls finding their way around.
 * Keyed by the committed tree, so the local response cache misses when the code changes.
 */
export async function buildRepoMap(cwd: string): Promise<RepoMap> {
  try {
    const [tree, status, listed] = await Promise.all([
      git(cwd, ["rev-parse", "HEAD^{tree}"]).catch(() => "no-commit"),
      git(cwd, ["status", "--porcelain"]),
      git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]),
    ]);
    const files = listed.split("\n").filter(Boolean);
    return { text: render(files, cwd), key: `${tree}:${status}`, files };
  } catch {
    return { text: "", key: "no-git", files: [] };
  }
}
