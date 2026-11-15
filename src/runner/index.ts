import { runClaude } from "./claude.js";
import { runCodex } from "./codex.js";
import { runPi } from "./pi.js";
import { parseRef, type Backend, type Runner } from "./types.js";

const BACKENDS: Record<Backend, Runner> = { "claude-code": runClaude, codex: runCodex, pi: runPi };

/** Only pi and Claude Code keep sessions Concerto can resume; Codex calls are stateless here. */
export const RESUMABLE: ReadonlySet<Backend> = new Set<Backend>(["claude-code", "pi"]);

export const runModel: Runner = (req, onEvent) => BACKENDS[parseRef(req.model).backend](req, onEvent);
