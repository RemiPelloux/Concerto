import { readFileSync } from "node:fs";
import type { Effort } from "../config/types.js";
import type { RunEvent } from "./events.js";
import { asRecord, num, oneLine, parseJsonLine, str, type Json } from "./json.js";
import { withSkillNote } from "./skill-note.js";
import { runJsonl } from "./spawn.js";
import { parseRef, type Runner, type RunRequest } from "./types.js";

const EFFORT: Partial<Record<Effort, string>> = { off: "minimal", max: "xhigh" };
const WRITE_TOOLS = new Set(["edit", "write", "bash"]);
const READ_STDIN = "-";

export function codexBin(): string {
  return process.env.CONCERTO_CODEX_BIN || "codex";
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
  if (ref.profile) args.push("--profile", ref.profile);
  args.push("-c", `model_reasoning_effort="${EFFORT[req.effort] ?? req.effort}"`, READ_STDIN);
  return args;
}

/** Codex has no system prompt flag: the role prompt opens the message, still a stable prefix. */
export function codexInput(req: RunRequest): string {
  return `${readFileSync(req.systemFile, "utf8")}\n\n---\n\n${withSkillNote(req.prompt, req.skills)}`;
}

function itemEvent(item: Json): RunEvent | null {
  if (item.type === "command_execution") return { kind: "tool", name: "bash", detail: oneLine(str(item.command).replace(/^\S*bash -lc /, "")) };
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

/** Codex prints the answer as the last agent_message, then usage on turn.completed. */
export function codexParser(): (line: string) => RunEvent | null {
  let lastText = "";
  return (line) => {
    const event = parseJsonLine(line);
    if (!event) return null;
    if (event.type === "turn.completed") return turnEvent(event, lastText);
    if (event.type !== "item.started" && event.type !== "item.completed") return null;
    const out = itemEvent(asRecord(event.item));
    if (out?.kind === "text") lastText = out.delta;
    return out;
  };
}

export const runCodex: Runner = (req, onEvent) =>
  runJsonl({ bin: codexBin(), args: buildCodexArgs(req), input: codexInput(req), cwd: req.cwd, signal: req.signal, parse: codexParser() }, onEvent);
