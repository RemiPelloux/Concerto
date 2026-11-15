import type { Effort } from "../config/types.js";
import type { RunEvent } from "./events.js";
import type { Usage } from "./usage.js";

export type RunRequest = {
  /** "<backend or pi provider>/<model id>", e.g. "claude-code/claude-opus-5-5". */
  model: string;
  prompt: string;
  systemFile: string;
  tools: string[];
  effort: Effort;
  skills: string[];
  cwd: string;
  session?: { dir: string; id: string };
  signal?: AbortSignal;
};

export type RunResult = { text: string; usage: Usage; turns: number };
export type Runner = (req: RunRequest, onEvent: (e: RunEvent) => void) => Promise<RunResult>;

/** Splits "claude-code/claude-opus-5-5" into its backend prefix and model id. */
export function splitRef(ref: string): { prefix: string; id: string } {
  const at = ref.indexOf("/");
  return { prefix: ref.slice(0, at), id: ref.slice(at + 1) };
}
