import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs, parseClaudeLine, sessionUuid } from "#src/runner/claude.js";
import { buildCodexArgs, codexInput, codexParser } from "#src/runner/codex.js";
import { parseLine } from "#src/runner/events.js";
import { runJsonl } from "#src/runner/spawn.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunRequest } from "#src/runner/types.js";
import { tempDir } from "#tests/fixtures.js";

function request(patch: Partial<RunRequest> = {}): RunRequest {
  const dir = tempDir();
  const systemFile = join(dir, "system.md");
  writeFileSync(systemFile, "You are the critic.");
  return { model: "claude-code/claude-opus-5-5", prompt: "secret prompt", systemFile, tools: ["read", "bash"], effort: "off", skills: [], cwd: dir, ...patch };
}

describe("claude code backend", () => {
  it("runs isolated from user settings, with only the role's tools pre-approved", () => {
    const args = buildClaudeArgs(request());
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-opus-5-5", "--setting-sources", "", "--strict-mcp-config"]));
    expect(args).toEqual(expect.arrayContaining(["--tools", "Read,Grep,Glob,Bash", "--allowedTools", "Read,Grep,Glob,Bash", "--effort", "low"]));
    expect(args).toContain("--no-session-persistence");
    expect(args.join(" ")).not.toContain("secret prompt");
  });

  it("creates a session, then resumes it", () => {
    const first = buildClaudeArgs(request({ session: { dir: "/s", id: "story", resume: false } }));
    const second = buildClaudeArgs(request({ session: { dir: "/s", id: "story", resume: true } }));
    expect(first).toContain("--session-id");
    expect(second).toContain("--resume");
    expect(first[first.indexOf("--session-id") + 1]).toBe(second[second.indexOf("--resume") + 1]);
    expect(sessionUuid("k")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("reads tool calls and the final result with cache usage", () => {
    const tool = { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } };
    expect(parseClaudeLine(JSON.stringify(tool))).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
    const result = { type: "result", result: "VERDICT: pass", total_cost_usd: 0.02, usage: { input_tokens: 3, output_tokens: 9, cache_read_input_tokens: 600, cache_creation_input_tokens: 20 } };
    expect(parseClaudeLine(JSON.stringify(result))).toEqual({ kind: "turn", text: "VERDICT: pass", usage: { input: 3, output: 9, cacheRead: 600, cacheWrite: 20, cost: 0.02 } });
  });
});

describe("errors reported inside the stream", () => {
  it("are read from all three backends", () => {
    const pi = { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "OAuth refresh failed", content: [] } };
    expect(parseLine(JSON.stringify(pi))).toEqual({ kind: "error", message: "OAuth refresh failed" });
    const claude = { type: "result", is_error: true, result: "model not found" };
    expect(parseClaudeLine(JSON.stringify(claude))).toEqual({ kind: "error", message: "model not found" });
    const codex = codexParser();
    expect(codex(JSON.stringify({ type: "turn.failed", error: { message: "not supported" } }))).toEqual({ kind: "error", message: "not supported" });
  });

  it("fail the call even when the CLI exits 0, unless a later turn answered", async () => {
    const script = (lines: object[]) => {
      const file = join(tempDir(), "fake.sh");
      writeFileSync(file, `#!/bin/sh\ncat > /dev/null\n${lines.map((l) => `echo '${JSON.stringify(l)}'`).join("\n")}\n`, { mode: 0o700 });
      return file;
    };
    const err = { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "503 no accounts" } };
    const ok = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }], usage: {} } };
    const job = (bin: string) => runJsonl({ bin, args: [], input: "hi", cwd: tempDir(), parse: parseLine }, () => undefined);
    await expect(job(script([err]))).rejects.toThrow(/503 no accounts/);
    await expect(job(script([err, ok]))).resolves.toMatchObject({ text: "ok" });
  });
});

