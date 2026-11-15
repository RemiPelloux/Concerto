import { readFileSync } from "node:fs";
import type { Effort } from "../config/types.js";
import type { RunEvent } from "./events.js";
import { withSkillNote } from "./skill-note.js";
import { runJsonl } from "./spawn.js";
import { splitRef, type Runner, type RunRequest } from "./types.js";

type Json = Record<string, unknown>;
const EFFORT: Partial<Record<Effort, string>> = { off: "minimal", max: "xhigh" };
const DETAIL_MAX = 80;
const WRITE_TOOLS = new Set(["edit", "write", "bash"]);

export function codexBin(): string {
  return process.env.CONCERTO_CODEX_BIN || "codex";
}

/**
 * `codex exec` on the user's ChatGPT subscription. Codex has no system prompt flag, so the
 * role prompt opens the message: a stable prefix that OpenAI's prompt cache still matches.
 */
export function buildCodexArgs(req: RunRequest): string[] {
  const sandbox = req.tools.some((t) => WRITE_TOOLS.has(t)) ? "workspace-write" : "read-only";
  const system = readFileSync(req.systemFile, "utf8");
  const prompt = `${system}\n\n---\n\n${withSkillNote(req.prompt, req.skills)}`;
  return [
    "exec", "--json", "--skip-git-repo-check", "--cd", req.cwd,
    "--model", splitRef(req.model).id, "--sandbox", sandbox,
    "-c", `model_reasoning_effort="${EFFORT[req.effort] ?? req.effort}"`,
    prompt,
  ];
}

function itemEvent(item: Json): RunEvent | null {
  if (item.type === "command_execution") {
    const detail = String(item.command ?? "").replace(/^\S*bash -lc /, "").slice(0, DETAIL_MAX);
    return { kind: "tool", name: "bash", detail };
  }
  if (item.type === "file_change") return { kind: "tool", name: "edit", detail: "files" };
  if (item.type === "agent_message") return { kind: "text", delta: String(item.text ?? "") };
  return null;
}

function turnEvent(event: Json, lastText: string): RunEvent {
  const u = (event.usage ?? {}) as Record<string, number>;
  const cached = u.cached_input_tokens ?? 0;
  const usage = { input: (u.input_tokens ?? 0) - cached, output: u.output_tokens ?? 0, cacheRead: cached, cacheWrite: 0, cost: 0 };
  return { kind: "turn", usage, text: lastText };
}

/** Codex reports the final answer as the last agent_message, then usage on turn.completed. */
export function codexParser(): (line: string) => RunEvent | null {
  let lastText = "";
  return (line) => {
    if (!line.startsWith("{")) return null;
    try {
      const event = JSON.parse(line) as Json;
      if (event.type === "turn.completed") return turnEvent(event, lastText);
      const out = event.type === "item.started" || event.type === "item.completed" ? itemEvent((event.item ?? {}) as Json) : null;
      if (out?.kind === "text") lastText = out.delta;
      return out;
    } catch {
      return null;
    }
  };
}

export const runCodex: Runner = (req, onEvent) =>
  runJsonl({ bin: codexBin(), args: buildCodexArgs(req), cwd: req.cwd, signal: req.signal, parse: codexParser() }, onEvent);
