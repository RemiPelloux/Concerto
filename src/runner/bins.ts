export function claudeBin(): string {
  return process.env.CONCERTO_CLAUDE_BIN || "claude";
}

export function codexBin(): string {
  return process.env.CONCERTO_CODEX_BIN || "codex";
}

export function piBin(): string {
  return process.env.CONCERTO_PI_BIN || "pi";
}

/** The CLIs added in 0.11, each overridable like the others: CONCERTO_GEMINI_BIN and so on. */
export const agentBin = (name: "gemini" | "cursor-agent" | "opencode" | "aider" | "goose"): string =>
  process.env[`CONCERTO_${name.replace("-agent", "").toUpperCase()}_BIN`] || name;
