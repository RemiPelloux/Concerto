import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reachableRefs } from "#src/models/discover.js";
import { runLocal } from "#src/runner/local.js";
import { parseRef, type RunRequest } from "#src/runner/types.js";
import { tempDir } from "#tests/fixtures.js";

type Reply = { content?: string; calls?: { name: string; args: object }[] };

/** An OpenAI-compatible server like Ollama's: one model, answers given in order, requests kept. */
async function fakeOllama(replies: Reply[]): Promise<{ server: Server; bodies: { messages: { role: string; content?: string }[]; tools?: { function: { name: string } }[] }[] }> {
  const bodies: { messages: { role: string; content?: string }[] }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "qwen3:8b" }] }));
      bodies.push(JSON.parse(raw) as (typeof bodies)[number]);
      const r = replies[bodies.length - 1] ?? { content: "out of replies" };
      const tool_calls = r.calls?.map((c, i) => ({ id: `c${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: r.content ?? "", ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  vi.stubEnv("OLLAMA_HOST", `127.0.0.1:${(server.address() as AddressInfo).port}`);
  return { server, bodies: bodies as never };
}

function request(tools: string[]): RunRequest {
  const cwd = tempDir();
  writeFileSync(join(cwd, "system.md"), "You build.");
  writeFileSync(join(cwd, "a.txt"), "hello");
  return { model: "ollama/qwen3:8b", prompt: "Copy a.txt to b.txt", systemFile: join(cwd, "system.md"), tools, effort: "low", skills: [], cwd };
}

let open: Server | null = null;
afterEach(() => {
  open?.close();
  vi.unstubAllEnvs();
});

describe("local models through Ollama and LM Studio", () => {
  it("builds with read and write tools in a loop, inside the folder only, and adds up the tokens", async () => {
    const fake = await fakeOllama([
      { calls: [{ name: "read_file", args: { path: "a.txt" } }, { name: "read_file", args: { path: "../outside.txt" } }] },
      { calls: [{ name: "write_file", args: { path: "b.txt", content: "hello" } }] },
      { content: "STATUS: done" },
    ]);
    open = fake.server;
    const req = request(["read", "edit"]);
    const tools: string[] = [];
    const result = await runLocal(req, (e) => e.kind === "tool" && tools.push(`${e.name} ${e.detail}`));
    expect(result).toEqual({ text: "STATUS: done", turns: 3, usage: { input: 180, output: 30, cacheRead: 120, cacheWrite: 0, cost: 0 } });
    expect(readFileSync(join(req.cwd, "b.txt"), "utf8")).toBe("hello");
    expect(tools).toEqual(["read a.txt", "read ../outside.txt", "write b.txt"]);
    const second = fake.bodies[1]?.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(second).toEqual(["hello", "Refused: that path is outside the project folder."]);
    expect(fake.bodies[0]?.tools?.map((t) => t.function.name)).toEqual(["read_file", "list_files", "write_file"]);
  });

  it("gives a reviewer no write tool, and the scorer no tools at all", async () => {
    const fake = await fakeOllama([{ content: "VERDICT: pass" }, { content: "{}" }]);
    open = fake.server;
    await runLocal(request(["read"]), () => undefined);
    await runLocal(request([]), () => undefined);
    expect(fake.bodies[0]?.tools?.map((t) => t.function.name)).toEqual(["read_file", "list_files"]);
    expect(fake.bodies[1]?.tools).toBeUndefined();
    expect(existsSync(join(request([]).cwd, "b.txt"))).toBe(false);
  });

  it("is reachable when the server lists the model, not when the server is down", async () => {
    open = (await fakeOllama([])).server;
    const refs = ["ollama/qwen3:8b", "ollama/missing", "lmstudio/qwen3:8b"].map(parseRef);
    vi.stubEnv("LMSTUDIO_HOST", "http://127.0.0.1:9");
    expect([...(await reachableRefs(refs))]).toEqual(["ollama/qwen3:8b"]);
  });
});
