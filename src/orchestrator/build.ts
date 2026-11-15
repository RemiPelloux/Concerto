import { approxTokens, condense } from "../engine/condense.js";
import { bump } from "../engine/ledger.js";
import { impactBrief } from "../engine/impact.js";
import { headline, readTag, runSegments, storyBrief } from "./briefs.js";
import { overBudget } from "./budget.js";
import { callRole } from "./call.js";
import type { Concert } from "./concert.js";
import { consult } from "./consult.js";
import type { Story } from "./plan.js";

const REVIEWED_ATTEMPTS = 2;

/** Condenses feedback before it goes back into a prompt and counts what that saved. */
function compact(c: Concert, text: string): string {
  const out = condense(text);
  c.store.update((s) => ({ ledger: bump(s.ledger, "condensedTokens", Math.max(0, approxTokens(text) - approxTokens(out))) }));
  return out;
}

async function play(c: Concert, story: Story, feedback: string): Promise<void> {
  const view = c.store.view(story.id);
  c.store.story(story.id, { status: "building" });
  const segments = [
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
    { name: "feedback", text: feedback ? `## Fix this before anything else\n${feedback}` : "" },
  ];
  const chain = c.catalog.reachable(view.chain);
  const out = await callRole(c, { role: view.role, chain, segments, effort: view.effort, tags: story.tags, sessionKey: story.id });
  c.store.story(story.id, { model: out.model.ref });
  c.store.role(view.role, { activity: "done" });
  c.store.log({ role: view.role, label: "Update", detail: story.title, result: readTag(out.text, "STATUS") || "done" });
}

async function review(c: Concert, story: Story): Promise<{ pass: boolean; text: string }> {
  c.store.story(story.id, { status: "checking" });
  const view = c.store.view(story.id);
  const segments = [
    ...runSegments(c.store.get(), c.repo.text),
    { name: "story", text: storyBrief(story) },
    { name: "blast radius", text: impactBrief(view.impact) },
  ];
  const chain = c.catalog.reachable(view.critics);
  const out = await callRole(c, { role: "critic", chain, segments, tags: story.tags, sessionKey: `${story.id}-critic` });
  const pass = readTag(out.text, "VERDICT") === "pass";
  c.store.role("critic", { activity: "waiting", note: "waiting" });
  c.store.log({ role: "critic", label: "Critic", detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
  return { pass, text: out.text };
}

async function finish(c: Concert, story: Story, pass: boolean): Promise<boolean> {
  c.store.story(story.id, { status: pass ? "passed" : "failed" });
  return pass;
}

/**
 * Builds a story and has the critic try to break it, twice at most. Two failures wake the
 * conductor; unless it says stop, one last attempt runs with its guidance.
 */
export async function buildStory(c: Concert, story: Story): Promise<boolean> {
  let feedback = "";
  for (let attempt = 1; attempt <= REVIEWED_ATTEMPTS; attempt += 1) {
    if (overBudget(c, story.id)) return false;
    await play(c, story, feedback);
    const verdict = await review(c, story);
    if (verdict.pass) return finish(c, story, true);
    feedback = compact(c, verdict.text);
  }
  const advice = await consult(c, "repeat-error", `${storyBrief(story)}\n\n## Last critique\n${feedback}`);
  if (advice.verdict === "stop") return finish(c, story, false);
  if (overBudget(c, story.id)) return false;
  await play(c, story, `${feedback}\n\n## Conductor guidance\n${advice.guidance || advice.finding}`);
  return finish(c, story, (await review(c, story)).pass);
}
