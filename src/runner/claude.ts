import { createHash } from "node:crypto";
import type { Effort } from "../config/types.js";
import type { RunEvent } from "./events.js";
import { withSkillNote } from "./skill-note.js";
import { runJsonl } from "./spawn.js";
import { splitRef, type Runner, type RunRequest } from "./types.js";

type Json = Record<string, unknown>;
const TOOL_NAMES: Record<string, string[]> = {
  read: ["Read", "Grep", "Glob"],
  bash: ["Bash"],
  edit: ["Edit"],
  write: ["Write"],
};
const EFFORT: Partial<Record<Effort, string>> = { off: "low", minimal: "low" };
// eslint-disable-next-line no-magic-numbers -- the RFC 4122 group lengths are the data itself
const UUID_SLICES = [8, 4, 4, 4, 12];
const DETAIL_MAX = 80;
const started = new Set<string>();

export function claudeBin(): string {
  return process.env.CONCERTO_CLAUDE_BIN || "claude";
}

/** Claude Code needs UUID session ids; derive a stable one from Concerto's session key. */
export function sessionUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  let at = 0;
  return UUID_SLICES.map((n) => hex.slice(at, (at += n))).join("-");
}

function sessionArgs(req: RunRequest): string[] {
  if (!req.session) return ["--no-session-persistence"];
  const id = sessionUuid(`${req.session.dir}/${req.session.id}`);
  const resume = started.has(id);
  started.add(id);
  return resume ? ["--resume", id] : ["--session-id", id];
}

/**
 * Print mode on the user's Claude Code subscription. User settings, plugins, MCP servers and
 * slash commands stay off, so each call starts from Concerto's small, cacheable system prompt.
 */
export function buildClaudeArgs(req: RunRequest): string[] {
  const tools = req.tools.flatMap((t) => TOOL_NAMES[t] ?? []).join(",");
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", splitRef(req.model).id];
  args.push("--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands");
  args.push("--system-prompt-file", req.systemFile, "--effort", EFFORT[req.effort] ?? req.effort);
  args.push("--tools", tools, ...(tools ? ["--allowedTools", tools] : []));
  args.push(...sessionArgs(req), withSkillNote(req.prompt, req.skills));
  return args;
}

function toolEvent(message: Json): RunEvent | null {
  const parts = Array.isArray(message.content) ? (message.content as Json[]) : [];
  const call = parts.find((p) => p.type === "tool_use");
  if (!call) return null;
  const input = (call.input ?? {}) as Json;
  const detail = String(input.command ?? input.file_path ?? input.pattern ?? "").replace(/\s+/g, " ");
  return { kind: "tool", name: String(call.name ?? "tool").toLowerCase(), detail: detail.slice(0, DETAIL_MAX) };
}

function resultEvent(event: Json): RunEvent {
  const u = (event.usage ?? {}) as Record<string, number>;
  const usage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cost: Number(event.total_cost_usd ?? 0),
  };
  return { kind: "turn", usage, text: String(event.result ?? "") };
}

export function parseClaudeLine(line: string): RunEvent | null {
  if (!line.startsWith("{")) return null;
  try {
    const event = JSON.parse(line) as Json;
    if (event.type === "result") return resultEvent(event);
    return event.type === "assistant" ? toolEvent((event.message ?? {}) as Json) : null;
  } catch {
    return null;
  }
}

export const runClaude: Runner = (req, onEvent) =>
  runJsonl({ bin: claudeBin(), args: buildClaudeArgs(req), cwd: req.cwd, signal: req.signal, parse: parseClaudeLine }, onEvent);
