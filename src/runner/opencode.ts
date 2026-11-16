import { agentBin } from "#src/runner/bins.js";
import type { RunEvent } from "#src/runner/events.js";
import { asRecord, num, oneLine, parseJsonLine, str } from "#src/runner/json.js";
import { withRolePrompt, writes } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

/**
 * `opencode run`, the message on stdin: `opencode/anthropic/claude-sonnet-4-5` runs with
 * `-m anthropic/claude-sonnet-4-5`. Builders use the build agent with permissions approved,
 * everyone else the plan agent, which only reads. Sessions are archived, out of OpenCode's list.
 */
export function buildOpencodeArgs(req: RunRequest): string[] {
  const agent = writes(req) ? ["--agent", "build", "--auto"] : ["--agent", "plan"];
  return ["run", "--format", "json", "--archived", "-m", parseRef(req.model).id, ...agent];
}

/**
 * Events as OpenCode 2 writes them: `text` and `tool_use` parts, and a `step_finish` per model
 * step with its tokens and cost. A step's answer is the text since that step started.
 */
export function opencodeParser(): (line: string) => RunEvent | null {
  let text = "";
  return (line) => {
    const event = parseJsonLine(line);
    const part = asRecord(event?.part);
    if (event?.type === "step_start") text = "";
    if (event?.type === "text") {
      text += str(part.text);
      return { kind: "text", delta: str(part.text) };
    }
    if (event?.type === "tool_use") {
      const input = asRecord(asRecord(part.state).input);
      return { kind: "tool", name: str(part.tool), detail: oneLine(input.command ?? input.filePath ?? input.path ?? "") };
    }
    if (event?.type === "error") return { kind: "error", message: oneLine(asRecord(event.error).data ?? event.error) || "OpenCode failed" };
    if (event?.type !== "step_finish") return null;
    const tokens = asRecord(part.tokens);
    const cache = asRecord(tokens.cache);
    const usage = { input: num(tokens.input), output: num(tokens.output) + num(tokens.reasoning), cacheRead: num(cache.read), cacheWrite: num(cache.write), cost: num(part.cost) };
    return { kind: "turn", usage, text };
  };
}

export const runOpencode: Runner = (req, onEvent) =>
  runJsonl({ bin: agentBin("opencode"), args: buildOpencodeArgs(req), input: withRolePrompt(req), cwd: req.cwd, signal: req.signal, parse: opencodeParser() }, onEvent);
