import { approxTokens, condense } from "#src/engine/condense.js";
import { customBuilds } from "#src/orchestrator/custom-roles.js";
import { bump } from "#src/engine/ledger.js";
import { readChanges } from "#src/engine/changes.js";
import { impactBrief } from "#src/engine/impact.js";
import { contextPack } from "#src/engine/context-pack.js";
import { details, headline, readTag, storyBrief, storySegments } from "#src/orchestrator/briefs.js";
import { snapshotStat, worktreeSnapshot } from "#src/engine/snapshot.js";
import { overBudget } from "#src/orchestrator/budget.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { gate } from "#src/orchestrator/gate.js";
import { policyBrief, policyGate, secretGate } from "#src/orchestrator/policy.js";
import { traceStory } from "#src/orchestrator/trace.js";
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

async function play(c: Concert, { story, cwd }: Job, feedback: string): Promise<string> {
  const view = c.store.view(story.id);
  c.store.story(story.id, { status: "building" });
  const segments = [
    ...storySegments(c.store.get(), { repoMap: c.repo.text, storyId: story.id, snapshot: true }),
    { name: "story", text: storyBrief(story) },
    { name: "policy", text: policyBrief(c) },
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
  return out.text;
}

async function finish(c: Concert, story: Story, pass: boolean): Promise<boolean> {
  c.store.story(story.id, { status: pass ? "passed" : "failed" });
  return pass;
}

/** The policy, the secret scan, Concerto's own checks, then a mutation probe: "" when all are satisfied, else the feedback. */
async function verify(c: Concert, job: Job): Promise<string> {
  return (await policyGate(c, job)) || (await secretGate(c, job)) || (await gate(c, job)) || (await mutationProbe(c, job));
}

/**
 * One story's snapshots: before its first build and after its latest, and the last red check with
 * the tree it failed on, so a build that changed nothing is not checked twice.
 */
type Progress = { before: string | null; after: string | null; red: { at: string | null; feedback: string } };

/** What the build changed, from the snapshots: the critic's scope, whatever else is in the folder. */
async function changeBrief(cwd: string, p: Progress): Promise<string> {
  if (!p.before || !p.after) return "";
  const head = "## This story's change";
  if (p.before === p.after) return `${head}\nThe build changed no file. Pass only if every acceptance item already holds as the code is.`;
  return [head, "Files this story changed:", await snapshotStat(cwd, p.before, p.after), `Full diff: \`git diff ${p.before} ${p.after}\`. Judge this change, not the rest of the folder.`].join("\n");
}

/** A builder that stopped as blocked and changed nothing: nothing to check or review, the conductor decides. */
function blockedText(c: Concert, story: Story, reply: string): string {
  c.store.story(story.id, { finding: `blocked: ${headline(reply, "STATUS")}` });
  return `## The builder stopped as blocked, without changing a file\n${details(reply, "STATUS")}`;
}

/** Builds once and runs the checks: the feedback when they fail ("" when they pass), and whether the builder is blocked. */
async function attempt(c: Concert, job: Job, at: { progress: Progress; feedback: string }): Promise<{ red: string; blocked: boolean }> {
  const p = at.progress;
  const previous = p.after ?? p.before;
  const reply = await play(c, job, at.feedback);
  p.after = await worktreeSnapshot(job.cwd);
  if (readTag(reply, "STATUS") === "blocked" && p.after && p.after === previous) return { red: blockedText(c, job.story, reply), blocked: true };
  if (p.after && p.after === p.red.at) {
    c.store.log({ role: "critic", label: "Checks", detail: `${job.story.title}: the build changed no file since they failed`, result: "unchanged" });
    return { red: `## The build changed no file since the checks failed\nThey were not run again.\n\n${p.red.feedback}`, blocked: false };
  }
  const red = await verify(c, job);
  p.red = red ? { at: p.after, feedback: red } : { at: null, feedback: "" };
  return { red, blocked: false };
}

/** After two failures, or a blocked builder: the conductor's advice, then one last attempt with it. */
async function lastChance(c: Concert, job: Job, at: { progress: Progress; feedback: string }): Promise<boolean | null> {
  const advice = await consult(c, "repeat-error", `${storyBrief(job.story)}\n\n## Last failure\n${at.feedback}`);
  if (advice.verdict === "stop") return false;
  if (overBudget(c, job.story.id)) return null;
  const tried = await attempt(c, job, { progress: at.progress, feedback: `${at.feedback}\n\n## Conductor guidance\n${advice.guidance || advice.finding}` });
  if (tried.red) return false;
  return (await judge(c, { ...job, change: await changeBrief(job.cwd, at.progress) })).pass;
}

/**
 * Two attempts, each checked by Concerto's own gate (tests, type check, lint, the configured gates)
 * and then by the critic; a red gate sends the attempt back without the critic. Two failures, or a
 * builder blocked without a change, wake the conductor; unless it says stop, one last attempt runs
 * with its guidance. Null: stopped by the budget.
 */
async function attempts(c: Concert, job: Job, start: string): Promise<boolean | null> {
  let feedback = start;
  const progress: Progress = { before: await worktreeSnapshot(job.cwd), after: null, red: { at: null, feedback: "" } };
  for (let n = 1; n <= REVIEWED_ATTEMPTS; n += 1) {
    if (overBudget(c, job.story.id)) return null;
    const tried = await attempt(c, job, { progress, feedback });
    feedback = tried.red ? compact(c, tried.red) : feedback;
    if (tried.blocked) break;
    if (tried.red) continue;
    const verdict = await judge(c, { ...job, change: await changeBrief(job.cwd, progress) });
    if (verdict.pass || verdict.stop) return verdict.pass;
    feedback = compact(c, verdict.text);
  }
  return lastChance(c, job, { progress, feedback });
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
  const started = Date.now();
  const endSpan = traceStory(c, story);
  const done = (pass: boolean) => (c.store.story(story.id, { ms: Date.now() - started }), endSpan(pass), pass);
  let feedback = opening;
  for (let round = 0; ; round += 1) {
    const ws = await openWorkspace(c, story.id);
    const rebuild = round < REBUILDS;
    const result = await attempts(c, { story, cwd: ws.cwd, tree: ws.tree, round }, feedback).catch(async (error: unknown) => {
      await closeWorkspace(c, ws, { pass: false, rebuild: false });
      throw error;
    });
    if (result === true) await customBuilds(c, { story, cwd: ws.cwd, round });
    const ending = await closeWorkspace(c, ws, { pass: result === true, rebuild });
    if (result === null) return done(false);
    if (!ending.conflict || !rebuild) return done(await finish(c, story, ending.merged));
    feedback = rebuildFeedback(ending.conflict);
  }
}
