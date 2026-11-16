import { runCheck } from "#src/engine/checks.js";
import { impactBrief } from "#src/engine/impact.js";
import { applyMutation, findMutation, touchesTests } from "#src/engine/mutation.js";
import { diffText, type Worktree } from "#src/engine/worktree.js";
import type { ModelInfo } from "#src/models/types.js";
import { roleChain, tierChain } from "#src/models/router.js";
import { parseRef } from "#src/runner/types.js";
import { headline, readTag, storyBrief, storySegments } from "#src/orchestrator/briefs.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { checksBrief } from "#src/orchestrator/gate.js";
import { behaviourBrief, observeBehaviour } from "#src/orchestrator/observe.js";
import type { Story } from "#src/orchestrator/plan.js";

const HIGH_RISK = 4;
const HIGH_SCORE = 75;
const CRITIC_TIER = 3;
const MS_PER_MINUTE = 60_000;

/**
 * One story, the folder its agents work in, its worktree in an isolated run, and which build of it
 * this is: a rebuild after a merge conflict is new code, so its critics start fresh sessions.
 */
export type Job = { story: Story; cwd: string; tree: Worktree | null; round: number };
/** `stop`: the conductor said the story cannot be fixed in this run. */
export type Verdict = { pass: boolean; text: string; model: string; stop?: boolean };

/** The model family a ref belongs to: claude, gpt, grok, deepseek… whichever backend runs it. */
export const vendorOf = (ref: string): string => parseRef(ref).id.toLowerCase().split(/[-_.:/]/)[0] ?? "";

async function critique(c: Concert, job: Job, second?: ModelInfo[]): Promise<Verdict> {
  const { story, cwd } = job;
  c.store.story(story.id, { status: "checking" });
  const view = c.store.view(story.id);
  const segments = [
    ...storySegments(c.store.get(), { repoMap: c.repo.text, storyId: story.id, snapshot: false }),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "checks", text: checksBrief(c, story.id) },
    { name: "behaviour", text: behaviourBrief(c, story.id) },
  ];
  const chain = second ?? c.catalog.reachable(view.critics);
  const key = `${story.id}-${second ? "critic2" : "critic"}${job.round > 0 ? `-r${job.round}` : ""}`;
  const out = await callRole(c, { role: "critic", chain, segments, tags: story.tags, sessionKey: key, label: `${second ? "second review" : "review"}: ${story.title}`, cwd, storyId: story.id });
  const pass = readTag(out.text, "VERDICT") === "pass";
  c.store.role("critic", { activity: "waiting", note: "waiting" });
  c.store.story(story.id, { finding: headline(out.text, "VERDICT") });
  c.store.log({ role: "critic", label: second ? "2nd critic" : "Critic", detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
  return { pass, text: out.text, model: out.model.ref };
}

/** Reviewers from another vendor than `first`: the critic chains first, then any able model. */
function otherVendor(c: Concert, story: Story, first: string): ModelInfo[] {
  const pool = [...c.catalog.reachable(c.store.view(story.id).critics), ...roleChain(c.catalog, c.config, "critic"), ...tierChain(c.catalog, CRITIC_TIER)];
  return [...new Set(pool)].filter((m) => vendorOf(m.ref) !== vendorOf(first)).slice(0, 2);
}

const highRisk = (c: Concert, story: Story) => story.risk >= HIGH_RISK || c.store.view(story.id).score >= HIGH_SCORE;

/**
 * The critic's verdict, with the behaviour diff in hand when one is configured. On a high-risk story that passed, a second critic from another vendor
 * reviews it too; when the two disagree, the conductor decides.
 */
export async function judge(c: Concert, job: Job): Promise<Verdict> {
  await observeBehaviour(c, job);
  const first = await critique(c, job);
  if (!first.pass || !highRisk(c, job.story)) return first;
  const others = otherVendor(c, job.story, first.model);
  if (others.length === 0) return first;
  const second = await critique(c, job, others);
  if (second.pass) return first;
  const reviews = `## ${first.model} passed it\n${first.text}\n\n## ${second.model} failed it\n${second.text}`;
  const call = await consult(c, "critics-disagree", `${storyBrief(job.story)}\n\n${reviews}`);
  if (call.verdict === "ok") return first;
  return { pass: false, text: `${second.text}\n\n## Conductor\n${call.finding}\n${call.guidance}`, model: second.model, stop: call.verdict === "stop" };
}

/**
 * Flips one condition the story added and runs the tests: if they still pass, no test checks
 * that condition. Runs only in a worktree, on stories that add tests. Returns "" when the
 * mutation was caught (or there was nothing to try), otherwise feedback for the builder.
 */
export async function mutationProbe(c: Concert, job: Job): Promise<string> {
  const test = c.checks.find((check) => check.name === "test");
  if (!test || !job.tree) return "";
  const diff = await diffText(job.tree);
  const mutation = touchesTests(diff) ? findMutation(diff) : null;
  if (!mutation) return "";
  const restore = applyMutation(job.cwd, mutation);
  const result = await runCheck(test, { cwd: job.cwd, timeoutMs: c.config.checks.timeoutMinutes * MS_PER_MINUTE, signal: c.signal }).finally(restore);
  const where = `${mutation.file}:${mutation.line}`;
  c.store.story(job.story.id, { mutation: { ...mutation, caught: !result.ok } });
  c.store.log({ role: "critic", label: "Mutation", detail: `${where}: \`${mutation.from.trim()}\` to \`${mutation.to.trim()}\``, result: result.ok ? "survived" : "caught" });
  if (!result.ok) return "";
  return `## The tests pass with the feature broken\nConcerto changed \`${mutation.from.trim()}\` to \`${mutation.to.trim()}\` at ${where} and \`${test.command}\` still passed: no test checks this condition. Add a test that fails when it is wrong.`;
}
