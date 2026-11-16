import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { codexBin } from "#src/runner/bins.js";
import type { Effort } from "#src/config/types.js";
import { gitEnv } from "#src/runner/env.js";
import type { RunEvent } from "#src/runner/events.js";
import { type Json, asRecord, num, parseJsonLine, str, tool } from "#src/runner/json.js";
import { withRolePrompt } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

const EFFORT: Partial<Record<Effort, string>> = { off: "minimal", max: "xhigh" };
const WRITE_TOOLS = new Set(["edit", "write", "bash"]);
const READ_STDIN = "-";

/**
 * In a git worktree the repository's git data lives outside the folder, and Codex's sandbox
 * makes it read-only: `git status`, `git stash` and tests that run git then fail with EPERM.
 */
function gitDataOutside(cwd: string): string | null {
  // realpathSync.native: both sides in long form, never a Windows 8.3 short name against a long one.
  try {
    const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const dir = realpathSync.native(out.trim());
    return relative(realpathSync.native(cwd), dir).startsWith("..") ? dir : null;
  } catch {
    return null;
  }
}

/**
 * `codex exec` on the ChatGPT subscription, or through a profile such as a proxy
 * (`codex@ce-gpt/gpt-6.1-sol` runs with `-p ce-gpt`). Builders get a workspace-write
 * sandbox, everyone else read-only.
 */
export function buildCodexArgs(req: RunRequest): string[] {
  const ref = parseRef(req.model);
  const sandbox = req.tools.some((t) => WRITE_TOOLS.has(t)) ? "workspace-write" : "read-only";
  const args = ["exec", "--json", "--skip-git-repo-check", "--cd", req.cwd, "--model", ref.id, "--sandbox", sandbox];
  const gitData = sandbox === "workspace-write" ? gitDataOutside(req.cwd) : null;
  if (gitData) args.push("--add-dir", gitData);
  if (ref.profile) args.push("--profile", ref.profile);
  args.push("-c", `model_reasoning_effort="${EFFORT[req.effort] ?? req.effort}"`, READ_STDIN);
  return args;
}

/** Codex has no system prompt flag: the role prompt opens the message, still a stable prefix. */
export const codexInput = withRolePrompt;

function itemEvent(item: Json): RunEvent | null {
  if (item.type === "command_execution") return tool("bash", str(item.command).replace(/^\S*bash -lc /, ""));
  if (item.type === "file_change") return { kind: "tool", name: "edit", detail: "files" };
  if (item.type === "agent_message") return { kind: "text", delta: str(item.text) };
  return null;
}

function turnEvent(event: Json, lastText: string): RunEvent {
  const u = asRecord(event.usage);
  const cached = num(u.cached_input_tokens);
  const usage = { input: num(u.input_tokens) - cached, output: num(u.output_tokens), cacheRead: cached, cacheWrite: 0, cost: 0 };
  return { kind: "turn", usage, text: lastText };
}

/**
 * Codex prints the answer as the last agent_message, then usage on turn.completed. A command
 * comes twice, on item.started and item.completed: each item id is reported once.
 */
export function codexParser(): (line: string) => RunEvent | null {
  let lastText = "";
  const seen = new Set<string>();
  return (line) => {
    const event = parseJsonLine(line);
    if (!event) return null;
    if (event.type === "turn.completed") return turnEvent(event, lastText);
    if (event.type === "error") return { kind: "error", message: str(event.message) };
    if (event.type === "turn.failed") return { kind: "error", message: str(asRecord(event.error).message) };
    if (event.type !== "item.started" && event.type !== "item.completed") return null;
    const item = asRecord(event.item);
    const id = str(item.id);
    if (id && seen.has(id)) return null;
    if (id) seen.add(id);
    const out = itemEvent(item);
    if (out?.kind === "text") lastText = out.delta;
    return out;
  };
}

export const runCodex: Runner = (req, onEvent) =>
  runJsonl({ bin: codexBin(), args: buildCodexArgs(req), input: codexInput(req), cwd: req.cwd, signal: req.signal, sandbox: req.sandbox, parse: codexParser() }, onEvent);
