import { asArray, asRecord, num, oneLine, parseJsonLine, str, type Json } from "./json.js";
import type { Usage } from "./usage.js";

export type RunEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "turn"; usage: Usage; text: string };

/** pi reports usage per assistant message in its own shape. */
export function readUsage(raw: unknown): Usage {
  const u = asRecord(raw);
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: num(asRecord(u.cost).total),
  };
}

function textOf(message: Json): string {
  return asArray(message.content)
    .map(asRecord)
    .filter((p) => p.type === "text")
    .map((p) => str(p.text))
    .join("");
}

function toolDetail(args: unknown): string {
  const a = asRecord(args);
  return oneLine(a.command ?? a.path ?? a.file_path ?? a.pattern);
}

/** Maps one line of `pi --mode json` output to the events Concerto cares about. */
export function parseLine(line: string): RunEvent | null {
  const event = parseJsonLine(line);
  if (!event) return null;
  const update = asRecord(event.assistantMessageEvent);
  if (event.type === "message_update" && update.type === "text_delta") return { kind: "text", delta: str(update.delta) };
  if (event.type === "tool_execution_start") return { kind: "tool", name: str(event.toolName) || "tool", detail: toolDetail(event.args) };
  const message = asRecord(event.message);
  if (event.type === "message_end" && message.role === "assistant") {
    return { kind: "turn", usage: readUsage(message.usage), text: textOf(message) };
  }
  return null;
}
