import { createHash } from "node:crypto";
import type { Effort } from "../config/types.js";
import type { RunEvent } from "./events.js";
import { asArray, asRecord, num, oneLine, parseJsonLine, str, type Json } from "./json.js";
import { withSkillNote } from "./skill-note.js";
import { runJsonl } from "./spawn.js";
import { parseRef, type Runner, type RunRequest } from "./types.js";

const TOOL_NAMES: Record<string, string[]> = {
  read: ["Read", "Grep", "Glob"],
  bash: ["Bash"],
  edit: ["Edit"],
  write: ["Write"],
};
const EFFORT: Partial<Record<Effort, string>> = { off: "low", minimal: "low" };
// eslint-disable-next-line no-magic-numbers -- the RFC 4122 group lengths are the data itself
const UUID_GROUPS = [8, 4, 4, 4, 12];

export function claudeBin(): string {
  return process.env.CONCERTO_CLAUDE_BIN || "claude";
}

/** Claude Code wants UUID session ids; derive a stable one from Concerto's session id. */
export function sessionUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  let at = 0;
  return UUID_GROUPS.map((n) => hex.slice(at, (at += n))).join("-");
}

function sessionArgs(req: RunRequest): string[] {
  if (!req.session) return ["--no-session-persistence"];
  const id = sessionUuid(`${req.session.dir}/${req.session.id}`);
  return req.session.resume ? ["--resume", id] : ["--session-id", id];
}

/**
 * Print mode on the user's Claude Code subscription. User settings, plugins, MCP servers and
 * slash commands stay off, so a call starts from Concerto's small, cacheable system prompt
 * (about 600 tokens instead of about 131K). The prompt arrives on stdin.
 */
export function buildClaudeArgs(req: RunRequest): string[] {
  const tools = req.tools.flatMap((t) => TOOL_NAMES[t] ?? []).join(",");
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", parseRef(req.model).id];
  args.push("--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands");
  args.push("--system-prompt-file", req.systemFile, "--effort", EFFORT[req.effort] ?? req.effort);
  args.push("--tools", tools, ...(tools ? ["--allowedTools", tools] : []), ...sessionArgs(req));
  return args;
}

function toolEvent(message: Json): RunEvent | null {
  const call = asArray(message.content).map(asRecord).find((p) => p.type === "tool_use");
  if (!call) return null;
  const input = asRecord(call.input);
  return { kind: "tool", name: (str(call.name) || "tool").toLowerCase(), detail: oneLine(input.command ?? input.file_path ?? input.pattern) };
}

function resultEvent(event: Json): RunEvent {
  const u = asRecord(event.usage);
  const usage = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cost: num(event.total_cost_usd),
  };
  return { kind: "turn", usage, text: str(event.result) };
}

/** Usage is summed once, from the final `result` line; per-message usage would double count. */
export function parseClaudeLine(line: string): RunEvent | null {
  const event = parseJsonLine(line);
  if (event?.type === "result") return resultEvent(event);
  return event?.type === "assistant" ? toolEvent(asRecord(event.message)) : null;
}

export const runClaude: Runner = (req, onEvent) =>
  runJsonl(
    { bin: claudeBin(), args: buildClaudeArgs(req), input: withSkillNote(req.prompt, req.skills), cwd: req.cwd, signal: req.signal, parse: parseClaudeLine },
    onEvent,
  );
