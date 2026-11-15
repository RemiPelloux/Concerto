import { headline, readTag, storyBrief } from "./briefs.js";
import { callRole } from "./call.js";
import type { Concert } from "./concert.js";
import { consult } from "./consult.js";
import type { Story } from "./plan.js";

const MAX_ATTEMPTS = 2;

async function play(c: Concert, story: Story, feedback: string): Promise<void> {
  const view = c.store.get().stories.find((v) => v.id === story.id);
  const model = c.catalog.find((m) => m.ref === view?.model);
  if (!view || !model) throw new Error(`Story ${story.id} has no routed model.`);
  c.store.story(story.id, { status: "building" });
  const prompt = feedback ? `${storyBrief(story)}\n\nThe critic rejected the last attempt:\n${feedback}` : storyBrief(story);
  const out = await callRole(c, { role: view.role, model, prompt, effort: view.effort, tags: story.tags, sessionKey: story.id });
  c.store.role(view.role, { activity: "done" });
  c.store.log({ role: view.role, label: "Update", detail: story.title, result: readTag(out.text, "STATUS") || "done" });
}

async function review(c: Concert, story: Story): Promise<{ pass: boolean; text: string }> {
  c.store.story(story.id, { status: "checking" });
  const critic = c.store.get().stories.find((v) => v.id === story.id)?.critic;
  const model = c.catalog.find((m) => m.ref === critic);
  const out = await callRole(c, { role: "critic", model, prompt: storyBrief(story), tags: story.tags, sessionKey: `${story.id}-critic` });
  const pass = readTag(out.text, "VERDICT") === "pass";
  c.store.role("critic", { activity: "waiting", note: "waiting" });
  c.store.log({ role: "critic", label: "critic", detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
  return { pass, text: out.text };
}

/** Builds one story, has the critic try to break it, and retries once with the critique. */
export async function buildStory(c: Concert, story: Story): Promise<boolean> {
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await play(c, story, feedback);
    const verdict = await review(c, story);
    if (verdict.pass) {
      c.store.story(story.id, { status: "passed" });
      return true;
    }
    feedback = verdict.text;
  }
  c.store.story(story.id, { status: "failed" });
  await consult(c, "repeat-error", `Failing story: ${storyBrief(story)}\n\nLast critique:\n${feedback}`);
  return false;
}
