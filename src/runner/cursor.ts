import { agentBin } from "#src/runner/bins.js";
import type { RunEvent } from "#src/runner/events.js";
import { asArray, asRecord, num, oneLine, parseJsonLine, str, type Json } from "#src/runner/json.js";
import { withRolePrompt, writes } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

/**
 * Cursor's agent in print mode, the message on stdin. Builders may run commands (`--force`);
 * everyone else works in plan mode, which only reads.
 */
export function buildCursorArgs(req: RunRequest): string[] {
  const mode = writes(req) ? ["--force"] : ["--mode", "plan"];
  return ["-p", "--output-format", "stream-json", "--model", parseRef(req.model).id, "--trust", "--workspace", req.cwd, ...mode];
}

/** `{ "shellToolCall": { "args": { "command": "ls" } } }` -> bash: ls */
function toolEvent(call: Json): RunEvent {
  const [kind = "tool", body] = Object.entries(call)[0] ?? [];
  const args = asRecord(asRecord(body).args);
  const name = kind.replace(/ToolCall$/, "") === "shell" ? "bash" : kind.replace(/ToolCall$/, "");
  return { kind: "tool", name, detail: oneLine(args.command ?? args.path ?? "") };
}

/**
 * Events as Cursor's agent writes them: whole `assistant` messages, `tool_call` started and
 * completed (each reported once, when it starts), and a `result` whose `usage` has
 * inputTokens (uncached), outputTokens, cacheReadTokens and cacheWriteTokens.
 */
export function cursorParser(): (line: string) => RunEvent | null {
  return (line) => {
    const event = parseJsonLine(line);
    if (event?.type === "assistant") return { kind: "text", delta: asArray(asRecord(event.message).content).map((c) => str(asRecord(c).text)).join("") };
    if (event?.type === "tool_call" && event.subtype === "started") return toolEvent(asRecord(event.tool_call));
    if (event?.type !== "result") return null;
    if (event.is_error === true) return { kind: "error", message: str(event.result) || "Cursor's agent failed" };
    const u = asRecord(event.usage);
    const usage = { input: num(u.inputTokens), output: num(u.outputTokens), cacheRead: num(u.cacheReadTokens), cacheWrite: num(u.cacheWriteTokens), cost: 0 };
    return { kind: "turn", usage, text: str(event.result) };
  };
}

export const runCursor: Runner = (req, onEvent) =>
  runJsonl({ bin: agentBin("cursor-agent"), args: buildCursorArgs(req), input: withRolePrompt(req), cwd: req.cwd, signal: req.signal, parse: cursorParser() }, onEvent);
