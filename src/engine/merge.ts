import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";
import type { Change, Worktree } from "#src/engine/worktree.js";

const run = promisify(execFile);
const MERGE_MAX_BUFFER = 67_108_864;
const CONFLICT_HUNK_LINES = 12;

/** What to do to one file of the main folder: write these bytes, delete it, or leave it. */
type Step = { file: string; write?: { bytes: Buffer; mode: number }; remove?: boolean };
type Planned = { step: Step | null; conflict: string | null };
export type MergeResult = { merged: string[]; conflicts: string[]; detail: string };

const read = (path: string): Buffer | null => (existsSync(path) ? readFileSync(path) : null);

async function baseBytes(w: Worktree, file: string): Promise<Buffer | null> {
  return run("git", ["show", `${w.base}:${file}`], { cwd: w.dir, env: gitEnv(), encoding: "buffer", maxBuffer: MERGE_MAX_BUFFER })
    .then(({ stdout }) => stdout, () => null);
}

/**
 * Git calls edits on adjacent lines one overlapping change and gives up. When no line was added or
 * removed on either side, each line can be merged on its own: take whichever side changed it.
 * Null when both sides changed the same line, or the line counts differ.
 */
export function mergeLines(ours: string, base: string, theirs: string): string | null {
  const [o, b, t] = [ours, base, theirs].map((text) => text.split("\n"));
  if (!o || !b || !t || o.length !== b.length || t.length !== b.length) return null;
  const out: string[] = [];
  for (const [i, line] of b.entries()) {
    const [mine, other] = [o[i] ?? "", t[i] ?? ""];
    if (mine !== line && other !== line && mine !== other) return null;
    out.push(mine !== line ? mine : other);
  }
  return out.join("\n");
}

/** `git merge-file` on three versions: the merged text, or the conflict it reports. */
async function threeWay(ours: Buffer, base: Buffer, theirs: Buffer): Promise<{ text: Buffer | null; hunk: string }> {
  const dir = mkdtempSync(join(tmpdir(), "concerto-merge-"));
  const [o, b, t] = ["ours", "base", "theirs"].map((n) => join(dir, n)) as [string, string, string];
  writeFileSync(o, ours);
  writeFileSync(b, base);
  writeFileSync(t, theirs);
  try {
    const { stdout } = await run("git", ["merge-file", "-p", o, b, t], { env: gitEnv(), encoding: "buffer", maxBuffer: MERGE_MAX_BUFFER });
    return { text: stdout, hunk: "" };
  } catch (error) {
    const out = (error as { stdout?: Buffer }).stdout?.toString() ?? "";
    const start = out.indexOf("<<<<<<<");
    return { text: null, hunk: start < 0 ? "binary or unreadable" : out.slice(start).split("\n").slice(0, CONFLICT_HUNK_LINES).join("\n") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NUL = 0;

function lineMerged(ours: Buffer, base: Buffer, theirs: Buffer): Buffer | null {
  if ([ours, base, theirs].some((b) => b.includes(NUL))) return null;
  const text = mergeLines(ours.toString("utf8"), base.toString("utf8"), theirs.toString("utf8"));
  return text === null ? null : Buffer.from(text, "utf8");
}

const CRLF = Buffer.from("\r\n");

/** Text with LF endings, so endings a checkout converted (Windows, autocrlf) never read as changes. */
function lf(bytes: Buffer | null): Buffer | null {
  return bytes && !bytes.includes(NUL) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : bytes;
}

/** Back to the main file's own line endings, so a merge never rewrites them. */
function inStyle(bytes: Buffer, crlf: boolean): Buffer {
  return crlf && !bytes.includes(NUL) ? Buffer.from(bytes.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8") : bytes;
}

type Versions = { ours: Buffer | null; theirs: Buffer | null; base: Buffer | null; raw: Buffer | null; crlf: boolean };

async function versions(main: string, w: Worktree, change: Change): Promise<Versions> {
  const mine = read(join(main, change.file));
  const raw = read(join(w.dir, change.file));
  const base = change.status === "A" ? null : await baseBytes(w, change.file);
  return { ours: lf(mine), theirs: lf(raw), base: lf(base), raw, crlf: Boolean(mine?.includes(CRLF)) };
}

async function plan(main: string, w: Worktree, change: Change): Promise<Planned> {
  const { ours, theirs, base, raw, crlf } = await versions(main, w, change);
  const conflict = (why: string): Planned => ({ step: null, conflict: `${change.file}: ${why}` });
  if (change.status === "D") {
    if (!ours) return { step: null, conflict: null };
    return base && ours.equals(base) ? { step: { file: change.file, remove: true }, conflict: null } : conflict("changed here, deleted by the story");
  }
  if (!theirs || !raw) return conflict("missing in the story's worktree");
  const mode = statSync(join(w.dir, change.file)).mode;
  const write = (bytes: Buffer): Planned => ({ step: { file: change.file, write: { bytes: inStyle(bytes, crlf), mode } }, conflict: null });
  if (!ours) return change.status === "A" ? { step: { file: change.file, write: { bytes: raw, mode } }, conflict: null } : conflict("deleted here, changed by the story");
  if (ours.equals(theirs)) return { step: null, conflict: null };
  if (!base || ours.equals(base)) return base ? write(theirs) : conflict("added here and by the story");
  const merged = await threeWay(ours, base, theirs);
  const text = merged.text ?? lineMerged(ours, base, theirs);
  return text ? write(text) : conflict(merged.hunk);
}

function apply(main: string, step: Step): void {
  const path = join(main, step.file);
  if (step.remove) return rmSync(path, { force: true });
  if (!step.write) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, step.write.bytes);
  chmodSync(path, step.write.mode);
}

/**
 * Brings one story's changes from its worktree into the main folder with a three-way merge
 * against the snapshot it started from, so edits that landed meanwhile are kept. All or nothing:
 * any conflict leaves the main folder untouched and is reported with its hunk.
 */
export async function mergeBack(main: string, w: Worktree, changes: Change[]): Promise<MergeResult> {
  const planned = await Promise.all(changes.map((change) => plan(main, w, change)));
  const conflicts = planned.flatMap((p) => (p.conflict ? [p.conflict] : []));
  if (conflicts.length > 0) return { merged: [], conflicts: conflicts.map((c) => c.split(":")[0] ?? c), detail: conflicts.join("\n\n") };
  const steps = planned.flatMap((p) => (p.step ? [p.step] : []));
  steps.forEach((step) => apply(main, step));
  return { merged: steps.map((s) => s.file), conflicts: [], detail: "" };
}

