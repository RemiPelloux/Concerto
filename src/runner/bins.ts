export function claudeBin(): string {
  return process.env.CONCERTO_CLAUDE_BIN || "claude";
}

export function codexBin(): string {
  return process.env.CONCERTO_CODEX_BIN || "codex";
}

export function piBin(): string {
  return process.env.CONCERTO_PI_BIN || "pi";
}
