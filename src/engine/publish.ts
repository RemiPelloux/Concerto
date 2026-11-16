import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitEnv } from "#src/runner/env.js";

const run = promisify(execFile);
const SLUG_WORDS = 6;
const SESSION_SUFFIX = 6;
const git = async (cwd: string, args: string[]) => (await run("git", args, { cwd, env: gitEnv() })).stdout.trim();

/** A branch name from the request: `concerto/add-a-health-endpoint-s1a2b3`. */
export function branchName(request: string, session: string): string {
  const slug = request.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, SLUG_WORDS).join("-");
  return `concerto/${slug || "run"}-${session.slice(-SESSION_SUFFIX)}`;
}

/**
 * Starts the run's branch from the current commit. The working tree must be clean: a commit per
 * story then holds only that story's work, never changes that were already lying around.
 */
export async function startBranch(cwd: string, branch: string): Promise<string> {
  const dirty = await git(cwd, ["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty) throw new Error(`--commit and --pr need a clean working tree; commit or stash first:\n${dirty}`);
  const base = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  await git(cwd, ["switch", "--quiet", "-c", branch]);
  return base;
}

export type StoryCommit = { files: string[]; title: string; body: string };

/** Commits exactly the files a story merged, with its title as the subject. Null when there is nothing. */
export async function commitStory(cwd: string, story: StoryCommit): Promise<string | null> {
  if (story.files.length === 0) return null;
  await git(cwd, ["add", "--all", "--", ...story.files]);
  const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
  if (!staged) return null;
  await git(cwd, ["commit", "--quiet", "-m", story.title, "-m", story.body, "--", ...story.files]);
  return git(cwd, ["rev-parse", "--short", "HEAD"]);
}

/** Pushes the branch and opens a pull request with `gh`, the report as its body. Returns its URL. */
export async function openPullRequest(cwd: string, pr: { branch: string; base: string; title: string; bodyFile: string }): Promise<string> {
  await git(cwd, ["push", "--quiet", "--set-upstream", "origin", pr.branch]);
  const { stdout } = await run(process.env.CONCERTO_GH_BIN || "gh", ["pr", "create", "--base", pr.base, "--head", pr.branch, "--title", pr.title, "--body-file", pr.bodyFile], { cwd, env: gitEnv() });
  return stdout.trim().split("\n").at(-1) ?? "";
}
