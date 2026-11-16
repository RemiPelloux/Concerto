import { approxTokens, condense } from "#src/engine/condense.js";
import { bump } from "#src/engine/ledger.js";
import { readChanges } from "#src/engine/changes.js";
import { impactBrief } from "#src/engine/impact.js";
import { contextPack } from "#src/engine/context-pack.js";
import { readTag, storyBrief, storySegments } from "#src/orchestrator/briefs.js";
import { overBudget } from "#src/orchestrator/budget.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { gate } from "#src/orchestrator/gate.js";
import { closeWorkspace, openWorkspace } from "#src/orchestrator/isolate.js";
import type { Story } from "#src/orchestrator/plan.js";
import { judge, mutationProbe, type Job } from "#src/orchestrator/review.js";
import { whilePaused } from "#src/orchestrator/pause.js";

const REVIEWED_ATTEMPTS = 2;
/** Times a story that passed but conflicted on merge is rebuilt on top of the current code. */
const REBUILDS = 2;

/** Condenses feedback before it goes back into a prompt and counts what that saved. */
function compact(c: Concert, text: string): string {
  const out = condense(text);
  c.store.update((s) => ({ ledger: bump(s.ledger, "condensedTokens", Math.max(0, approxTokens(text) - approxTokens(out))) }));
  return out;
}

async function play(c: Concert, { story, cwd }: Job, feedback: string): Promise<void> {
  const view = c.store.view(story.id);
  c.store.story(story.id, { status: "building" });
  const segments = [
    ...storySegments(c.store.get(), { repoMap: c.repo.text, storyId: story.id, snapshot: true }),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "context pack", text: contextPack(c.cwd, view.impact.files) },
    { name: "feedback", text: feedback ? `## Fix this before anything else\n${feedback}` : "" },
  ];
  const chain = c.catalog.reachable(view.chain);
  c.store.story(story.id, { attempts: (view.attempts ?? 0) + 1 });
  const out = await callRole(c, { role: view.role, chain, segments, effort: view.effort, tags: story.tags, sessionKey: story.id, label: story.title, cwd, storyId: story.id });
  c.store.story(story.id, { model: out.model.ref });
  if (!c.isolated) await readChanges(c.cwd).then((changes) => c.store.update(() => ({ changes })), () => undefined);
  c.store.role(view.role, { activity: "done" });
  // What the builder says about its own work; the critic decides whether the story passes.
  c.store.log({ role: view.role, label: "Builder", detail: story.title, result: readTag(out.text, "STATUS") || "done" });
}

async function finish(c: Concert, story: Story, pass: boolean): Promise<boolean> {
  c.store.story(story.id, { status: pass ? "passed" : "failed" });
  return pass;
}

/** Concerto's own checks, then a mutation probe: "" when both are satisfied, else the feedback. */
async function verify(c: Concert, job: Job): Promise<string> {
  return (await gate(c, job)) || (await mutationProbe(c, job));
}

/**
 * Two attempts, each checked by Concerto's own gate (tests, type check, lint) and then by the
 * critic; a red gate sends the attempt back without the critic. Two failures wake the conductor;
 * unless it says stop, one last attempt runs with its guidance. Null: stopped by the budget.
 */
async function attempts(c: Concert, job: Job, start: string): Promise<boolean | null> {
  let feedback = start;
  for (let attempt = 1; attempt <= REVIEWED_ATTEMPTS; attempt += 1) {
    if (overBudget(c, job.story.id)) return null;
    await play(c, job, feedback);
    const red = await verify(c, job);
    if (red) {
      feedback = compact(c, red);
      continue;
    }
    const verdict = await judge(c, job);
    if (verdict.pass || verdict.stop) return verdict.pass;
    feedback = compact(c, verdict.text);
  }
  const advice = await consult(c, "repeat-error", `${storyBrief(job.story)}\n\n## Last failure\n${feedback}`);
  if (advice.verdict === "stop") return false;
  if (overBudget(c, job.story.id)) return null;
  await play(c, job, `${feedback}\n\n## Conductor guidance\n${advice.guidance || advice.finding}`);
  if (await verify(c, job)) return false;
  return (await judge(c, job)).pass;
}

/** What a builder reads when its passing change no longer applies to the main folder. */
function rebuildFeedback(conflict: string): string {
  return `## Your change no longer applies\nWhile you worked, other stories changed the same lines. You are now on the current code, which includes their work: redo your story on top of it and keep their changes.\n\n${conflict}`;
}

/**
 * Builds a story in its own workspace; it passes once its work is merged into the main folder.
 * A passing story whose merge conflicts with work that landed meanwhile is rebuilt on top of the
 * current code, up to REBUILDS times, as a developer would rebase.
 */
export async function buildStory(c: Concert, story: Story, opening = ""): Promise<boolean> {
  await whilePaused(c);
  let feedback = opening;
  for (let round = 0; ; round += 1) {
    const ws = await openWorkspace(c, story.id);
    const rebuild = round < REBUILDS;
    const result = await attempts(c, { story, cwd: ws.cwd, tree: ws.tree, round }, feedback).catch(async (error: unknown) => {
      await closeWorkspace(c, ws, { pass: false, rebuild: false });
      throw error;
    });
    const ending = await closeWorkspace(c, ws, { pass: result === true, rebuild });
    if (result === null) return false;
    if (!ending.conflict || !rebuild) return finish(c, story, ending.merged);
    feedback = rebuildFeedback(ending.conflict);
  }
}
