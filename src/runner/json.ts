export type Json = Record<string, unknown>;

/** Longest tool detail shown in the TUI. */
export const DETAIL_MAX = 80;

export function asRecord(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One JSON object per line, as agent CLIs print in JSON mode. Anything else is ignored. */
export function parseJsonLine(line: string): Json | null {
  if (!line.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

/** A single short line for the TUI: whitespace collapsed, clipped. */
export function oneLine(value: unknown): string {
  return str(value).replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX);
}

/** A tool call: a short detail for the screen, and the whole value when the screen clips it, for the audit log. */
export function tool(name: string, value: unknown): { kind: "tool"; name: string; detail: string; full?: string } {
  const whole = typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value);
  const detail = oneLine(whole);
  return whole.trim().length <= DETAIL_MAX ? { kind: "tool", name, detail } : { kind: "tool", name, detail, full: whole };
}
