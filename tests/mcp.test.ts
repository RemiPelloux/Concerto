import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { serve } from "#src/mcp/server.js";
import { concertoTools } from "#src/mcp/tools.js";
import type { RunRequest } from "#src/runner/types.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

type Reply = { id?: number; method?: string; result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string }; error?: { code: number }; params?: { message?: string } };

/** An MCP client on the other end of the server's stdio: sends requests, collects every message. */
function client(input: PassThrough, output: PassThrough) {
  const seen: Reply[] = [];
  const waiting = new Map<number, (r: Reply) => void>();
  createInterface({ input: output }).on("line", (line) => {
    const m = JSON.parse(line) as Reply;
    seen.push(m);
    if (m.id !== undefined) waiting.get(m.id)?.(m);
  });
  let next = 0;
  const request = (method: string, params: object = {}) => new Promise<Reply>((done) => {
    next += 1;
    waiting.set(next, done);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: next, method, params })}\n`);
  });
  const call = async (name: string, args: object) => {
    const r = await request("tools/call", { name, arguments: args, _meta: { progressToken: name } });
    return { text: r.result?.content?.[0]?.text ?? "", error: r.result?.isError === true };
  };
  return { seen, request, call, notify: (method: string) => input.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`) };
}

const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);

describe("Concerto as an MCP server", () => {
  it("lets another agent plan, build and read a run through tools alone", async () => {
    const cwd = tempDir();
    const scripted = scriptedRunner((r) => (is(r, "scorer") ? PLAN_REPLY : is(r, "critic") ? "VERDICT: pass\nok" : is(r, "conductor") ? "VERDICT: ok\nok" : "STATUS: done\nok"));
    const [input, output] = [new PassThrough(), new PassThrough()];
    const tools = concertoTools(async () => ({ config: testConfig(), catalog: CATALOG, runner: scripted.runner }));
    const closed = serve({ name: "concerto", version: "test", tools, input, output });
    const mcp = client(input, output);
    expect((await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent", version: "1" } })).result?.protocolVersion).toBe("2025-06-18");
    mcp.notify("notifications/initialized");
    expect((await mcp.request("tools/list")).result?.tools?.map((t) => t.name)).toEqual(["concerto_plan", "concerto_build", "concerto_run", "concerto_status", "concerto_sessions"]);
    const planned = JSON.parse((await mcp.call("concerto_plan", { request: "add a health endpoint", cwd })).text) as { session: string; stories: { id: string; builder: string }[] };
    expect(planned.stories.map((s) => s.id)).toEqual(["route", "auth"]);
    expect(scripted.calls.every((r) => is(r, "scorer") || is(r, "conductor"))).toBe(true);
    const built = JSON.parse((await mcp.call("concerto_build", { session: planned.session, cwd })).text) as { session: string; phase: string; stories: { status: string }[] };
    expect(built.phase).toBe("done");
    expect(built.stories.map((s) => s.status)).toEqual(["passed", "passed"]);
    expect(JSON.parse((await mcp.call("concerto_status", { session: built.session, cwd })).text)).toMatchObject({ phase: "done" });
    expect(JSON.parse((await mcp.call("concerto_sessions", { query: "health", cwd })).text)).toHaveLength(2);
    expect(mcp.seen.some((m) => m.method === "notifications/progress" && /Critic/.test(m.params?.message ?? ""))).toBe(true);
    input.end();
    await closed;
  });

  it("answers errors as an agent can read them", async () => {
    const [input, output] = [new PassThrough(), new PassThrough()];
    const closed = serve({ name: "concerto", version: "test", tools: concertoTools(async () => { throw new Error("unused"); }), input, output });
    const mcp = client(input, output);
    expect((await mcp.request("resources/list")).error?.code).toBe(-32601);
    expect(await mcp.call("concerto_status", { session: "s-nope", cwd: tempDir() })).toMatchObject({ error: true, text: expect.stringMatching(/No saved session "s-nope"/) });
    expect(await mcp.call("concerto_plan", { request: "x", cwd: "relative/path" })).toMatchObject({ error: true, text: expect.stringMatching(/not an absolute path/) });
    expect(await mcp.call("concerto_nothing", {})).toMatchObject({ error: true });
    input.end();
    await closed;
  });

  it("starts from the command line with `concerto --mcp` and lists its tools", async () => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--conditions=source", resolve("src/cli.ts"), "--mcp"], { stdio: ["pipe", "pipe", "inherit"] });
    const first = new Promise<Reply>((done) => createInterface({ input: child.stdout }).once("line", (l) => done(JSON.parse(l) as Reply)));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    expect((await first).result?.tools).toHaveLength(5);
    child.stdin.end();
    await new Promise((done) => child.on("close", done));
  });
});
