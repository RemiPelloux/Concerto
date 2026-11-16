import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { mergeThree, type FileRecord } from "#src/engine/merge.js";
import { gitEnv } from "#src/runner/env.js";

const run = promisify(execFile);
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const MAX_BUFFER = 67_108_864;

type Stored = { file: string; before: string | null; after: string | null };
export type Hunk = { file: string; index: number; header: string; text: string };

const mergesFile = (cwd: string, runId: string, storyId: string) => join(cwd, ".concerto", "merges", runId, `${storyId}.json`);
const rejectedDir = (cwd: string) => join(cwd, ".concerto", "rejected");
const read = (path: string): Buffer | null => (existsSync(path) ? readFileSync(path) : null);
const b64 = (b: Buffer | null) => (b ? b.toString("base64") : null);
const unb64 = (s: string | null) => (s === null ? null : Buffer.from(s, "base64"));

function write(path: string, text: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, text, { mode: FILE_MODE });
}

/** Keeps what a story's merge wrote, before and after, so it can be rejected later. */
export function saveMerge(cwd: string, at: { runId: string; storyId: string }, records: FileRecord[]): void {
  write(mergesFile(cwd, at.runId, at.storyId), JSON.stringify(records.map((r): Stored => ({ file: r.file, before: b64(r.before), after: b64(r.after) }))));
}

export function loadMerge(cwd: string, at: { runId: string; storyId: string }): FileRecord[] | null {
  const file = mergesFile(cwd, at.runId, at.storyId);
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, "utf8")) as Stored[]).map((r) => ({ file: r.file, before: unb64(r.before), after: unb64(r.after) }));
}

/** The story's change as a unified diff, `a/<file>` to `b/<file>`, as git prints it. */
export async function storyPatch(records: FileRecord[]): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), "concerto-patch-"));
  try {
    const parts = await Promise.all(records.map(async (r) => {
      [["a", r.before], ["b", r.after]].forEach(([side, bytes]) => bytes && write(join(scratch, side as string, r.file), bytes as Buffer));
      const [from, to] = [r.before ? `a/${r.file}` : "/dev/null", r.after ? `b/${r.file}` : "/dev/null"];
      return run("git", ["diff", "--no-index", "--no-prefix", "--binary", from, to], { cwd: scratch, env: gitEnv(), maxBuffer: MAX_BUFFER }).then(({ stdout }) => stdout, (e: { stdout?: string }) => e.stdout ?? "");
    }));
    return parts.join("");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Every hunk of a story's change, numbered from 1 per story, with the header that applies it. */
export function hunksOf(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  for (const section of patch.split(/(?=^diff --git )/m).filter(Boolean)) {
    const [head = "", ...bodies] = section.split(/(?=^@@ )/m);
    const file = /^\+\+\+ b\/(.+)$/m.exec(head)?.[1] ?? /^--- a\/(.+)$/m.exec(head)?.[1] ?? "";
    bodies.forEach((text) => hunks.push({ file, index: hunks.length + 1, header: head, text }));
  }
  return hunks;
}

/** Saves rejected work where it can be applied again with `git apply`. */
function stash(cwd: string, name: string, patch: string): string {
  const path = join(rejectedDir(cwd), `${name}.patch`);
  write(path, patch);
  return path;
}

type Revert = { path: string; bytes: Buffer | null } | { conflict: string };

async function revertOne(cwd: string, r: FileRecord): Promise<Revert> {
  const path = join(cwd, r.file);
  const now = read(path);
  if (!r.after) return now ? { conflict: `${r.file}: written again since the story deleted it` } : { path, bytes: r.before };
  if (!now) return { conflict: `${r.file}: deleted since the story changed it` };
  if (!r.before) return now.equals(r.after) ? { path, bytes: null } : { conflict: `${r.file}: changed since the story added it` };
  const merged = await mergeThree(now, r.after, r.before);
  return merged.bytes ? { path, bytes: merged.bytes } : { conflict: `${r.file}: ${merged.hunk}` };
}

/**
 * Takes a merged story back out of the main folder: its change is reverted with a three-way
 * merge, so work that landed after it stays. All files or none. The rejected change is saved in
 * .concerto/rejected/ to apply again later.
 */
export async function rejectStory(cwd: string, at: { runId: string; storyId: string }): Promise<{ reverted: string[]; conflicts: string[]; saved: string }> {
  const records = loadMerge(cwd, at);
  if (!records) throw new Error(`Nothing merged for "${at.storyId}" in this run to take back.`);
  const steps = await Promise.all(records.map((r) => revertOne(cwd, r)));
  const conflicts = steps.flatMap((s) => ("conflict" in s ? [s.conflict] : []));
  if (conflicts.length > 0) return { reverted: [], conflicts, saved: "" };
  const saved = stash(cwd, `${at.runId}-${at.storyId}`, await storyPatch(records));
  steps.forEach((s) => "path" in s && (s.bytes ? write(s.path, s.bytes) : rmSync(s.path, { force: true })));
  rmSync(mergesFile(cwd, at.runId, at.storyId), { force: true });
  return { reverted: records.map((r) => r.file), conflicts: [], saved };
}

/** Takes one hunk of a merged story back out of the main folder, saved like a whole story. */
export async function rejectHunk(cwd: string, at: { runId: string; storyId: string; index: number }): Promise<{ file: string; saved: string }> {
  const records = loadMerge(cwd, at);
  const hunk = records ? hunksOf(await storyPatch(records)).find((h) => h.index === at.index) : undefined;
  if (!hunk) throw new Error(`No hunk ${at.index} in "${at.storyId}". /hunks ${at.storyId} lists them.`);
  const patch = `${hunk.header}${hunk.text}`;
  await new Promise<void>((resolve, reject) => {
    // core.autocrlf off: on Windows git would otherwise rewrite the whole file's line endings.
    const child = execFile("git", ["-c", "core.autocrlf=false", "apply", "-R", "--whitespace=nowarn", "-"], { cwd, env: gitEnv() }, (error, _out, stderr) => (error ? reject(new Error(`The hunk no longer applies: ${stderr.trim()}`)) : resolve()));
    child.stdin?.end(patch);
  });
  return { file: hunk.file, saved: stash(cwd, `${at.runId}-${at.storyId}-hunk-${at.index}`, patch) };
}
