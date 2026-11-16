import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRoutes, observe } from "#src/engine/behaviour.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

/** Serves `/` from greeting.txt and `/health` as "ok" on PORT, and writes its pid to server.pid. */
const SERVER = `
const fs = require("fs");
fs.writeFileSync("server.pid", String(process.pid));
require("http").createServer((req, res) => {
  res.end(req.url === "/health" ? "ok" : fs.readFileSync("greeting.txt", "utf8"));
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

function site(): string {
  const cwd = tempDir();
  writeFileSync(join(cwd, "server.js"), SERVER);
  writeFileSync(join(cwd, "greeting.txt"), "hello\n");
  return cwd;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("behaviour diff", () => {
  it("asks each route on a running server, then stops it", async () => {
    const cwd = site();
    const serve = { serve: "node server.js", routes: ["/", "/health"], readySeconds: 10 };
    const before = await observe(cwd, serve);
    writeFileSync(join(cwd, "greeting.txt"), "hello, world\n");
    const after = await observe(cwd, serve);
    expect(before?.map((a) => [a.route, a.status])).toEqual([["/", 200], ["/health", 200]]);
    expect(compareRoutes(before ?? [], after ?? []).map((c) => c.route)).toEqual(["/"]);
    await new Promise((r) => setTimeout(r, 300));
    expect(alive(Number(readFileSync(join(cwd, "server.pid"), "utf8")))).toBe(false);
  });

  it("says when the server never answers instead of hanging", async () => {
    const result = await observe(tempDir(), { serve: "node -e \"setTimeout(() => {}, 60000)\"", routes: ["/"], readySeconds: 1 });
    expect(result).toBeNull();
  });

  it("shows the critic which configured routes the story changed", async () => {
    const cwd = site();
    execFileSync("git", ["init", "-q"], { cwd, env: gitEnv() });
    writeFileSync(join(cwd, ".gitignore"), "server.pid\n");
    execFileSync("git", ["add", "."], { cwd, env: gitEnv() });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd, env: gitEnv() });
    const plan = JSON.stringify({ summary: "x", stories: [{ id: "greet", title: "Greet the world", asA: "a visitor", iWant: "a greeting", soThat: "I feel welcome", acceptance: ["/ says hello, world"], points: 1, complexity: 1, risk: 1, value: 1, tags: [] }] });
    const is = (role: string) => (r: RunRequest) => r.systemFile.includes(`${role}-`);
    const scripted = scriptedRunner((r) => {
      if (is("scorer")(r)) return plan;
      if (is("conductor")(r)) return "VERDICT: ok\nfine";
      if (is("critic")(r)) return "VERDICT: pass\nchecked";
      writeFileSync(join(r.cwd, "greeting.txt"), "hello, world\n");
      return "STATUS: done\nedited";
    });
    const config = { ...testConfig(), behaviour: { serve: "node server.js", routes: ["/", "/health"], readySeconds: 10 } };
    const store = new Store();
    const c = await createConcert({ config, catalog: CATALOG, store, runner: scripted.runner, cwd });
    await scoreRequest(c, "x");
    await perform(c);
    const critic = scripted.calls.find(is("critic"))?.prompt ?? "";
    expect(critic).toMatch(/## Behaviour diff[\s\S]*`\/`: 200 \(0\.0 KB\) before, 200 \(0\.0 KB\) after, body changed/);
    expect(critic).not.toContain("`/health`");
    expect(store.get().stories.greet?.status).toBe("passed");
  });
});
