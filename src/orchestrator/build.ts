import { approxTokens, condense } from "#src/engine/condense.js";
import { bump } from "#src/engine/ledger.js";
import { readChanges } from "#src/engine/changes.js";
import { impactBrief } from "#src/engine/impact.js";
import { headline, readTag, runSegments, storyBrief } from "#src/orchestrator/briefs.js";
import { overBudget } from "#src/orchestrator/budget.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { closeWorkspace, openWorkspace } from "#src/orchestrator/isolate.js";
import type { Story } from "#src/orchestrator/plan.js";

const REVIEWED_ATTEMPTS = 2;

/** One story and the folder its agents work in: its worktree in an isolated run. */
type Job = { story: Story; cwd: string };

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
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "feedback", text: feedback ? `## Fix this before anything else\n${feedback}` : "" },
  ];
  const chain = c.catalog.reachable(view.chain);
  const out = await callRole(c, { role: view.role, chain, segments, effort: view.effort, tags: story.tags, sessionKey: story.id, label: story.title, cwd });
  c.store.story(story.id, { model: out.model.ref });
  if (!c.isolated) readChanges(c.cwd).then((changes) => c.store.update(() => ({ changes })), () => undefined);
  c.store.role(view.role, { activity: "done" });
  // What the builder says about its own work; the critic decides whether the story passes.
  c.store.log({ role: view.role, label: "Builder", detail: story.title, result: readTag(out.text, "STATUS") || "done" });
}

async function review(c: Concert, { story, cwd }: Job): Promise<{ pass: boolean; text: string }> {
  c.store.story(story.id, { status: "checking" });
  const view = c.store.view(story.id);
  const segments = [
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
  ];
  const chain = c.catalog.reachable(view.critics);
  const out = await callRole(c, { role: "critic", chain, segments, tags: story.tags, sessionKey: `${story.id}-critic`, label: `review: ${story.title}`, cwd });
  const pass = readTag(out.text, "VERDICT") === "pass";
  c.store.role("critic", { activity: "waiting", note: "waiting" });
  c.store.story(story.id, { finding: headline(out.text, "VERDICT") });
  c.store.log({ role: "critic", label: "Critic", detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
  return { pass, text: out.text };
}

async function finish(c: Concert, story: Story, pass: boolean): Promise<boolean> {
  c.store.story(story.id, { status: pass ? "passed" : "failed" });
  return pass;
}

/**
 * The critic tries to break each attempt, twice at most. Two failures wake the conductor; unless
 * it says stop, one last attempt runs with its guidance. Null: stopped by the budget.
 */
async function attempts(c: Concert, job: Job): Promise<boolean | null> {
  let feedback = "";
  for (let attempt = 1; attempt <= REVIEWED_ATTEMPTS; attempt += 1) {
    if (overBudget(c, job.story.id)) return null;
    await play(c, job, feedback);
    const verdict = await review(c, job);
    if (verdict.pass) return true;
    feedback = compact(c, verdict.text);
  }
  const advice = await consult(c, "repeat-error", `${storyBrief(job.story)}\n\n## Last critique\n${feedback}`);
  if (advice.verdict === "stop") return false;
  if (overBudget(c, job.story.id)) return null;
  await play(c, job, `${feedback}\n\n## Conductor guidance\n${advice.guidance || advice.finding}`);
  return (await review(c, job)).pass;
}

/** Builds a story in its own workspace; it passes once its work is merged into the main folder. */
export async function buildStory(c: Concert, story: Story): Promise<boolean> {
  const ws = await openWorkspace(c, story.id);
  const result = await attempts(c, { story, cwd: ws.cwd }).catch(async (error: unknown) => {
    await closeWorkspace(c, ws, false);
    throw error;
  });
  const merged = await closeWorkspace(c, ws, result === true);
  return result === null ? false : finish(c, story, merged);
}