describe("codex backend", () => {
  it("reads the prompt from stdin and picks the sandbox from the tools", () => {
    const readOnly = buildCodexArgs(request({ model: "codex/gpt-6-astra", tools: ["read"] }));
    expect(readOnly).toEqual(expect.arrayContaining(["--model", "gpt-6-astra", "--sandbox", "read-only"]));
    expect(readOnly.at(-1)).toBe("-");
    const writer = buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["edit"], effort: "max" }));
    expect(writer).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", 'model_reasoning_effort="xhigh"']));
  });

  it("runs a proxy through its Codex profile", () => {
    const args = buildCodexArgs(request({ model: "codex@ce-gpt/gpt-6.1-sol" }));
    expect(args).toEqual(expect.arrayContaining(["--profile", "ce-gpt", "--model", "gpt-6.1-sol"]));
  });

  it("puts the role prompt first in the message: a stable cached prefix", () => {
    expect(codexInput(request({ model: "codex/gpt-6-astra" }), "darwin")).toMatch(/^You are the critic\.\n\n---\n\nsecret prompt$/);
  });

  it("runs writers without a sandbox only when full access is on, readers never", () => {
    const writer = buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["edit"], fullAccess: true }));
    expect(writer).toEqual(expect.arrayContaining(["--sandbox", "danger-full-access"]));
    const reader = buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["read"], fullAccess: true }));
    expect(reader).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(codexInput(request({ model: "codex/gpt-6.1-sol", tools: ["edit"], fullAccess: true }), "linux")).not.toContain("## Sandbox");
  });

  it("tells Linux builders that Node cannot start processes in the sandbox", () => {
    const builder = codexInput(request({ model: "codex/gpt-6.1-sol", tools: ["edit"] }), "linux");
    expect(builder).toMatch(/secret prompt\n\n## Sandbox\n.*EPERM/s);
    expect(codexInput(request({ model: "codex/gpt-6.1-sol", tools: ["read"] }), "linux")).not.toContain("## Sandbox");
    expect(codexInput(request({ model: "codex/gpt-6.1-sol", tools: ["edit"] }), "darwin")).not.toContain("## Sandbox");
  });

  it("reports the last agent message with usage, cached tokens split out", () => {
    const parse = codexParser();
    parse(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "STATUS: done" } }));
    const turn = parse(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 40 } }));
    expect(turn).toEqual({ kind: "turn", text: "STATUS: done", usage: { input: 200, output: 40, cacheRead: 800, cacheWrite: 0, cost: 0 } });
    const command = { type: "item.started", item: { type: "command_execution", command: "/usr/bin/bash -lc npm test" } };
    expect(parse(JSON.stringify(command))).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
  });

  it("lets a builder in a git worktree write the repository's git data, which lives outside it", () => {
    const repo = tempDir();
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), stdio: "ignore" });
    git(repo, "init", "-q");
    git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const tree = join(tempDir(), "tree");
    git(repo, "worktree", "add", "-q", "--detach", tree);
    const builder = buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["read", "edit", "bash"], cwd: tree }));
    expect(builder.slice(builder.indexOf("--add-dir"), builder.indexOf("--add-dir") + 2)).toEqual(["--add-dir", join(realpathSync.native(repo), ".git")]);
    expect(buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["read", "edit", "bash"], cwd: repo }))).not.toContain("--add-dir");
    expect(buildCodexArgs(request({ model: "codex/gpt-6.1-sol", tools: ["read"], cwd: tree }))).not.toContain("--add-dir");
  });

  it("shows each command once, though Codex reports it when it starts and again when it ends", () => {
    const parse = codexParser();
    const item = { id: "item_1", type: "command_execution", command: "/usr/bin/bash -lc npm test" };
    expect(parse(JSON.stringify({ type: "item.started", item }))).toEqual({ kind: "tool", name: "bash", detail: "npm test" });
    expect(parse(JSON.stringify({ type: "item.completed", item }))).toBeNull();
    const edit = { id: "item_2", type: "file_change" };
    expect(parse(JSON.stringify({ type: "item.completed", item: edit }))).toEqual({ kind: "tool", name: "edit", detail: "files" });
  });
});
