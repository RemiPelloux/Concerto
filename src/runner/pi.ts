import { piBin } from "#src/runner/bins.js";
import { parseLine } from "#src/runner/events.js";
import { runJsonl } from "#src/runner/spawn.js";
import type { Runner, RunRequest } from "#src/runner/types.js";

/** The prompt is not an argument: pi reads it from stdin in print mode. */
export function buildPiArgs(req: RunRequest): string[] {
  const args = ["-p", "--mode", "json", "--model", req.model, "--thinking", req.effort];
  args.push("--system-prompt", req.systemFile, "--no-context-files", "--no-skills");
  args.push(...(req.tools.length > 0 ? ["--tools", req.tools.join(",")] : ["--no-tools"]));
  req.skills.forEach((path) => args.push("--skill", path));
  if (req.session) args.push("--session-dir", req.session.dir, "--session-id", req.session.id);
  else args.push("--no-session");
  return args;
}

/** Any provider logged into pi: Anthropic, OpenAI, DeepSeek, Grok, a proxy such as ce-gpt. */
export const runPi: Runner = (req, onEvent) =>
  runJsonl({ bin: piBin(), args: buildPiArgs(req), input: req.prompt, cwd: req.cwd, signal: req.signal, sandbox: req.sandbox, parse: parseLine }, onEvent);
