import { agentBin } from "#src/runner/bins.js";
import type { RunEvent } from "#src/runner/events.js";
import { asRecord, num, oneLine, parseJsonLine, str } from "#src/runner/json.js";
import { withRolePrompt, writes } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

/**
 * Gemini CLI headless: the message on stdin, `stream-json` events out. Builders run in yolo
 * mode, everyone else in plan mode, which only reads. `--skip-trust` keeps a worktree Gemini has
 * never seen from stopping the run.
 */
export function buildGeminiArgs(req: RunRequest): string[] {
  return ["-p", "", "-o", "stream-json", "-m", parseRef(req.model).id, "--approval-mode", writes(req) ? "yolo" : "plan", "--skip-trust"];
}

/**
 * Events as Gemini CLI 0.66 writes them: `message` (assistant deltas), `tool_use`, and a final
 * `result` whose stats count `input` (uncached), `cached` and `output_tokens`.
 */
export function geminiParser(): (line: string) => RunEvent | null {
  let text = "";
  return (line) => {
    const event = parseJsonLine(line);
    if (event?.type === "message" && event.role === "assistant") {
      text += str(event.content);
      return { kind: "text", delta: str(event.content) };
    }
    if (event?.type === "tool_use") return { kind: "tool", name: str(event.tool_name), detail: oneLine(Object.values(asRecord(event.parameters))[0] ?? "") };
    if (event?.type !== "result") return null;
    if (event.status !== "success") return { kind: "error", message: str(asRecord(event.error).message) || "Gemini CLI failed" };
    const stats = asRecord(event.stats);
    const usage = { input: num(stats.input), output: num(stats.output_tokens), cacheRead: num(stats.cached), cacheWrite: 0, cost: 0 };
    return { kind: "turn", usage, text };
  };
}

export const runGemini: Runner = (req, onEvent) =>
  runJsonl({ bin: agentBin("gemini"), args: buildGeminiArgs(req), input: withRolePrompt(req), cwd: req.cwd, signal: req.signal, parse: geminiParser() }, onEvent);
