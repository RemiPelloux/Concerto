import type { Effort } from "#src/config/types.js";
import type { RunEvent } from "#src/runner/events.js";
import type { Usage } from "#src/runner/usage.js";

export type Backend = "claude-code" | "codex" | "pi";

export type RunRequest = {
  /** See parseRef for the grammar. */
  model: string;
  prompt: string;
  systemFile: string;
  tools: string[];
  effort: Effort;
  skills: string[];
  cwd: string;
  /** `resume` is true when this session already has turns. */
  session?: { dir: string; id: string; resume: boolean };
  signal?: AbortSignal;
};

export type RunResult = { text: string; usage: Usage; turns: number };
export type Runner = (req: RunRequest, onEvent: (e: RunEvent) => void) => Promise<RunResult>;

export type ModelRef = { backend: Backend; prefix: string; provider: string; profile: string; id: string };

const CLAUDE_CODE = "claude-code";
const CODEX = "codex";

/**
 * Model refs are `<prefix>/<model id>`:
 * - `claude-code/<id>`: Claude Code CLI on the user's Claude subscription.
 * - `codex/<id>`: Codex CLI on the user's ChatGPT subscription.
 * - `codex@<profile>/<id>`: Codex CLI with `$CODEX_HOME/<profile>.config.toml`, e.g. a proxy.
 * - anything else: a pi provider, e.g. `anthropic/<id>`, `openai/<id>`, `ce-gpt/<id>`.
 */
export function parseRef(ref: string): ModelRef {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) throw new Error(`Model "${ref}" must look like <backend>/<model>.`);
  const prefix = ref.slice(0, slash);
  const id = ref.slice(slash + 1);
  if (prefix === CLAUDE_CODE) return { backend: "claude-code", prefix, provider: "anthropic", profile: "", id };
  const [head = "", profile = ""] = prefix.split("@");
  if (head === CODEX) return { backend: "codex", prefix, provider: profile || "openai", profile, id };
  return { backend: "pi", prefix, provider: prefix, profile: "", id };
}
