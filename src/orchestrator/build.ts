import { approxTokens, condense } from "#src/engine/condense.js";
import { bump } from "#src/engine/ledger.js";
import { readChanges } from "#src/engine/changes.js";
import { impactBrief } from "#src/engine/impact.js";
import { details, headline, readTag, runSegments, storyBrief } from "#src/orchestrator/briefs.js";
import { overBudget } from "#src/orchestrator/budget.js";
import { callRole } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { consult } from "#src/orchestrator/consult.js";
import { snapshotStat, worktreeSnapshot } from "#src/engine/snapshot.js";
import { runGates, type GateFailure } from "#src/orchestrator/gate.js";
import type { Story } from "#src/orchestrator/plan.js";

const REVIEWED_ATTEMPTS = 2;
type Verdict = { pass: boolean; text: string; blocked?: boolean };

/**
 * One story's working-tree snapshots: before its first build and after its latest one, so the
 * critic judges the story's own change, and the last red gate with the tree it failed on.
 */
type StoryRun = { before: string | null; after: string | null; gate: { snapshot: string | null; failure: GateFailure | null } };

/** Condenses feedback before it goes back into a prompt and counts what that saved. */
function compact(c: Concert, text: string): string {
  const out = condense(text);
  c.store.update((s) => ({ ledger: bump(s.ledger, "condensedTokens", Math.max(0, approxTokens(text) - approxTokens(out))) }));
  return out;
}

async function play(c: Concert, story: Story, feedback: string): Promise<string> {
  const view = c.store.view(story.id);
  c.store.story(story.id, { status: "building" });
  const segments = [
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "feedback", text: feedback ? `## Fix this before anything else\n${feedback}` : "" },
  ];
  const chain = c.catalog.reachable(view.chain);
  const out = await callRole(c, { role: view.role, chain, segments, effort: view.effort, tags: story.tags, sessionKey: story.id, label: story.title });
  c.store.story(story.id, { model: out.model.ref });
  readChanges(c.cwd).then((changes) => c.store.update(() => ({ changes })), () => undefined);
  c.store.role(view.role, { activity: "done" });
  // What the builder says about its own work; the critic decides whether the story passes.
  c.store.log({ role: view.role, label: "Builder", detail: story.title, result: readTag(out.text, "STATUS") || "done" });
  return out.text;
}

/** What the build changed, from the snapshots: the critic's scope, whatever else is in the folder. */
async function changeBrief(c: Concert, run: StoryRun): Promise<string> {
  const { before, after } = run;
  if (!before || !after) return "";
  const head = "## This story's change";
  if (before === after) return `${head}\nThe build changed no file. Pass only if every acceptance item already holds as the code is.`;
  return [
    head,
    "Files changed while this story was built (a story built at the same time may add its own):",
    await snapshotStat(c.cwd, before, after),
    `Full diff: \`git diff ${before} ${after}\`. Judge this change, not the rest of the working tree.`,
  ].join("\n");
}

async function review(c: Concert, story: Story, run: StoryRun): Promise<Verdict> {
  c.store.story(story.id, { status: "checking" });
  const view = c.store.view(story.id);
  const segments = [
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "change", text: await changeBrief(c, run) },
  ];
  const chain = c.catalog.reachable(view.critics);
  const out = await callRole(c, { role: "critic", chain, segments, tags: story.tags, sessionKey: `${story.id}-critic`, label: `review: ${story.title}` });
  const pass = readTag(out.text, "VERDICT") === "pass";
  c.store.role("critic", { activity: "waiting", note: "waiting" });
  c.store.story(story.id, { finding: headline(out.text, "VERDICT") });
  c.store.log({ role: "critic", label: "Critic", detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
  return { pass, text: out.text };
}

function gateVerdict(c: Concert, story: Story, { failure, unchanged }: { failure: GateFailure; unchanged: boolean }): Verdict {
  const why = unchanged ? "The build changed no file since this check last failed, so it was not run again." : "";
  c.store.story(story.id, { finding: `gate failed: ${failure.command}` });
  c.store.log({ role: "critic", label: "Gate", detail: failure.command, result: unchanged ? "unchanged" : "failed" });
  return { pass: false, text: [`## The check \`${failure.command}\` fails`, why, failure.output].filter(Boolean).join("\n") };
}

/**
 * The repository's own commands decide before the critic does: a red gate goes straight back
 * to the builder and costs no review. A build that changed nothing is not checked twice.
 */
async function gate(c: Concert, story: Story, run: StoryRun): Promise<Verdict | null> {
  if (c.config.gates.length === 0) return null;
  c.store.story(story.id, { status: "checking" });
  const last = run.gate;
  if (run.after && run.after === last.snapshot && last.failure) return gateVerdict(c, story, { failure: last.failure, unchanged: true });
  const failure = await runGates(c.config.gates, { cwd: c.cwd, signal: c.signal });
  if (!failure) return null;
  run.gate = { snapshot: run.after, failure };
  return gateVerdict(c, story, { failure, unchanged: false });
}

/** A builder that stopped as blocked and changed nothing: there is nothing to check or review. */
function blockedVerdict(c: Concert, story: Story, reply: string): Verdict {
  c.store.story(story.id, { finding: `blocked: ${headline(reply, "STATUS")}` });
  return { pass: false, blocked: true, text: `## The builder stopped as blocked, without changing a file\n${details(reply, "STATUS")}` };
}

/** Builds once, takes the after snapshot, then the gates and the critic judge it. */
async function attempt(c: Concert, story: Story, { run, feedback }: { run: StoryRun; feedback: string }): Promise<Verdict> {
  const previous = run.after ?? run.before;
  const reply = await play(c, story, feedback);
  run.after = await worktreeSnapshot(c.cwd);
  if (readTag(reply, "STATUS") === "blocked" && run.after && run.after === previous) return blockedVerdict(c, story, reply);
  return (await gate(c, story, run)) ?? review(c, story, run);
}

async function finish(c: Concert, story: Story, pass: boolean): Promise<boolean> {
  c.store.story(story.id, { status: pass ? "passed" : "failed" });
  return pass;
}

/**
 * Builds a story, runs the gates, then has the critic try to break it, twice at most. Two
 * failures, or a builder blocked without a change, wake the conductor; unless it says stop, one
 * last attempt runs with its guidance.
 */
export async function buildStory(c: Concert, story: Story): Promise<boolean> {
  let feedback = "";
  let blocked = false;
  const run: StoryRun = { before: await worktreeSnapshot(c.cwd), after: null, gate: { snapshot: null, failure: null } };
  for (let n = 1; n <= REVIEWED_ATTEMPTS && !blocked; n += 1) {
    if (overBudget(c, story.id)) return false;
    const verdict = await attempt(c, story, { run, feedback });
    if (verdict.pass) return finish(c, story, true);
    feedback = compact(c, verdict.text);
    blocked = verdict.blocked === true;
  }
  const advice = await consult(c, "repeat-error", `${storyBrief(story)}\n\n${blocked ? "" : "## Last critique\n"}${feedback}`);
  if (advice.verdict === "stop") return finish(c, story, false);
  if (overBudget(c, story.id)) return false;
  const guided = `${feedback}\n\n## Conductor guidance\n${advice.guidance || advice.finding}`;
  return finish(c, story, (await attempt(c, story, { run, feedback: guided })).pass);
}
