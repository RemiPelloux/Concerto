import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditPath, verifyAudit } from "#src/engine/audit.js";
import { runCheck } from "#src/engine/checks.js";
import { findSecrets } from "#src/engine/secrets.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import { allowed, target } from "#src/runner/proxy.js";
import { hasBubblewrap } from "#src/runner/sandbox.js";
import { gitEnv } from "#src/runner/env.js";
import { runModel } from "#src/runner/index.js";
import { Store } from "#src/state/store.js";
import { CATALOG, tempDir, testConfig } from "#tests/fixtures.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" });
const PLAN = JSON.stringify({ summary: "probe", stories: [{ id: "probe", title: "Probe the sandbox", asA: "a tester", iWant: "x", soThat: "y", acceptance: ["done"], points: 1, complexity: 1, risk: 1, value: 1, tags: [], files: ["tries.json"] }] });

/** Stands in for pi: answers each role, and as the builder tries what a hostile prompt would ask for. */
function fakeAgent(path: string, home: string, allowedUrl: string): void {
  writeFileSync(path, `#!${process.execPath}
const { execSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
require("node:fs").readFileSync(0);
const args = process.argv.slice(2);
const sys = args[args.indexOf("--system-prompt") + 1] || "";
const say = (text) => console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage: {} } }));
if (sys.includes("scorer-")) say(${JSON.stringify(PLAN)});
else if (sys.includes("critic-")) say("VERDICT: pass\\nok");
else if (sys.includes("conductor-")) say("VERDICT: ok\\nok");
else {
  const run = (command) => {
    console.log(JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command } }));
    try { return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return "FAILED " + String(e.stderr || e.message); }
  };
  const tries = {
    ssh: run("cat ${home}/.ssh/id_test"),
    direct: run("curl -sS -m 5 --noproxy '*' https://example.com -o /dev/null && echo REACHED"),
    proxied: run("curl -sS -m 5 https://example.com -o /dev/null && echo REACHED"),
    allowed: run("curl -sS -m 5 ${allowedUrl}"),
  };
  writeFileSync("tries.json", JSON.stringify(tries));
  say("STATUS: done");
}
`, { mode: 0o700 });
}

const usable = process.platform === "darwin" || (process.platform === "linux" && hasBubblewrap());

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!usable)("the sandbox", () => {
  it("stops a builder reading ~/.ssh or calling an outside URL, lets it reach an allowed host, and audits the attempts", async () => {
    const home = tempDir();
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_test"), "fake-ssh-key-content\n");
    const cwd = tempDir();
    git(cwd, "init", "-q");
    writeFileSync(join(cwd, "README.md"), "x\n");
    git(cwd, "add", ".");
    git(cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const server = createServer((_req, res) => res.end("ok-from-allowed-host"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const agent = join(cwd, ".git", "fake-pi");
    fakeAgent(agent, home, `http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    vi.stubEnv("HOME", home);
    vi.stubEnv("CONCERTO_PI_BIN", agent);
    vi.stubEnv("CONCERTO_RELAY_COMMAND", JSON.stringify([process.execPath, "--import", import.meta.resolve("tsx"), "--conditions=source", resolve("src/cli.ts")]));
    const config = { ...testConfig(), sandbox: { enabled: true, allowHosts: ["127.0.0.1"], hide: [] } };
    const c = await createConcert({ config, catalog: CATALOG, store: new Store(), runner: runModel, cwd });
    await scoreRequest(c, "probe");
    await perform(c);
    server.close();
    const tries = JSON.parse(readFileSync(join(cwd, "tries.json"), "utf8")) as Record<string, string>;
    expect(tries.ssh).not.toContain("fake-ssh-key-content");
    expect(tries.direct).not.toContain("REACHED");
    expect(tries.proxied).not.toContain("REACHED");
    expect(tries.allowed).toBe("ok-from-allowed-host");
    const log = auditPath(cwd, c.runId);
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; detail: string });
    expect(lines.some((l) => l.kind === "bash" && l.detail.includes(".ssh/id_test"))).toBe(true);
    expect(lines.some((l) => l.kind === "network-blocked" && l.detail === "example.com")).toBe(true);
    expect(verifyAudit(log)).toEqual({ ok: true, lines: lines.length });
    const tampered = readFileSync(log, "utf8").replace("id_test", "id_xxxx");
    writeFileSync(log, tampered);
    expect(verifyAudit(log).ok).toBe(false);
    expect(readdirSync(join(cwd, ".concerto", "audit"))).toEqual([`${c.runId}.jsonl`]);
  }, 60_000);
});

describe.skipIf(!usable)("checks in the sandbox", () => {
  it("run in the story's folder with no network and no credentials", async () => {
    const home = tempDir();
    mkdirSync(join(home, ".ssh"));
    writeFileSync(join(home, ".ssh", "id_test"), "fake-ssh-key-content\n");
    vi.stubEnv("HOME", home);
    const cwd = tempDir();
    const opts = { cwd, timeoutMs: 20_000, sandbox: { hide: [] } };
    const check = (command: string) => runCheck({ name: "acceptance", command }, opts);
    expect((await check("echo built > out.txt")).ok).toBe(true);
    expect(readFileSync(join(cwd, "out.txt"), "utf8")).toBe("built\n");
    expect((await check(`cat ${home}/.ssh/id_test`)).ok).toBe(false);
    expect((await check("curl -sS -m 5 https://example.com -o /dev/null")).ok).toBe(false);
  }, 60_000);
});

describe("the proxy's rules", () => {
  it("allows the providers and the configured hosts, and reads where a request goes", () => {
    expect(allowed("api.anthropic.com", ["api.anthropic.com"])).toBe(true);
    expect(allowed("eu.api.openai.com", ["*.openai.com"])).toBe(true);
    expect(allowed("openai.com.evil.test", ["*.openai.com"])).toBe(false);
    expect(allowed("example.com", ["*.example.com"])).toBe(false);
    expect(target("CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: x\r\n\r\n")).toEqual({ host: "api.anthropic.com", port: 443, tunnel: true });
    expect(target("GET http://127.0.0.1:8080/x HTTP/1.1\r\n\r\n")).toEqual({ host: "127.0.0.1", port: 8080, tunnel: false });
    expect(target("garbage")).toBeNull();
  });
});

describe("secret scanning", () => {
  it("finds keys and password literals on added lines, and leaves code that reads them alone", () => {
    const diff = ["+++ b/src/config.ts", "@@ -1,0 +1,5 @@", '+const key = "sk-ant-api03-abcdefghijklmnopqrstu";', "+const token = makeToken(user);", '+const password = "hunter2hunter2";', '+const example = { password: "changeme" };', "+const aws = 'AKIAABCDEFGHIJKLMNOP';"].join("\n");
    expect(findSecrets(diff)).toEqual([
      { file: "src/config.ts", line: 1, kind: "an API key" },
      { file: "src/config.ts", line: 3, kind: "a password or token in a string" },
      { file: "src/config.ts", line: 5, kind: "an AWS access key" },
    ]);
  });
});
