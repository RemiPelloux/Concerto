import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiderParser, buildAiderArgs } from "#src/runner/aider.js";
import { buildCursorArgs, cursorParser } from "#src/runner/cursor.js";
import type { RunEvent } from "#src/runner/events.js";
import { buildGeminiArgs, geminiParser } from "#src/runner/gemini.js";
import { buildGooseArgs, gooseEnv, gooseParser } from "#src/runner/goose.js";
import { buildOpencodeArgs, opencodeParser } from "#src/runner/opencode.js";
import { parseRef, type RunRequest } from "#src/runner/types.js";
import { tempDir } from "#tests/fixtures.js";

function request(model: string, tools: string[] = ["read"]): RunRequest {
  const dir = tempDir();
  writeFileSync(join(dir, "system.md"), "You are the critic.");
  return { model, prompt: "secret prompt", systemFile: join(dir, "system.md"), tools, effort: "low", skills: [], cwd: dir };
}

/** Every event a parser makes of the lines, in order. */
const events = (parse: (line: string) => RunEvent | null, lines: (object | string)[]) =>
  lines.map((l) => parse(typeof l === "string" ? l : JSON.stringify(l))).filter((e): e is RunEvent => e !== null);
const turn = (all: RunEvent[]) => all.filter((e): e is Extract<RunEvent, { kind: "turn" }> => e.kind === "turn");

describe("model refs for the agent CLIs", () => {
  it("names the backend by its prefix, and the provider that serves the model", () => {
    expect(parseRef("gemini/gemini-3-pro")).toMatchObject({ backend: "gemini", provider: "google", id: "gemini-3-pro" });
    expect(parseRef("cursor/sonnet-5")).toMatchObject({ backend: "cursor", provider: "cursor" });
    expect(parseRef("opencode/anthropic/claude-sonnet-5-5")).toMatchObject({ backend: "opencode", provider: "anthropic", id: "anthropic/claude-sonnet-5-5" });
    expect(parseRef("goose/openai/gpt-6-sol")).toMatchObject({ backend: "goose", provider: "openai" });
    expect(parseRef("aider/deepseek/deepseek-v4-pro")).toMatchObject({ backend: "aider", provider: "deepseek" });
    expect(parseRef("ce-gpt/gpt-6-sol").backend).toBe("pi");
  });

  it("never puts the prompt in the arguments, and only builders may change files", () => {
    const all = [buildGeminiArgs, buildCursorArgs, buildOpencodeArgs, buildGooseArgs].map((build) => build(request("gemini/x")).join(" "));
    expect(all.some((a) => a.includes("secret prompt"))).toBe(false);
    expect(buildGeminiArgs(request("gemini/gemini-3-pro"))).toEqual(["-p", "", "-o", "stream-json", "-m", "gemini-3-pro", "--approval-mode", "plan", "--skip-trust"]);
    expect(buildGeminiArgs(request("gemini/x", ["edit"]))).toContain("yolo");
    expect(buildCursorArgs(request("cursor/x"))).toEqual(expect.arrayContaining(["--mode", "plan", "--trust"]));
    expect(buildCursorArgs(request("cursor/x", ["bash"]))).toContain("--force");
    expect(buildOpencodeArgs(request("opencode/openai/gpt-6-sol"))).toEqual(["run", "--format", "json", "--archived", "-m", "openai/gpt-6-sol", "--agent", "plan"]);
    expect(buildOpencodeArgs(request("opencode/x/y", ["write"]))).toEqual(expect.arrayContaining(["--agent", "build", "--auto"]));
    expect(buildGooseArgs(request("goose/anthropic/claude-sonnet-5-5"))).toEqual(expect.arrayContaining(["--provider", "anthropic", "--model", "claude-sonnet-5-5", "-i", "-"]));
    expect([gooseEnv(request("goose/x")), gooseEnv(request("goose/x", ["edit"]))]).toEqual([{ GOOSE_MODE: "chat" }, { GOOSE_MODE: "auto" }]);
    expect(buildAiderArgs(request("aider/x"), "m.md")).toEqual(expect.arrayContaining(["--message-file", "m.md", "--no-auto-commits", "--chat-mode", "ask"]));
    expect(buildAiderArgs(request("aider/x", ["edit"]), "m.md")).not.toContain("--chat-mode");
  });
});

