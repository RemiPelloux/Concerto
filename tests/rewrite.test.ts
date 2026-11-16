import { describe, expect, it } from "vitest";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { planRequest, withAnswers } from "#src/orchestrator/rewrite.js";
import { reviewEffort } from "#src/models/router.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { submitPrompt } from "#src/ui/prompt-actions.js";
import type { ConcertoConfig } from "#src/config/types.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);

const REWRITE = JSON.stringify({
  request: "Add GET /health returning 200 and protect /admin with a bearer token",
  questions: [],
  assumptions: ["The token comes from ADMIN_TOKEN"],
  brief: "Put the route in src/routes/health.ts; reuse the existing auth middleware.",
  effort: "high",
});
const ASKS = JSON.stringify({ request: "Add auth", questions: ["Bearer token or session cookie?"], assumptions: [], brief: "", effort: "medium" });

function reply(rewriter: string) {
  return (r: RunRequest): string => {
    if (is("rewriter")(r)) return rewriter;
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return "VERDICT: pass\nok";
    if (is("conductor")(r)) return "VERDICT: ok\nok";
    return "STATUS: done\nok";
  };
}

async function setup(rewriter: string, config: ConcertoConfig = { ...testConfig(), rewrite: true, isolation: "off" }) {
  const scripted = scriptedRunner(reply(rewriter));
  const concert = await createConcert({ config, catalog: CATALOG, store: new Store(), runner: scripted.runner, cwd: tempDir() });
  return { scripted, concert };
}

describe("the rewriter", () => {
  it("scores the rewritten request with its assumptions and brief, and builds every story at its effort floor or above", async () => {
    const { scripted, concert } = await setup(REWRITE);
    expect(await planRequest(concert, "health + auth pls")).toBe(true);
    const scorer = scripted.calls.find(is("scorer"));
    expect(scorer?.prompt).toContain("protect /admin with a bearer token");
    expect(scorer?.prompt).toContain("The token comes from ADMIN_TOKEN");
    expect(scorer?.prompt).toContain("## Design brief");
    const { stories } = concert.store.get();
    expect(stories.route?.effort).toBe("high");
    expect(stories.route?.reviewEffort).toBe("high");
    await perform(concert);
    const builds = scripted.calls.filter((r) => !is("rewriter")(r) && !is("scorer")(r) && !is("critic")(r) && !is("conductor")(r));
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.every((r) => r.prompt.includes("reuse the existing auth middleware") && ["high", "xhigh", "max"].includes(r.effort))).toBe(true);
    expect(scripted.calls.filter(is("critic")).every((r) => ["high", "xhigh", "max"].includes(r.effort))).toBe(true);
  });

  it("waits for answers when it has questions, then plans with them", async () => {
    const { scripted, concert } = await setup(ASKS);
    expect(await planRequest(concert, "add auth", true)).toBe(false);
    const state = concert.store.get();
    expect(state.phase).toBe("clarifying");
    expect(state.log.some((e) => e.label === "Question" && e.detail.includes("Bearer token"))).toBe(true);
    expect(scripted.calls.some(is("scorer"))).toBe(false);
    const answered = withAnswers(state, "bearer token");
    expect(answered).toContain("Bearer token or session cookie?");
    expect(answered).toContain("bearer token");
    expect(await planRequest(concert, answered, false)).toBe(true);
    expect(concert.store.get().phase).toBe("planned");
  });

  it("never asks in a run nobody can answer: questions are dropped and the plan goes on", async () => {
    const { scripted, concert } = await setup(ASKS);
    expect(await planRequest(concert, "add auth")).toBe(true);
    expect(scripted.calls.find(is("rewriter"))?.prompt).toContain("Nobody can answer questions");
  });

  it("keeps the person's words when the reply is not JSON", async () => {
    const { scripted, concert } = await setup("Here is a better prompt: add auth.");
    await planRequest(concert, "add auth");
    expect(scripted.calls.find(is("scorer"))?.prompt).toContain("## Request\nadd auth");
    expect(concert.store.get().log.some((e) => e.result === "kept your words")).toBe(true);
  });

  it("is skipped entirely when rewrite is off", async () => {
    const { scripted, concert } = await setup(REWRITE, testConfig());
    await planRequest(concert, "add auth");
    expect(scripted.calls.some(is("rewriter"))).toBe(false);
    expect(concert.store.get().stories.route?.effort).not.toBe("off");
  });
});

describe("effort", () => {
  it("runs a model pinned in a chain at its own effort", async () => {
    const config = { ...testConfig(), isolation: "off" as const };
    config.roles.scorer.models = ["a/brain#xhigh"];
    const { scripted, concert } = await setup(REWRITE, config);
    await planRequest(concert, "add auth");
    const scorer = scripted.calls.find(is("scorer"));
    expect(scorer?.model).toBe("a/brain");
    expect(scorer?.effort).toBe("xhigh");
  });

  it("scales the critic with the score, never under the critic's own effort, unless a review rule names one", () => {
    const config = testConfig();
    config.roles.critic.effort = "medium";
    expect(reviewEffort({ score: 10, tags: [] }, config)).toBe("medium");
    expect(reviewEffort({ score: 80, tags: [] }, config)).toBe("xhigh");
    config.reviews = [{ tags: ["ui"], minScore: 0, maxScore: 101, models: ["a/brain#high"], effort: "low" }];
    expect(reviewEffort({ score: 80, tags: ["ui"] }, config)).toBe("low");
  });
});

describe("the prompt while the rewriter waits", () => {
  it("sends typed text back as answers to its questions", () => {
    const store = new Store();
    store.update(() => ({ phase: "clarifying", prompt: "add auth", questions: ["Bearer or cookie?"] }));
    const sent: string[] = [];
    submitPrompt("cookie", { store, log: { write: () => undefined } as never, request: (t) => sent.push(t), slash: () => undefined, show: () => undefined });
    expect(sent[0]).toContain("Bearer or cookie?");
    expect(sent[0]).toContain("cookie");
  });
});
