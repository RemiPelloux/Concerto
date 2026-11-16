import { readChanges } from "#src/engine/changes.js";
import { commitStory } from "#src/engine/publish.js";
import { mergeBack } from "#src/engine/merge.js";
import { saveMerge } from "#src/engine/review-work.js";
import { changesIn, closeWorktree, openWorktree, retire, snapshot, type Worktree } from "#src/engine/worktree.js";
import type { Concert } from "#src/orchestrator/concert.js";

const queues = new WeakMap<Concert, Promise<unknown>>();

/** Snapshots, new worktrees and merges all touch the main folder: one at a time per run. */
function serial<T>(c: Concert, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(c) ?? Promise.resolve()).then(work, work);
  queues.set(c, next.catch(() => undefined));
  return next;
}

/** Where a story is built: its own worktree in an isolated run, the run's folder otherwise. */
export type Workspace = { storyId: string; cwd: string; tree: Worktree | null };

export async function openWorkspace(c: Concert, storyId: string): Promise<Workspace> {
  if (!c.isolated) return { storyId, cwd: c.cwd, tree: null };
  const tree = await serial(c, async () => openWorktree(c.cwd, `${c.runId}/${storyId}`, await snapshot(c.cwd)));
  return { storyId, cwd: tree.dir, tree };
}

/** A second worktree of the story's starting snapshot, for "before" runs; removed after `use`. */
export async function withBefore<T>(c: Concert, job: { story: { id: string }; tree: Worktree }, use: (dir: string) => Promise<T>): Promise<T> {
  const tree = job.tree;
  const before = await serial(c, () => openWorktree(c.cwd, `${c.runId}/${job.story.id}-before`, tree.base));
  try {
    return await use(before.dir);
  } finally {
    await serial(c, () => closeWorktree(c.cwd, before));
  }
}

/** How a workspace ended: merged, or not; `conflict` holds the conflicting files and hunks. */
export type Ending = { merged: boolean; conflict?: string };

/** One commit per merged story: its title, the user story, who built and reviewed it. */
async function commit(c: Concert, storyId: string, files: string[]): Promise<void> {
  const story = c.store.get().plan?.stories.find((s) => s.id === storyId);
  const view = c.store.view(storyId);
  if (!story) return;
  const body = `As ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.\n\nBuilt by ${view.model}, reviewed by ${view.critics[0] ?? "-"}.\nConcerto-Run: ${c.runId}`;
  const sha = await commitStory(c.cwd, { files, title: story.title, body });
  if (sha) c.store.log({ role: "conductor", label: "Commit", detail: `${sha} ${story.title}`, result: "committed" });
}

async function merge(c: Concert, storyId: string, tree: Worktree): Promise<Ending> {
  const result = await serial(c, async () => mergeBack(c.cwd, tree, await changesIn(tree)));
  if (result.conflicts.length === 0) {
    saveMerge(c.cwd, { runId: c.runId, storyId }, result.records);
    c.store.story(storyId, { merged: result.merged });
    if (c.commit) await serial(c, () => commit(c, storyId, result.merged));
    return { merged: true };
  }
  const files = result.conflicts.join(", ");
  c.store.story(storyId, { finding: `merge conflict in ${files}` });
  c.store.log({ role: "conductor", label: "Merge", detail: `${storyId}: conflict in ${files}`, result: "conflict" });
  return { merged: false, conflict: result.detail };
}

/**
 * Ends a story's workspace. A story that passed is merged into the main folder. A conflict that
 * will be rebuilt just drops the worktree; any other story that did not land has its work saved
 * as a patch in .concerto/worktrees/ first.
 */
export async function closeWorkspace(c: Concert, ws: Workspace, end: { pass: boolean; rebuild: boolean }): Promise<Ending> {
  if (!ws.tree) return { merged: end.pass };
  const tree = ws.tree;
  const ending = end.pass ? await merge(c, ws.storyId, tree) : { merged: false };
  const keep = !ending.merged && !(ending.conflict && end.rebuild);
  await serial(c, () => (keep ? retire(c.cwd, tree.dir, "failed").then(() => undefined) : closeWorktree(c.cwd, tree)));
  // Awaited: a scan still running when the run returns would hold the folder (Windows cannot delete it).
  await readChanges(c.cwd).then((changes) => c.store.update(() => ({ changes })), () => undefined);
  return ending;
}
