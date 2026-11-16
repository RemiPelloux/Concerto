import { buildStory } from "#src/orchestrator/build.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { runOutcome } from "#src/orchestrator/budget.js";

/**
 * After a run: sends one story back to its builder's session with the reviewer's message. It goes
 * through the gate, the critic and the merge again; no other story is touched.
 */
export async function askBuilder(c: Concert, storyId: string, message: string): Promise<boolean> {
  const state = c.store.get();
  if (state.phase !== "done" && state.phase !== "failed") throw new Error("/ask sends a story back after a run; wait for this one to end.");
  const story = state.plan?.stories.find((s) => s.id === storyId);
  if (!story) throw new Error(`No story "${storyId}" in this run.`);
  c.store.update(() => ({ phase: "running", error: "" }));
  c.store.log({ role: "conductor", label: "Ask", detail: `${storyId}: ${message}`, result: "sent back" });
  try {
    return await buildStory(c, story, `## The person reviewing your work asks\n${message}`);
  } finally {
    const error = runOutcome(c, "");
    c.store.update(() => ({ phase: error ? "failed" : "done", error }));
  }
}
