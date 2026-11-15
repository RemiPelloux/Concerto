import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSessions, readSession, resumable, saveSession } from "#src/engine/history.js";
import { SessionLog } from "#src/engine/session-log.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import type { State } from "#src/state/types.js";
import { runSlash, type Panel, type SlashContext } from "#src/ui/slash.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
/**
 * Every prompt carries the whole plan, and a resumed session is not sent its story again: the
 * story a call works on is named by its session (`auth`, `auth-critic`) or its "## Story" heading.
 */
const story = (id: string) => (r: RunRequest) => (r.session?.id ?? "").includes(id) || r.prompt.includes(`## Story ${id}:`);
const builds = (id: string) => (r: RunRequest) => !is("critic")(r) && !is("conductor")(r) && story(id)(r);

/** The admin story never passes review on the first run; on the second, everything passes. */
function concertIn(cwd: string, failAuth: boolean) {
  const scripted = scriptedRunner((r) => {
    if (is("scorer")(r)) return PLAN_REPLY;
    if (is("critic")(r)) return failAuth && story("auth")(r) ? "VERDICT: fail\nno 401" : "VERDICT: pass\nchecked";
    if (is("conductor")(r)) return "VERDICT: ok\nfine";
    return "STATUS: done\nchanged it";
  });
  const store = new Store();
  return { scripted, store, init: { config: testConfig(), catalog: CATALOG, store, runner: scripted.runner, cwd } };
}

describe("session history", () => {
  it("saves a session, lists it, and resumes by building only the stories that did not pass", async () => {
    const cwd = tempDir();
    const first = concertIn(cwd, true);
    const concert = await createConcert(first.init);
    await scoreRequest(concert, "add health and auth");
    await perform(concert);
    expect(first.store.get().stories.auth?.status).toBe("failed");
    const log = new SessionLog(cwd);
    saveSession(cwd, log.id, first.store.get());
    expect(statSync(join(cwd, ".concerto", "logs", `${log.id}.json`)).mode & 0o777).toBe(0o600);
    expect(listSessions(cwd)[0]).toMatchObject({ id: log.id, prompt: "add health and auth", passed: 1, total: 2 });

    const state = resumable(readSession(cwd, log.id)!);
    expect([state.phase, state.stories.route?.status, state.stories.auth?.status]).toEqual(["planned", "passed", "queued"]);
    const second = concertIn(cwd, false);
    second.store.update(() => state);
    await perform(await createConcert(second.init));
    expect(second.scripted.calls.filter(builds("route"))).toHaveLength(0);
    expect(second.scripted.calls.filter(builds("auth")).length).toBeGreaterThan(0);
    expect(second.store.get().phase).toBe("done");
  });

  it("marks agents cut off mid-run as failed and leaves a finished session done", () => {
    const store = new Store();
    store.agentStart({ id: "section:a", role: "section", model: "a/swarm", label: "a" });
    const cut = resumable({ ...store.get(), phase: "running" });
    expect([cut.phase, cut.agents["section:a"]?.status]).toEqual(["idle", "failed"]);
  });

  it("/history lists the sessions and /history 1 hands the chosen one to resume", async () => {
    const cwd = tempDir();
    const saved = { ...new Store().get(), prompt: "make it faster" };
    saveSession(cwd, "s-old-0001", saved);
    const shown: (Panel | null)[] = [];
    const resumed: State[] = [];
    const ctx = { cwd, show: (p: Panel | null) => shown.push(p), resume: (s: State) => resumed.push(s), log: new SessionLog(cwd) } as unknown as SlashContext;
    await runSlash("/history", ctx);
    expect(shown.at(-1)?.lines[0]).toMatch(/^ 1 {2}s-old-0001 .* make it faster$/);
    await runSlash("/history 1", ctx);
    expect(resumed[0]?.prompt).toBe("make it faster");
    await runSlash("/history s-missing", ctx);
    expect(shown.at(-1)?.lines[0]).toMatch(/No saved session "s-missing"/);
  });
});
