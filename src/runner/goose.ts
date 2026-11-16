import { agentBin } from "#src/runner/bins.js";
import type { RunEvent } from "#src/runner/events.js";
import { type Json, asArray, asRecord, num, parseJsonLine, str, tool } from "#src/runner/json.js";
import { withRolePrompt, writes } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

/**
 * `goose run` with the instructions on stdin: `goose/anthropic/claude-sonnet-4-5` runs with
 * `--provider anthropic --model claude-sonnet-4-5`. No session file is kept.
 */
export function buildGooseArgs(req: RunRequest): string[] {
  const { id } = parseRef(req.model);
  const slash = id.indexOf("/");
  const model = slash > 0 ? ["--provider", id.slice(0, slash), "--model", id.slice(slash + 1)] : ["--model", id];
  return ["run", "--no-session", "-i", "-", "--output-format", "stream-json", ...model];
}

/** Builders run in auto mode; every other role in chat mode, without tools, on the diff it is given. */
export const gooseEnv = (req: RunRequest): Record<string, string> => ({ GOOSE_MODE: writes(req) ? "auto" : "chat" });

/** An assistant message's content: text parts and tool requests. */
function messageEvents(message: Json): RunEvent[] {
  if (message.role !== "assistant") return [];
  return asArray(message.content).flatMap((raw): RunEvent[] => {
    const c = asRecord(raw);
    if (c.type === "text") return [{ kind: "text", delta: str(c.text) }];
    if (c.type !== "toolRequest") return [];
    const call = asRecord(asRecord(c.toolCall).value);
    return [tool(str(call.name).replace(/^developer__/, ""), str(Object.values(asRecord(call.arguments))[0] ?? ""))];
  });
}

/**
 * Goose's stream-json events (`type` in snake case): `message`, `error`, and `complete` with
 * the session's tokens and `cost_usd`. A message holds several parts; they are joined into one
 * event, text first, as the live panel shows one line per event.
 */
export function gooseParser(): (line: string) => RunEvent | null {
  let text = "";
  return (line) => {
    const event = parseJsonLine(line);
    if (event?.type === "error") return { kind: "error", message: str(event.error) };
    if (event?.type === "complete") {
      const usage = { input: num(event.input_tokens), output: num(event.output_tokens), cacheRead: num(event.cache_read_input_tokens), cacheWrite: num(event.cache_write_input_tokens), cost: num(event.cost_usd) };
      return { kind: "turn", usage, text };
    }
    if (event?.type !== "message") return null;
    const events = messageEvents(asRecord(event.message));
    const said = events.flatMap((e) => (e.kind === "text" ? [e.delta] : [])).join("");
    if (said) text = said;
    return events.find((e) => e.kind === "text" && e.delta) ?? events[0] ?? null;
  };
}

export const runGoose: Runner = (req, onEvent) =>
  runJsonl({ bin: agentBin("goose"), args: buildGooseArgs(req), input: withRolePrompt(req), cwd: req.cwd, signal: req.signal, sandbox: req.sandbox, parse: gooseParser(), env: gooseEnv(req) }, onEvent);
