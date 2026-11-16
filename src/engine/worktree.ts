import { execFile } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { excludeLocally } from "#src/engine/session-log.js";
import { gitEnv } from "#src/runner/env.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 67_108_864;
const ROOT = [".concerto", "worktrees"];
/** Ignored folders a build needs but git does not carry: linked into every worktree. */
const DEPENDENCY_DIRS = new Set(["node_modules", ".venv", "venv", "vendor", ".bundle", ".yarn", ".pnpm-store"]);
const ENV_FILE = /^\.env(\..+)?$/;
/** Windows refuses to delete a folder while a process or the virus scanner still holds it: retry. */
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;
const SNAPSHOT_IDENTITY = { GIT_AUTHOR_NAME: "Concerto", GIT_AUTHOR_EMAIL: "concerto@localhost", GIT_COMMITTER_NAME: "Concerto", GIT_COMMITTER_EMAIL: "concerto@localhost" };

export type Change = { status: "A" | "M" | "D"; file: string };
export type Worktree = { dir: string; base: string; links: string[] };

export async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = gitEnv()): Promise<string> {
  const { stdout } = await run("git", args, { cwd, env, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  return stdout;
}

export function worktreeRoot(cwd: string): string {
  return join(cwd, ...ROOT);
}

/**
 * A commit of the working tree as it is now, untracked files included and ignored ones left out,
 * built in a throwaway index: the user's index, HEAD and branches are not touched.
 */
export async function snapshot(cwd: string): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), "concerto-index-"));
  const env = { ...gitEnv(), ...SNAPSHOT_IDENTITY, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    const head = (await git(cwd, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).trim();
    if (head) await git(cwd, ["read-tree", head], env);
    await git(cwd, ["add", "-A"], env);
    const tree = (await git(cwd, ["write-tree"], env)).trim();
    return (await git(cwd, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", "concerto snapshot"], env)).trim();
  } finally {
    rmSync(scratch, REMOVE);
  }
}

/** Ignored dependency folders and .env files of the main folder, as paths relative to it. */
async function needed(cwd: string): Promise<string[]> {
  const out = await git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  return out.split("\0").filter(Boolean).map((p) => p.replace(/\/$/, "")).filter((p) => !p.startsWith(".concerto"))
    .filter((p) => DEPENDENCY_DIRS.has(basename(p)) || ENV_FILE.test(basename(p)));
}

/** Links (or on Windows, junctions and copies) what the build needs from the main folder. */
function link(main: string, dir: string, path: string): void {
  const from = join(main, path);
  const to = join(dir, path);
  if (existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  const folder = lstatSync(from).isDirectory();
  if (process.platform !== "win32") return symlinkSync(from, to, folder ? "dir" : "file");
  if (folder) return symlinkSync(from, to, "junction");
  cpSync(from, to);
}

/** A detached worktree of `base` for one story, with the main folder's dependencies linked in. */
const queues = new Map<string, Promise<unknown>>();

/**
 * One `git worktree` command at a time per repository: two at once race on git's admin files
 * (`failed to read .git/worktrees/a/commondir`) when parallel stories start or end together.
 */
function oneAtATime<T>(main: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(main) ?? Promise.resolve()).then(task, task);
  queues.set(main, next.catch(() => undefined));
  return next;
}

export async function openWorktree(main: string, name: string, base: string): Promise<Worktree> {
  const dir = join(worktreeRoot(main), name);
  rmSync(dir, REMOVE);
  mkdirSync(dirname(dir), { recursive: true });
  await oneAtATime(main, () => git(main, ["worktree", "add", "--detach", "--quiet", dir, base]));
  const links = await needed(main);
  links.forEach((path) => link(main, dir, path));
  writeFileSync(`${dir}.links.json`, JSON.stringify({ base, links }));
  return { dir, base, links };
}

/** Stages the story's work in its own worktree index, leaving the linked dependencies out. */
async function stage(w: Pick<Worktree, "dir" | "links">): Promise<void> {
  await git(w.dir, ["add", "-A"]);
  if (w.links.length > 0) await git(w.dir, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...w.links]);
}

/** The story's changes as a unified diff without context lines, the linked dependencies left out. */
export async function diffText(w: Worktree): Promise<string> {
  await stage(w);
  // --no-prefix: paths as they are, whatever prefixes (a/, b/ or mnemonic) the user configured.
  return git(w.dir, ["diff", "--cached", "-U0", "--no-color", "--no-renames", "--no-prefix", w.base]);
}

/** What the story changed in its worktree since `base`, the linked dependencies left out. */
export async function changesIn(w: Worktree): Promise<Change[]> {
  await stage(w);
  const out = await git(w.dir, ["diff", "--cached", "--name-status", "--no-renames", "-z", w.base]);
  const fields = out.split("\0").filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] === "A" || fields[i] === "D" ? fields[i] : "M";
    changes.push({ status: status as Change["status"], file: fields[i + 1] ?? "" });
  }
  return changes;
}

