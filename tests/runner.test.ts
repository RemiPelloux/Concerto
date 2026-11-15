import { describe, expect, it } from "vitest";
import { parseListModels } from "../src/models/discover.js";
import { parseLine } from "../src/runner/events.js";
import { buildArgs } from "../src/runner/pi.js";

describe("pi adapter", () => {
  it("reads usage and text from an assistant message_end line", () => {
    const line = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "thinking" }, { type: "text", text: "ok" }], usage: { input: 5, output: 2, cacheRead: 900, cacheWrite: 0, cost: { total: 0.01 } } },
    });
    expect(parseLine(line)).toEqual({ kind: "turn", text: "ok", usage: { input: 5, output: 2, cacheRead: 900, cacheWrite: 0, cost: 0.01 } });
  });

  it("reports tool starts and ignores noise", () => {
    const tool = JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "npm   test" } });
    expect(parseLine(tool)).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
    expect(parseLine("{not json")).toBeNull();
    expect(parseLine(JSON.stringify({ type: "agent_start" }))).toBeNull();
  });

  it("builds a stateless read-only call", () => {
    const args = buildArgs({ model: "a/m", prompt: "go", systemFile: "/s.md", tools: [], effort: "low", skills: ["/k"], cwd: "/" });
    expect(args).toEqual(expect.arrayContaining(["--no-tools", "--no-session", "--skill", "/k", "--system-prompt", "/s.md"]));
    expect(args.at(-1)).toBe("go");
  });

  it("parses the pi model table", () => {
    const table = "provider  model  context  max-out\nanthropic  claude-opus-5-5  1M  128K\nce-gpt  gpt-6-luna  272K  32.8K\n";
    expect(parseListModels(table)).toEqual([
      { ref: "anthropic/claude-opus-5-5", contextK: 1000 },
      { ref: "ce-gpt/gpt-6-luna", contextK: 272 },
    ]);
  });
});
