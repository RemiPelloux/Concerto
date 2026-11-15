import type { Usage } from "./usage.js";

export type RunEvent =
  | { kind: "text"; delta: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "turn"; usage: Usage; text: string };

type Json = Record<string, unknown>;
const DETAIL_MAX = 80;

function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null ? (value as Json) : {};
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function readUsage(raw: unknown): Usage {
  const u = asRecord(raw);
  const cost = asRecord(u.cost);
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: num(cost.total),
  };
}

function textOf(message: Json): string {
  const parts = Array.isArray(message.content) ? message.content : [];
  return parts
    .map(asRecord)
    .filter((p) => p.type === "text")
    .map((p) => String(p.text ?? ""))
    .join("");
}

function toolDetail(args: unknown): string {
  const a = asRecord(args);
  const first = a.command ?? a.path ?? a.file_path ?? a.pattern ?? "";
  return String(first).replace(/\s+/g, " ").slice(0, DETAIL_MAX);
}

/** Maps one line of `pi --mode json` output to the events Concerto cares about. */
function safeParse(line: string): Json | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

export function parseLine(line: string): RunEvent | null {
  const event = line.startsWith("{") ? safeParse(line) : null;
  if (!event) return null;
  const delta = asRecord(asRecord(event.assistantMessageEvent));
  if (event.type === "message_update" && delta.type === "text_delta") {
    return { kind: "text", delta: String(delta.delta ?? "") };
  }
  if (event.type === "tool_execution_start") {
    return { kind: "tool", name: String(event.toolName ?? "tool"), detail: toolDetail(event.args) };
  }
  const message = asRecord(event.message);
  if (event.type === "message_end" && message.role === "assistant") {
    return { kind: "turn", usage: readUsage(message.usage), text: textOf(message) };
  }
  return null;
}