/**
 * Removes a link without following it. A builder that ran `pnpm install` in its worktree replaced
 * the link with a folder of its own, inside the worktree: that folder goes whole.
 */
function unlink(path: string): void {
  const own = existsSync(path) && !lstatSync(path).isSymbolicLink() && lstatSync(path).isDirectory();
  rmSync(path, own ? REMOVE : { force: true });
}

/** Removes the worktree: links first, so nothing they point at is touched, then git's record. */
export async function closeWorktree(main: string, w: Pick<Worktree, "dir" | "links">): Promise<void> {
  w.links.forEach((path) => unlink(join(w.dir, path)));
  await oneAtATime(main, () => git(main, ["worktree", "remove", "--force", w.dir])).catch(() => rmSync(w.dir, REMOVE));
  rmSync(`${w.dir}.links.json`, { force: true });
  await oneAtATime(main, () => git(main, ["worktree", "prune"])).catch(() => "");
}

/**
 * Marks a run's worktrees as owned by this process, so another Concerto leaves them alone, and
 * keeps .concerto/ out of git so a snapshot never takes in Concerto's own worktrees.
 */
export function claimRun(main: string, runId: string): void {
  excludeLocally(main);
  mkdirSync(worktreeRoot(main), { recursive: true });
  writeFileSync(join(worktreeRoot(main), `${runId}.pid`), String(process.pid));
}

/** A finished run gives up its folder and its claim; failed stories' patches stay. */
export function releaseRun(main: string, runId: string): void {
  [join(worktreeRoot(main), runId), join(worktreeRoot(main), `${runId}.pid`)].forEach((p) => rmSync(p, REMOVE));
}

function alive(main: string, run: string): boolean {
  const file = join(worktreeRoot(main), `${run}.pid`);
  const pid = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a story's worktree after saving its work as `.concerto/worktrees/<label>-<run>-<story>.patch`,
 * so nothing a builder did is lost. Returns the patch path, or null when there was nothing to save.
 */
export async function retire(main: string, dir: string, label: string): Promise<string | null> {
  const meta = existsSync(`${dir}.links.json`) ? (JSON.parse(readFileSync(`${dir}.links.json`, "utf8")) as Worktree) : null;
  const w = { dir, base: meta?.base ?? "HEAD", links: meta?.links ?? [] };
  const patch = await stage(w).then(() => git(dir, ["diff", "--cached", "--binary", w.base])).catch(() => "");
  const file = patch ? join(worktreeRoot(main), `${label}-${basename(dirname(dir))}-${basename(dir)}.patch`) : null;
  if (file) writeFileSync(file, patch, { mode: 0o600 });
  await closeWorktree(main, w);
  return file;
}

/** Worktrees of runs whose Concerto process is gone: their work is saved as patches, then removed. */
export async function clearLeftovers(main: string): Promise<string[]> {
  const root = worktreeRoot(main);
  if (!existsSync(root)) return [];
  const runs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !alive(main, e.name));
  const dirs = runs.flatMap((r) => readdirSync(join(root, r.name), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, r.name, e.name)));
  const patches: string[] = [];
  for (const dir of dirs) {
    const saved = await retire(main, dir, "leftover");
    if (saved) patches.push(saved);
  }
  runs.forEach((r) => [join(root, r.name), join(root, `${r.name}.pid`)].forEach((p) => rmSync(p, REMOVE)));
  return patches;
}
