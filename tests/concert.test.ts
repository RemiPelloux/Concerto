import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConcert } from "../src/orchestrator/concert.js";
import { perform } from "../src/orchestrator/perform.js";
import { scoreRequest } from "../src/orchestrator/score.js";
import type { RunRequest } from "../src/runner/types.js";
import { Store } from "../src/state/store.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, testConfig } from "./fixtures.js";

const isScorer = (r: RunRequest) => r.systemFile.includes("scorer");
const isCritic = (r: RunRequest) => r.systemFile.includes("critic");

function setup(criticVerdict: string) {
  const scripted = scriptedRunner((r) =>
    isScorer(r) ? PLAN_REPLY : isCritic(r) ? `VERDICT: ${criticVerdict}\nchecked` : "VERDICT: ok\nlooks fine\nSTATUS: done",
  );
  const store = new Store();
  const cwd = mkdtempSync(join(tmpdir(), "concerto-"));
  const concert = createConcert({ config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd });
  return { ...scripted, store, concert };
}

describe("concert", () => {
  it("scores, routes by difficulty and answers a repeat request from the local cache", async () => {
    const { concert, store, calls } = setup("pass");
    await scoreRequest(concert, "add health and auth");
    expect(store.get().stories.map((s) => [s.id, s.role, s.model])).toEqual([
      ["route", "section", "a/swarm"],
      ["auth", "soloist", "b/cheap-builder"],
    ]);
    await scoreRequest(concert, "add health and auth");
    expect(calls.filter(isScorer)).toHaveLength(1);
    expect(store.get().ledger.localHits).toBe(1);
  });

  it("performs the plan with three conductor checkpoints at most", async () => {
    const { concert, store, calls } = setup("pass");
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(store.get().phase).toBe("done");
    expect(store.get().stories.every((s) => s.status === "passed")).toBe(true);
    expect(calls.filter((c) => c.model === "a/brain")).toHaveLength(2);
    expect(store.get().ledger.soloCost).toBeGreaterThan(store.get().ledger.usage.cost);
  });

  it("retries once, then wakes the conductor and reports the failure", async () => {
    const { concert, store, calls } = setup("fail");
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(store.get().phase).toBe("failed");
    expect(calls.filter(isCritic)).toHaveLength(4);
    expect(store.get().checkpoints["repeat-error"]).toBe("ok");
  });
});
