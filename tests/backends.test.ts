import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeLine, sessionUuid } from "../src/runner/claude.js";
import { buildCodexArgs, codexParser } from "../src/runner/codex.js";
import type { RunRequest } from "../src/runner/types.js";

function request(patch: Partial<RunRequest> = {}): RunRequest {
  const dir = mkdtempSync(join(tmpdir(), "concerto-"));
  const systemFile = join(dir, "system.md");
  writeFileSync(systemFile, "You are the critic.");
  return { model: "claude-code/claude-opus-5-5", prompt: "go", systemFile, tools: ["read", "bash"], effort: "off", skills: [], cwd: dir, ...patch };
}

describe("claude code backend", () => {
  it("runs isolated from user settings, with only the role's tools pre-approved", () => {
    const args = buildClaudeArgs(request());
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-opus-5-5", "--setting-sources", "", "--strict-mcp-config"]));
    expect(args).toEqual(expect.arrayContaining(["--tools", "Read,Grep,Glob,Bash", "--allowedTools", "Read,Grep,Glob,Bash", "--effort", "low"]));
    expect(args).toContain("--no-session-persistence");
  });

  it("creates a session once, then resumes it", () => {
    const session = { dir: "/tmp/s", id: `story-${Date.now()}` };
    const first = buildClaudeArgs(request({ session }));
    const second = buildClaudeArgs(request({ session }));
    expect(first).toContain("--session-id");
    expect(second).toContain("--resume");
    expect(sessionUuid("k")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("reads tool calls and the final result with cache usage", () => {
    const tool = { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } };
    expect(parseClaudeLine(JSON.stringify(tool))).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
    const result = { type: "result", result: "VERDICT: pass", total_cost_usd: 0.02, usage: { input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 600, cache_creation_input_tokens: 20 } };
    expect(parseClaudeLine(JSON.stringify(result))).toEqual({ kind: "turn", text: "VERDICT: pass", usage: { input: 3, output: 9, cacheRead: 600, cacheWrite: 20, cost: 0.02 } });
  });
});

describe("codex backend", () => {
  it("puts the role prompt first and picks the sandbox from the tools", () => {
    const readOnly = buildCodexArgs(request({ model: "codex/gpt-6-astra", tools: ["read"] }));
    expect(readOnly).toEqual(expect.arrayContaining(["--model", "gpt-6-astra", "--sandbox", "read-only"]));
    expect(readOnly.at(-1)).toMatch(/^You are the critic\.\n\n---\n\ngo/);
    const writer = buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["edit"], effort: "max" }));
    expect(writer).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", 'model_reasoning_effort="xhigh"']));
  });

  it("reports the last agent message with usage, cached tokens split out", () => {
    const parse = codexParser();
    parse(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "STATUS: done" } }));
    const turn = parse(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 40 } }));
    expect(turn).toEqual({ kind: "turn", text: "STATUS: done", usage: { input: 200, output: 40, cacheRead: 800, cacheWrite: 0, cost: 0 } });
    expect(parse(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "/usr/bin/bash -lc npm test" } }))).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
  });
});
