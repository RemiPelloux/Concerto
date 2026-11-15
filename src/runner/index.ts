import { runClaude } from "#src/runner/claude.js";
import { runCodex } from "#src/runner/codex.js";
import { runPi } from "#src/runner/pi.js";
import { parseRef, type Backend, type Runner } from "#src/runner/types.js";

const BACKENDS: Record<Backend, Runner> = { "claude-code": runClaude, codex: runCodex, pi: runPi };

/** Only pi and Claude Code keep sessions Concerto can resume; Codex calls are stateless here. */
export const RESUMABLE: ReadonlySet<Backend> = new Set<Backend>(["claude-code", "pi"]);

export const runModel: Runner = (req, onEvent) => BACKENDS[parseRef(req.model).backend](req, onEvent);
