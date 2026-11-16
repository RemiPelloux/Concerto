import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";
import type { FileChange } from "#src/state/types.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16_777_216;
const READ_CONCURRENCY = 32;
const BINARY_SAMPLE_BYTES = 8_000;
const NEWLINE = 10;
const ATTRIBUTE_FIELDS = 3;
/** Concerto's own state and agent tool caches (Serena) are not part of the change. */
const OWN_STATE = /^\.(?:concerto|serena)\//;

async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const pending = run("git", args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: gitEnv() });
  pending.child?.stdin?.end(input);
  const { stdout } = await pending;
  return stdout;
}

/** Honor attributes and configured diff-driver binary overrides in two calls for all files. */
async function binaryModes(cwd: string, files: string[]): Promise<Map<string, boolean>> {
  if (files.length === 0) return new Map();
  const [attributes, config] = await Promise.all([
    git(cwd, ["check-attr", "-z", "--stdin", "diff"], `${files.join("\0")}\0`),
    git(cwd, ["config", "--null", "--type=bool", "--get-regexp", "^diff\\..*\\.binary$"]).catch(() => ""),
  ]);
  const drivers = new Map(config.split("\0").filter(Boolean).map((entry) => {
    const [key = "", value] = entry.split("\n");
    return [key, value === "true"] as const;
  }));
  const modes = new Map<string, boolean>();
  const fields = attributes.split("\0");
  for (let i = 0; i + 2 < fields.length; i += ATTRIBUTE_FIELDS) {
    const file = fields[i] ?? "";
    const value = fields[i + 2];
    const binary = value === "unset" ? true : value === "set" ? false : drivers.get(`diff.${value}.binary`);
    if (binary !== undefined) modes.set(file, binary);
  }
  return modes;
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

/** Match Git's new-file line count, including binary and unterminated text files. */
function addedLines(content: Buffer, binary?: boolean): number {
  if (binary ?? content.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) return 0;
  let added = 0;
  for (const byte of content) if (byte === NEWLINE) added += 1;
  if (content.length > 0 && content.at(-1) !== NEWLINE) added += 1;
  return added;
}

async function untrackedChange(cwd: string, file: string, binary?: boolean): Promise<FileChange[]> {
  try {
    const path = join(cwd, file);
    const stat = await lstat(path);
    const content = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    return [{ file, added: addedLines(content, stat.isSymbolicLink() ? undefined : binary), removed: 0, status: "added" }];
  } catch {
    return [];
  }
}

/**
 * What the agents changed in the working tree since the last commit, untracked files included.
 * Concerto's own `.concerto/` folder is left out. Empty outside git.
 */
export async function readChanges(cwd: string): Promise<FileChange[]> {
  try {
    const [tracked, untracked] = await Promise.all([git(cwd, ["diff", "--numstat", "HEAD"]), git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])]);
    const added = untracked.split("\0").filter((f) => f && !OWN_STATE.test(f));
    const modes = await binaryModes(cwd, added);
    const fresh: FileChange[] = [];
    for (let i = 0; i < added.length; i += READ_CONCURRENCY) {
      const batch = added.slice(i, i + READ_CONCURRENCY);
      fresh.push(...(await Promise.all(batch.map((file) => untrackedChange(cwd, file, modes.get(file))))).flat());
    }
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

/** Everything the working tree adds since the last commit, new files included, as one diff. Empty outside git. */
export async function workingDiff(cwd: string): Promise<string> {
  try {
    const [tracked, untracked] = await Promise.all([git(cwd, ["diff", "--no-color", "HEAD"]), git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])]);
    const fresh = await Promise.all(untracked.split("\0").filter((f) => f && !OWN_STATE.test(f)).map((f) => fileDiff(cwd, f)));
    return [tracked, ...fresh].join("");
  } catch {
    return "";
  }
}
