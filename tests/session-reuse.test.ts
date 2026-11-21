import { describe, expect, it } from "vitest";
import { readCalls, SessionLog } from "#src/engine/session-log.js";
import { callRole } from "#src/orchestrator/call.js";
import { createConcert } from "#src/orchestrator/concert.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, tempDir, testConfig } from "#tests/fixtures.js";

const USAGE = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0 };

/** The conductor's calls in a run: each later call on the same model reuses the warm session. */
async function conductor(failures: Set<number>) {
  const seen: NonNullable<RunRequest["session"]>[] = [];
  const runner = async (req: RunRequest) => {
    seen.push(req.session!);
    if (failures.has(seen.length)) throw new Error("claude exited 1: something went wrong");
    return { text: "VERDICT: ok\nfine", usage: USAGE, turns: 1 };
  };
  const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner, cwd: tempDir() });
  const call = () => callRole(c, { role: "conductor", segments: [{ name: "ask", text: "check" }], sessionKey: "conductor", chain: [CATALOG.get("a/brain")!] });
  return { seen, call };
}

describe("warm sessions after a failed call", () => {
  it("starts a fresh session when the call that opened one failed, instead of reusing its id", async () => {
    // As in a real run: the CLI created the session, then hit its limit; the id is taken.
    const { seen, call } = await conductor(new Set([1]));
    await expect(call()).rejects.toThrow("something went wrong");
    await call();
    await call();
    expect(seen[0]).toMatchObject({ resume: false });
    expect(seen[1]).toMatchObject({ resume: false });
    expect(seen[1]!.id).not.toBe(seen[0]!.id);
    expect(seen[2]).toMatchObject({ id: seen[1]!.id, resume: true });
  });

  it("keeps a session that already worked when a later turn fails", async () => {
    const { seen, call } = await conductor(new Set([2]));
    await call();
    await expect(call()).rejects.toThrow();
    await call();
    expect(seen.map((s) => s.id)).toEqual([seen[0]!.id, seen[0]!.id, seen[0]!.id]);
    expect(seen.map((s) => s.resume)).toEqual([false, true, true]);
  });
});

describe("the call log", () => {
  it("keeps each call's tokens, cache reads and turns, so cost can be traced per call", async () => {
    const cwd = tempDir();
    const log = new SessionLog(cwd);
    const runner = async () => ({ text: "VERDICT: ok\nfine", usage: { input: 1200, output: 80, cacheRead: 9000, cacheWrite: 300, cost: 0.02 }, turns: 3 });
    const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner, cwd });
    await callRole(c, { role: "conductor", segments: [{ name: "ask", text: "check" }], chain: [CATALOG.get("a/brain")!] });
    expect(readCalls(log.callsPath).at(-1)).toMatchObject({ ok: true, turns: 3, usage: { input: 1200, output: 80, cacheRead: 9000, cacheWrite: 300 } });
  });
});
