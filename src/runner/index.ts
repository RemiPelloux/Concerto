import { runClaude } from "#src/runner/claude.js";
import { runCodex } from "#src/runner/codex.js";
import { runAider } from "#src/runner/aider.js";
import { runCursor } from "#src/runner/cursor.js";
import { runGemini } from "#src/runner/gemini.js";
import { runGoose } from "#src/runner/goose.js";
import { runOpencode } from "#src/runner/opencode.js";
import { runPi } from "#src/runner/pi.js";
import { parseRef, type Backend, type Runner } from "#src/runner/types.js";

const BACKENDS: Record<Backend, Runner> = { "claude-code": runClaude, codex: runCodex, pi: runPi, gemini: runGemini, cursor: runCursor, opencode: runOpencode, aider: runAider, goose: runGoose };

/** Only pi and Claude Code keep sessions Concerto can resume; the other CLIs are stateless here. */
export const RESUMABLE: ReadonlySet<Backend> = new Set<Backend>(["claude-code", "pi"]);

export const runModel: Runner = (req, onEvent) => BACKENDS[parseRef(req.model).backend](req, onEvent);
