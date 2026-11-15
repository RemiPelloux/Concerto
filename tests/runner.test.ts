import { describe, expect, it } from "vitest";
import { parseListModels } from "../src/models/discover.js";
import { childEnv } from "../src/runner/env.js";
import { parseLine } from "../src/runner/events.js";
import { buildPiArgs } from "../src/runner/pi.js";
import { parseRef } from "../src/runner/types.js";

describe("model refs", () => {
  it("reads the backend, profile and provider from a ref", () => {
    expect(parseRef("claude-code/claude-opus-5-5")).toMatchObject({ backend: "claude-code", id: "claude-opus-5-5" });
    expect(parseRef("codex/gpt-6.1-sol")).toMatchObject({ backend: "codex", provider: "openai", profile: "" });
    expect(parseRef("codex@ce-gpt/gpt-6.1-sol")).toMatchObject({ backend: "codex", provider: "ce-gpt", profile: "ce-gpt" });
    expect(parseRef("ce-deepseek/deepseek-v4-pro")).toMatchObject({ backend: "pi", provider: "ce-deepseek" });
    expect(() => parseRef("opus")).toThrow(/<backend>\/<model>/);
  });
});

describe("child environment", () => {
  it("passes what agent CLIs need and drops unrelated secrets", () => {
    const env = childEnv({ PATH: "/bin", HOME: "/h", OPENAI_API_KEY: "k", CE_API_KEY: "c", AWS_SECRET_ACCESS_KEY: "s", SHODAN_API_KEY: "x" });
    expect(Object.keys(env).sort()).toEqual(["CE_API_KEY", "HOME", "OPENAI_API_KEY", "PATH"]);
    expect(childEnv({ PATH: "/bin", MY_TOKEN: "t", CONCERTO_ENV_PASSTHROUGH: "MY_TOKEN" }).MY_TOKEN).toBe("t");
  });
});

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

  it("keeps the prompt out of the arguments and resumes sessions by id", () => {
    const base = { model: "ce-gpt/gpt-6.1-sol", prompt: "secret prompt", systemFile: "/s.md", tools: [], effort: "low" as const, skills: ["/k"], cwd: "/" };
    const args = buildPiArgs(base);
    expect(args).toEqual(expect.arrayContaining(["--no-tools", "--no-session", "--skill", "/k", "--system-prompt", "/s.md"]));
    expect(args.join(" ")).not.toContain("secret prompt");
    expect(buildPiArgs({ ...base, session: { dir: "/d", id: "s1", resume: true } })).toEqual(expect.arrayContaining(["--session-id", "s1"]));
  });

  it("parses the pi model table", () => {
    const table = "provider  model  context  max-out\nanthropic  claude-opus-5-5  1M  128K\nopenai  gpt-6-luna  272K  32.8K\n";
    expect(parseListModels(table)).toEqual(["anthropic/claude-opus-5-5", "openai/gpt-6-luna"]);
  });
});
