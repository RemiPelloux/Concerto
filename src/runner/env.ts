/**
 * Child processes get an allowlisted environment, not ours. Agent CLIs run model-written shell
 * commands, so unrelated secrets (cloud credentials, other tools' tokens) must not reach them.
 * Add names with CONCERTO_ENV_PASSTHROUGH=NAME1,NAME2 when a project needs more.
 */
const ALLOWED = new RegExp(
  "^(" +
    [
      "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TZ", "TMPDIR", "TMP", "TEMP",
      "SSH_AUTH_SOCK", "HTTPS?_PROXY", "https?_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE",
      "LC_\\w+", "XDG_\\w+", "MISE_\\w+", "NODE_\\w+", "PNPM_\\w+", "NPM_CONFIG_\\w+", "COREPACK_\\w+",
      "GIT_\\w+", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_\\w+",
      "ANTHROPIC_\\w+", "OPENAI_\\w+", "PI_\\w+", "DEEPSEEK_\\w+", "XAI_\\w+", "CE_\\w+",
    ].join("|") +
    ")$",
);

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = new Set((source.CONCERTO_ENV_PASSTHROUGH ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const kept = Object.entries(source).filter(([key, value]) => value !== undefined && (ALLOWED.test(key) || extra.has(key)));
  return Object.fromEntries(kept);
}
