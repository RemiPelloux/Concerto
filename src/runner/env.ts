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
      // The agent CLIs added in 0.13 and the providers they log into. Not GOOGLE_APPLICATION_CREDENTIALS: a cloud credential.
      "GEMINI_\\w+", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_GENAI_USE_VERTEXAI", "CURSOR_API_KEY",
      "OPENROUTER_\\w+", "GROQ_\\w+", "MISTRAL_\\w+", "OLLAMA_HOST", "LM_STUDIO_\\w+", "AIDER_\\w+", "GOOSE_\\w+", "OPENCODE_\\w+",
      // Windows: programs fail to start or find their config without these.
      "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
      "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES\\(X86\\)", "HOMEDRIVE", "HOMEPATH", "USERNAME", "NUMBER_OF_PROCESSORS",
    ].join("|") +
    ")$",
  // Windows environment names are case-insensitive: `Path` is PATH there.
  process.platform === "win32" ? "i" : "",
);

/**
 * Variables that point git at another repository. Git sets them while it runs a hook, so a git
 * command started from inside one would otherwise act on that repository instead of `cwd`.
 */
const REPO_LOCATION = /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX)$/;

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = new Set((source.CONCERTO_ENV_PASSTHROUGH ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const kept = Object.entries(source).filter(([key, value]) => value !== undefined && (ALLOWED.test(key) || extra.has(key)) && !REPO_LOCATION.test(key));
  return Object.fromEntries(kept);
}

/** Our own environment for git commands, minus anything that would aim git at another repository. */
export function gitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !REPO_LOCATION.test(key)));
}
