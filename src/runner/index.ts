import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runPi } from "./pi.js";
import { splitRef, type Runner } from "./types.js";

export const CLAUDE_CODE = "claude-code";
export const CODEX = "codex";

/** Subscription CLIs by prefix; every other prefix is a pi provider. */
export const runModel: Runner = (req, onEvent) => {
  const { prefix } = splitRef(req.model);
  if (prefix === CLAUDE_CODE) return runClaude(req, onEvent);
  if (prefix === CODEX) return runCodex(req, onEvent);
  return runPi(req, onEvent);
};