describe("reading each CLI's output", () => {
  it("OpenCode: a real run, read a file then answered, two steps of tokens", () => {
    const lines = readFileSync(join(import.meta.dirname, "recorded", "opencode-run.jsonl"), "utf8").split("\n").filter(Boolean);
    const all = events(opencodeParser(), lines);
    expect(all.filter((e) => e.kind === "tool")).toEqual([{ kind: "tool", name: "read", detail: "a.txt" }]);
    expect(turn(all).map((t) => t.text)).toEqual(["", "hello"]);
    expect(turn(all)[0]?.usage).toEqual({ input: 16264, output: 54, cacheRead: 0, cacheWrite: 0, cost: 0 });
    expect(turn(all)[1]?.usage.cacheRead).toBe(3840);
  });

  it("Gemini CLI: assistant deltas, a tool call, and stats that count cached tokens apart", () => {
    const all = events(geminiParser(), [
      { type: "init", session_id: "s", model: "gemini-3-pro" },
      { type: "message", role: "user", content: "secret prompt" },
      { type: "tool_use", tool_name: "read_file", tool_id: "t1", parameters: { file_path: "a.ts" } },
      { type: "tool_result", tool_id: "t1", status: "success", output: "..." },
      { type: "message", role: "assistant", content: "VERDICT: ", delta: true },
      { type: "message", role: "assistant", content: "pass", delta: true },
      { type: "result", status: "success", stats: { total_tokens: 1300, input_tokens: 1200, output_tokens: 100, cached: 800, input: 400, duration_ms: 9, tool_calls: 1 } },
    ]);
    expect(all[0]).toEqual({ kind: "tool", name: "read_file", detail: "a.ts" });
    expect(turn(all)).toEqual([{ kind: "turn", text: "VERDICT: pass", usage: { input: 400, output: 100, cacheRead: 800, cacheWrite: 0, cost: 0 } }]);
    expect(events(geminiParser(), [{ type: "result", status: "error", error: { type: "FatalAuthenticationError", message: "no auth" } }])).toEqual([{ kind: "error", message: "no auth" }]);
  });

  it("Cursor's agent: whole messages, tool calls once, and usage on the result", () => {
    const shell = { shellToolCall: { args: { command: "npm test" } } };
    const all = events(cursorParser(), [
      { type: "system", subtype: "init", session_id: "s", model: "Sonnet 5" },
      { type: "tool_call", subtype: "started", call_id: "c1", tool_call: shell, session_id: "s" },
      { type: "tool_call", subtype: "completed", call_id: "c1", tool_call: shell, session_id: "s" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, session_id: "s" },
      { type: "result", subtype: "success", is_error: false, result: "Done.", session_id: "s", usage: { inputTokens: 900, outputTokens: 50, cacheReadTokens: 4000, cacheWriteTokens: 100 } },
    ]);
    expect(all.map((e) => e.kind)).toEqual(["tool", "text", "turn"]);
    expect(all[0]).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
    expect(turn(all)[0]).toEqual({ kind: "turn", text: "Done.", usage: { input: 900, output: 50, cacheRead: 4000, cacheWrite: 100, cost: 0 } });
  });

  it("Goose: messages with text and tool requests, then the session's totals and cost", () => {
    const tool = { type: "toolRequest", id: "t", toolCall: { status: "success", value: { name: "developer__shell", arguments: { command: "ls" } } } };
    const all = events(gooseParser(), [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "secret prompt" }] } },
      { type: "message", message: { role: "assistant", content: [tool] } },
      { type: "notification", extension_id: "developer", log: { message: "x" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "STATUS: done" }] } },
      { type: "complete", total_tokens: 1500, input_tokens: 1400, output_tokens: 100, cost_usd: 0.012 },
    ]);
    expect(all.map((e) => e.kind)).toEqual(["tool", "text", "turn"]);
    expect(all[0]).toEqual({ kind: "tool", name: "shell", detail: "ls" });
    expect(turn(all)[0]).toEqual({ kind: "turn", text: "STATUS: done", usage: { input: 1400, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.012 } });
    expect(events(gooseParser(), [{ type: "error", error: "provider not configured" }])).toEqual([{ kind: "error", message: "provider not configured" }]);
  });

  it("Aider: plain text, edits applied, and the token report as aider formats it", () => {
    const all = events(aiderParser(), [
      "I'll fix the off-by-one in billing.ts.",
      "Applied edit to src/billing.ts",
      "",
      "Tokens: 12k sent, 3.1k cache hit, 1.2k received. Cost: $0.0042 message, $0.0042 session.",
    ]);
    expect(all.map((e) => e.kind)).toEqual(["text", "tool", "turn"]);
    expect(turn(all)[0]).toEqual({ kind: "turn", text: "I'll fix the off-by-one in billing.ts.", usage: { input: 8900, output: 1200, cacheRead: 3100, cacheWrite: 0, cost: 0.0042 } });
    expect(turn(events(aiderParser(), ["ok", "Tokens: 999 sent, 12 received."]))[0]?.usage).toMatchObject({ input: 999, output: 12, cost: 0 });
  });
});
